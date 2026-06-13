# Pipelines Monitoring View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone "Pipelines" view that fetches Azure DevOps build runs live (per project), shows run status / stage timeline / failed-job log tail, and supports re-run and cancel.

**Architecture:** New Tauri-free `pipelines` module in `crates/azdo-client` wraps the Build REST API. A new `PipelineService` in `src-tauri` resolves the org + project (via the existing `ProjectDirectory`) and calls the client live (no SQLite cache, no background sync). Six IPC commands expose list/detail/log/rerun/cancel; the two write commands are gated by `ensure_write_enabled`. The frontend adds `azdoCommands.ts` wrappers + Zod schemas + demo data and a `PipelinesView` feature that mirrors the existing `CommitSearch` layout, with TanStack Query `refetchInterval` driving auto-refresh while runs are in progress.

**Tech Stack:** Rust (reqwest via `AdoClient`, serde, wiremock, tokio), Tauri IPC, TypeScript, React, TanStack Query, Zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-13-pipelines-monitoring-design.md`

**Plan note (deviation from spec wording):** The spec said "do not add a new project-list API". This plan adds a dedicated `list_pipeline_projects` IPC command so the Pipelines view does not depend on `WorkItemService`. It reuses the `ProjectDirectory` helper internally, honoring the spec's intent (no duplicated project-cache logic) while keeping a clean feature boundary.

---

## File Structure

**Created:**
- `crates/azdo-client/src/pipelines.rs` — Build API wrapper (structs + `impl AdoClient` methods).
- `src-tauri/src/pipelines.rs` — `PipelineService`, IPC-facing types, input normalization.
- `src/features/pipelines/pipelineStatus.ts` — status/result → badge label + tone mapping (pure).
- `src/features/pipelines/PipelinesView.tsx` — view shell: org/project selectors, filters, run grid, auto-refresh.
- `src/features/pipelines/PipelineRunDetailPanel.tsx` — detail pane: timeline tree + failed-job log tail + actions.
- `src/features/pipelines/PipelinesView.test.tsx` — focused frontend test.

**Modified:**
- `crates/azdo-client/src/client.rs` — add `get_text` (plain-text GET for build logs).
- `crates/azdo-client/src/lib.rs` — `pub mod pipelines;` + `pub use` the new types.
- `src-tauri/src/lib.rs` — add `mod pipelines;`, wire `PipelineService` into `AppState`, add 6 commands + register in `generate_handler!`.
- `src/lib/azdoCommands.ts` — Zod schemas, types, 6 command wrappers.
- `src/lib/azdoDemo.ts` — demo data + `demoInvoke` cases; add write commands to `writeCommands`.
- `src/App.tsx` — `View` type, nav item, goto key `b`, palette action, header text, refresh scope.

---

## Phase 1 — azdo-client: Build list

### Task 1: Add a plain-text GET to `AdoClient`

Build logs are returned as `text/plain`, not JSON, so `get_json` cannot read them.

**Files:**
- Modify: `crates/azdo-client/src/client.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/azdo-client/src/client.rs`:

```rust
    #[tokio::test]
    async fn get_text_returns_plain_body() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/builds/9/logs/3"))
            .respond_with(ResponseTemplate::new(200).set_body_string("line1\nline2\nline3"))
            .mount(&server)
            .await;

        let client = test_client(&server).await;
        let body = client
            .get_text("project-1/_apis/build/builds/9/logs/3", &[])
            .await
            .unwrap();
        assert_eq!(body, "line1\nline2\nline3");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --package azdo-client get_text_returns_plain_body`
Expected: FAIL — `no method named get_text`.

- [ ] **Step 3: Implement `get_text`**

Add this method inside `impl AdoClient` in `crates/azdo-client/src/client.rs` (place it just after `get_json_from_base`). It mirrors `get_json_from_base` but returns the response body as a `String`:

```rust
    pub(crate) async fn get_text(&self, path: &str, query: &[(&str, &str)]) -> Result<String> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .get(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp.text().await?);
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }
                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        sleep(delay).await;
                        continue;
                    }
                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }
                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::Api {
                        status: status.as_u16(),
                        body,
                    });
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    sleep(self.retry_policy.backoff_delay(attempt)).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --package azdo-client get_text_returns_plain_body`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/azdo-client/src/client.rs
git commit -m "feat(azdo-client): add plain-text GET helper for build logs"
```

### Task 2: `pipelines` module structs + `list_builds`

**Files:**
- Create: `crates/azdo-client/src/pipelines.rs`
- Modify: `crates/azdo-client/src/lib.rs`

- [ ] **Step 1: Create the module file with structs and `list_builds`**

Create `crates/azdo-client/src/pipelines.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDefinitionRef {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildIdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub id: i64,
    pub build_number: Option<String>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub source_branch: Option<String>,
    pub reason: Option<String>,
    pub queue_time: Option<DateTime<Utc>>,
    pub start_time: Option<DateTime<Utc>>,
    pub finish_time: Option<DateTime<Utc>>,
    pub definition: Option<BuildDefinitionRef>,
    pub requested_for: Option<BuildIdentityRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRecord {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub record_type: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
    pub result: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub finish_time: Option<DateTime<Utc>>,
    pub log: Option<TimelineLogRef>,
    #[serde(default)]
    pub error_count: i64,
    #[serde(default)]
    pub warning_count: i64,
    pub order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLogRef {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    #[serde(default)]
    pub records: Vec<TimelineRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct BuildListCriteria {
    pub definition_id: Option<i64>,
    pub branch: Option<String>,
    pub result_filter: Option<String>,
    pub status_filter: Option<String>,
    pub requested_for: Option<String>,
    pub top: Option<u32>,
}

impl AdoClient {
    pub async fn list_builds(
        &self,
        project_id: &str,
        criteria: BuildListCriteria,
    ) -> Result<Vec<Build>> {
        let path = format!("{project_id}/_apis/build/builds");
        let mut query: Vec<(&str, String)> = vec![
            ("api-version", "7.1".to_string()),
            ("queryOrder", "queueTimeDescending".to_string()),
            ("$top", criteria.top.unwrap_or(50).to_string()),
        ];
        if let Some(definition_id) = criteria.definition_id {
            query.push(("definitions", definition_id.to_string()));
        }
        if let Some(branch) = criteria.branch.filter(|v| !v.trim().is_empty()) {
            let branch = branch.trim();
            let full = if branch.starts_with("refs/") {
                branch.to_string()
            } else {
                format!("refs/heads/{branch}")
            };
            query.push(("branchName", full));
        }
        if let Some(result) = criteria.result_filter.filter(|v| !v.trim().is_empty()) {
            query.push(("resultFilter", result));
        }
        if let Some(status) = criteria.status_filter.filter(|v| !v.trim().is_empty()) {
            query.push(("statusFilter", status));
        }
        if let Some(requested_for) = criteria.requested_for.filter(|v| !v.trim().is_empty()) {
            query.push(("requestedFor", requested_for));
        }

        let query_refs: Vec<(&str, &str)> =
            query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let response: ListResponse<Build> = self.get_json(&path, &query_refs).await?;
        Ok(response.value)
    }
}
```

- [ ] **Step 2: Make `ListResponse` reusable across modules**

`ListResponse` is currently private to `git.rs`. In `crates/azdo-client/src/git.rs`, confirm it is `pub` (it is: `pub struct ListResponse<T>`). No change needed; it is imported above via `crate::git::ListResponse`.

- [ ] **Step 3: Register the module + re-export types**

In `crates/azdo-client/src/lib.rs`, add `pub mod pipelines;` after `pub mod identity;`, and add this `pub use` block:

```rust
pub use pipelines::{
    Build, BuildDefinitionRef, BuildIdentityRef, BuildListCriteria, Timeline, TimelineLogRef,
    TimelineRecord,
};
```

- [ ] **Step 4: Write the `list_builds` test**

Add a `tests` module at the bottom of `crates/azdo-client/src/pipelines.rs`:

```rust
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn list_builds_passes_filters_as_query() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/builds"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("queryOrder", "queueTimeDescending"))
            .and(query_param("$top", "50"))
            .and(query_param("definitions", "12"))
            .and(query_param("branchName", "refs/heads/main"))
            .and(query_param("resultFilter", "failed"))
            .and(query_param("requestedFor", "user-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 101,
                    "buildNumber": "20260613.1",
                    "status": "completed",
                    "result": "failed",
                    "sourceBranch": "refs/heads/main",
                    "reason": "individualCI",
                    "queueTime": "2026-06-13T10:00:00Z",
                    "startTime": "2026-06-13T10:00:05Z",
                    "finishTime": "2026-06-13T10:03:00Z",
                    "definition": { "id": 12, "name": "CI" },
                    "requestedFor": { "id": "user-1", "displayName": "Test User" }
                }]
            })))
            .mount(&server)
            .await;

        let builds = test_client(&server)
            .await
            .list_builds(
                "project-1",
                BuildListCriteria {
                    definition_id: Some(12),
                    branch: Some("main".to_string()),
                    result_filter: Some("failed".to_string()),
                    status_filter: None,
                    requested_for: Some("user-1".to_string()),
                    top: Some(50),
                },
            )
            .await
            .unwrap();

        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].id, 101);
        assert_eq!(builds[0].result.as_deref(), Some("failed"));
        assert_eq!(builds[0].definition.as_ref().unwrap().name, "CI");
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test --package azdo-client pipelines`
Expected: PASS (`list_builds_passes_filters_as_query`).

- [ ] **Step 6: Commit**

```bash
git add crates/azdo-client/src/pipelines.rs crates/azdo-client/src/lib.rs
git commit -m "feat(azdo-client): add build list with filter criteria"
```

---

## Phase 2 — azdo-client: detail, definitions, logs, write actions

### Task 3: `get_build`, `get_build_timeline`, `list_build_definitions`

**Files:**
- Modify: `crates/azdo-client/src/pipelines.rs`

- [ ] **Step 1: Add a `BuildDefinitionRef` list response and methods**

Append to the `impl AdoClient` block in `crates/azdo-client/src/pipelines.rs`:

```rust
impl AdoClient {
    pub async fn get_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    pub async fn get_build_timeline(&self, project_id: &str, build_id: i64) -> Result<Timeline> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/Timeline");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    pub async fn list_build_definitions(
        &self,
        project_id: &str,
        name_filter: Option<&str>,
        top: u32,
    ) -> Result<Vec<BuildDefinitionRef>> {
        let path = format!("{project_id}/_apis/build/definitions");
        let top = top.to_string();
        let mut query = vec![("api-version", "7.1"), ("$top", top.as_str())];
        let name;
        if let Some(filter) = name_filter.map(str::trim).filter(|v| !v.is_empty()) {
            name = format!("*{filter}*");
            query.push(("name", name.as_str()));
        }
        let response: ListResponse<BuildDefinitionRef> =
            self.get_json(&path, &query).await?;
        Ok(response.value)
    }
}
```

> Note: a second `impl AdoClient` block in the same file is valid Rust; keep the methods grouped logically.

- [ ] **Step 2: Write tests**

Add to the `tests` module in `crates/azdo-client/src/pipelines.rs`:

```rust
    #[tokio::test]
    async fn get_build_timeline_parses_records() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/builds/101/Timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "records": [
                    {
                        "id": "stage-1", "parentId": null, "type": "Stage",
                        "name": "Build", "state": "completed", "result": "failed",
                        "errorCount": 1, "warningCount": 0, "order": 1
                    },
                    {
                        "id": "job-1", "parentId": "stage-1", "type": "Job",
                        "name": "Compile", "state": "completed", "result": "failed",
                        "log": { "id": 7 }, "errorCount": 1, "warningCount": 0, "order": 1
                    }
                ]
            })))
            .mount(&server)
            .await;

        let timeline = test_client(&server)
            .await
            .get_build_timeline("project-1", 101)
            .await
            .unwrap();

        assert_eq!(timeline.records.len(), 2);
        let job = timeline.records.iter().find(|r| r.id == "job-1").unwrap();
        assert_eq!(job.parent_id.as_deref(), Some("stage-1"));
        assert_eq!(job.log.as_ref().unwrap().id, 7);
        assert_eq!(job.error_count, 1);
    }

    #[tokio::test]
    async fn list_build_definitions_wraps_name_filter() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/definitions"))
            .and(query_param("name", "*ci*"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{ "id": 12, "name": "CI" }]
            })))
            .mount(&server)
            .await;

        let defs = test_client(&server)
            .await
            .list_build_definitions("project-1", Some("ci"), 100)
            .await
            .unwrap();
        assert_eq!(defs[0].id, 12);
    }
```

- [ ] **Step 3: Run tests**

Run: `cargo test --package azdo-client pipelines`
Expected: PASS (3 tests now).

- [ ] **Step 4: Commit**

```bash
git add crates/azdo-client/src/pipelines.rs
git commit -m "feat(azdo-client): add build detail, timeline, definitions"
```

### Task 4: log tail, `queue_build`, `cancel_build`

**Files:**
- Modify: `crates/azdo-client/src/pipelines.rs`

- [ ] **Step 1: Add log tail + write methods**

Append to an `impl AdoClient` block in `crates/azdo-client/src/pipelines.rs`:

```rust
#[derive(Debug, Clone)]
pub struct BuildLogTail {
    pub lines: Vec<String>,
    pub truncated: bool,
}

impl AdoClient {
    pub async fn get_build_log_tail(
        &self,
        project_id: &str,
        build_id: i64,
        log_id: i64,
        max_lines: usize,
    ) -> Result<BuildLogTail> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/logs/{log_id}");
        let body = self.get_text(&path, &[("api-version", "7.1")]).await?;
        let all: Vec<&str> = body.lines().collect();
        let truncated = all.len() > max_lines;
        let start = all.len().saturating_sub(max_lines);
        let lines = all[start..].iter().map(|s| s.to_string()).collect();
        Ok(BuildLogTail { lines, truncated })
    }

    pub async fn queue_build(
        &self,
        project_id: &str,
        definition_id: i64,
        source_branch: &str,
    ) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds");
        let body = json!({
            "definition": { "id": definition_id },
            "sourceBranch": source_branch,
        });
        self.post_json(&path, &[("api-version", "7.1")], &body).await
    }

    pub async fn cancel_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        let body = json!({ "status": "cancelling" });
        self.patch_json(&path, &[("api-version", "7.1")], "application/json", &body)
            .await
    }
}
```

- [ ] **Step 2: Re-export `BuildLogTail`**

In `crates/azdo-client/src/lib.rs`, add `BuildLogTail` to the `pub use pipelines::{...}` list.

- [ ] **Step 3: Write tests**

Add to the `tests` module in `crates/azdo-client/src/pipelines.rs`:

```rust
    #[tokio::test]
    async fn get_build_log_tail_returns_last_lines() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/builds/101/logs/7"))
            .respond_with(ResponseTemplate::new(200).set_body_string("a\nb\nc\nd"))
            .mount(&server)
            .await;

        let tail = test_client(&server)
            .await
            .get_build_log_tail("project-1", 101, 7, 2)
            .await
            .unwrap();
        assert_eq!(tail.lines, vec!["c".to_string(), "d".to_string()]);
        assert!(tail.truncated);
    }

    #[tokio::test]
    async fn queue_build_posts_definition_and_branch() {
        use wiremock::matchers::body_json;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/project-1/_apis/build/builds"))
            .and(body_json(serde_json::json!({
                "definition": { "id": 12 },
                "sourceBranch": "refs/heads/main"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 202, "status": "notStarted", "definition": { "id": 12, "name": "CI" }
            })))
            .mount(&server)
            .await;

        let build = test_client(&server)
            .await
            .queue_build("project-1", 12, "refs/heads/main")
            .await
            .unwrap();
        assert_eq!(build.id, 202);
    }

    #[tokio::test]
    async fn cancel_build_patches_status() {
        use wiremock::matchers::body_json;
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/project-1/_apis/build/builds/101"))
            .and(body_json(serde_json::json!({ "status": "cancelling" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 101, "status": "cancelling"
            })))
            .mount(&server)
            .await;

        let build = test_client(&server)
            .await
            .cancel_build("project-1", 101)
            .await
            .unwrap();
        assert_eq!(build.status.as_deref(), Some("cancelling"));
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test --package azdo-client pipelines`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/azdo-client/src/pipelines.rs crates/azdo-client/src/lib.rs
git commit -m "feat(azdo-client): add build log tail, queue, cancel"
```

---

## Phase 3 — src-tauri: PipelineService

### Task 5: `PipelineService` types + `list_pipeline_runs` + web URL

**Files:**
- Create: `src-tauri/src/pipelines.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod pipelines;` near other `mod` lines)

- [ ] **Step 1: Create the service file**

Create `src-tauri/src/pipelines.rs`:

```rust
use azdo_client::{AdoClient, Build, BuildListCriteria, Timeline};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, Organization};
use crate::error::Result;
use crate::projects::ProjectDirectory;
use crate::secrets::SecretStore;

const RUN_LIST_TOP: u32 = 50;
const DEFINITION_LIST_TOP: u32 = 200;
const DEFAULT_LOG_TAIL_LINES: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineRunsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: Option<i64>,
    pub branch: Option<String>,
    pub result: Option<String>,
    pub status: Option<String>,
    pub requested_for_me: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineProjectsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineDefinitionsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub name_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineRunLogTailInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
    pub log_id: i64,
    pub max_lines: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
    pub source_branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProjectOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionOption {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub build_id: i64,
    pub build_number: Option<String>,
    pub definition_id: Option<i64>,
    pub definition_name: Option<String>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub source_branch: Option<String>,
    pub reason: Option<String>,
    pub requested_for: Option<String>,
    pub queue_time: Option<String>,
    pub start_time: Option<String>,
    pub finish_time: Option<String>,
    pub web_url: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub node_type: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
    pub result: Option<String>,
    pub start_time: Option<String>,
    pub finish_time: Option<String>,
    pub log_id: Option<i64>,
    pub error_count: i64,
    pub warning_count: i64,
    pub order: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunDetail {
    pub run: PipelineRunSummary,
    pub timeline: Vec<TimelineNode>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineLogTail {
    pub lines: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct PipelineService {
    db: AppDatabase,
    secrets: SecretStore,
    projects: ProjectDirectory,
}

impl PipelineService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self {
            db,
            secrets,
            projects: ProjectDirectory::new(),
        }
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }

    pub async fn list_runs(&self, input: ListPipelineRunsInput) -> Result<Vec<PipelineRunSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let requested_for = if input.requested_for_me.unwrap_or(false) {
            organization.authenticated_user_id.clone()
        } else {
            None
        };

        let builds = client
            .list_builds(
                &project.id,
                BuildListCriteria {
                    definition_id: input.definition_id,
                    branch: input.branch,
                    result_filter: normalize_optional(input.result),
                    status_filter: normalize_optional(input.status),
                    requested_for,
                    top: Some(RUN_LIST_TOP),
                },
            )
            .await?;

        Ok(builds
            .into_iter()
            .map(|build| build_to_summary(&organization, &project.id, &project.name, build))
            .collect())
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_web_url(
    organization: &Organization,
    project_name: &str,
    build_id: i64,
) -> String {
    format!(
        "{}/{}/_build/results?buildId={}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        build_id
    )
}

fn build_to_summary(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    build: Build,
) -> PipelineRunSummary {
    let web_url = build_web_url(organization, project_name, build.id);
    let (definition_id, definition_name) = match build.definition {
        Some(def) => (Some(def.id), Some(def.name)),
        None => (None, None),
    };
    PipelineRunSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        build_id: build.id,
        build_number: build.build_number,
        definition_id,
        definition_name,
        status: build.status,
        result: build.result,
        source_branch: build.source_branch,
        reason: build.reason,
        requested_for: build.requested_for.and_then(|r| r.display_name),
        queue_time: build.queue_time.map(|t| t.to_rfc3339()),
        start_time: build.start_time.map(|t| t.to_rfc3339()),
        finish_time: build.finish_time.map(|t| t.to_rfc3339()),
        web_url,
    }
}

fn timeline_to_nodes(timeline: Timeline) -> Vec<TimelineNode> {
    timeline
        .records
        .into_iter()
        .map(|record| TimelineNode {
            id: record.id,
            parent_id: record.parent_id,
            node_type: record.record_type,
            name: record.name,
            state: record.state,
            result: record.result,
            start_time: record.start_time.map(|t| t.to_rfc3339()),
            finish_time: record.finish_time.map(|t| t.to_rfc3339()),
            log_id: record.log.map(|l| l.id),
            error_count: record.error_count,
            warning_count: record.warning_count,
            order: record.order,
        })
        .collect()
}
```

> `encode_path_segment` is already `pub(crate)` in `src-tauri/src/commits.rs:220` and is imported above.

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add `mod pipelines;` alongside the other `mod` declarations (after `mod orgs;`).

- [ ] **Step 3: Write the unit test**

Add to the bottom of `src-tauri/src/pipelines.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Organization {
        Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso/".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            created_at: "2026-06-13T00:00:00Z".to_string(),
            updated_at: "2026-06-13T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn build_web_url_encodes_project_and_trims_slash() {
        assert_eq!(
            build_web_url(&org(), "Platform Team", 101),
            "https://dev.azure.com/contoso/Platform%20Team/_build/results?buildId=101"
        );
    }

    #[test]
    fn normalize_optional_drops_blank() {
        assert_eq!(normalize_optional(Some("  ".to_string())), None);
        assert_eq!(
            normalize_optional(Some(" failed ".to_string())),
            Some("failed".to_string())
        );
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --package azdodeck pipelines` (the `src-tauri` package name is `azdodeck`; if unsure run `cargo test --workspace pipelines`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pipelines.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add PipelineService with run listing"
```

### Task 6: remaining service methods (projects, definitions, detail, log, rerun, cancel)

**Files:**
- Modify: `src-tauri/src/pipelines.rs`

- [ ] **Step 1: Add the methods to `impl PipelineService`**

Insert these methods inside `impl PipelineService` (after `list_runs`):

```rust
    pub async fn list_projects(
        &self,
        input: ListPipelineProjectsInput,
    ) -> Result<Vec<PipelineProjectOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let projects = self.projects.list(&client, &organization.id).await?;
        let mut options: Vec<PipelineProjectOption> = projects
            .into_iter()
            .map(|p| PipelineProjectOption {
                id: p.id,
                name: p.name,
            })
            .collect();
        options.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(options)
    }

    pub async fn list_definitions(
        &self,
        input: ListPipelineDefinitionsInput,
    ) -> Result<Vec<PipelineDefinitionOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let defs = client
            .list_build_definitions(
                &input.project_id,
                input.name_filter.as_deref(),
                DEFINITION_LIST_TOP,
            )
            .await?;
        let mut options: Vec<PipelineDefinitionOption> = defs
            .into_iter()
            .map(|d| PipelineDefinitionOption {
                id: d.id,
                name: d.name,
            })
            .collect();
        options.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(options)
    }

    pub async fn get_run(&self, input: GetPipelineRunInput) -> Result<PipelineRunDetail> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client.get_build(&project.id, input.build_id).await?;
        let timeline = client
            .get_build_timeline(&project.id, input.build_id)
            .await
            .unwrap_or(Timeline { records: vec![] });
        Ok(PipelineRunDetail {
            run: build_to_summary(&organization, &project.id, &project.name, build),
            timeline: timeline_to_nodes(timeline),
        })
    }

    pub async fn get_run_log_tail(
        &self,
        input: GetPipelineRunLogTailInput,
    ) -> Result<PipelineLogTail> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let max_lines = input.max_lines.unwrap_or(DEFAULT_LOG_TAIL_LINES).clamp(1, 2000);
        let tail = client
            .get_build_log_tail(&input.project_id, input.build_id, input.log_id, max_lines)
            .await?;
        Ok(PipelineLogTail {
            lines: tail.lines,
            truncated: tail.truncated,
        })
    }

    pub async fn rerun_run(&self, input: RerunPipelineRunInput) -> Result<PipelineRunSummary> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client
            .queue_build(&project.id, input.definition_id, &input.source_branch)
            .await?;
        Ok(build_to_summary(&organization, &project.id, &project.name, build))
    }

    pub async fn cancel_run(&self, input: CancelPipelineRunInput) -> Result<PipelineRunSummary> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client.cancel_build(&project.id, input.build_id).await?;
        Ok(build_to_summary(&organization, &project.id, &project.name, build))
    }
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cargo build --package azdodeck`
Expected: success (no test yet for these; they are exercised via IPC + frontend tests). The compiler verifies all client method signatures line up.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pipelines.rs
git commit -m "feat(tauri): add pipeline detail, definitions, log, rerun, cancel"
```

---

## Phase 4 — IPC wiring

### Task 7: Register commands and `PipelineService` in `AppState`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Import the service types**

Add near the other `use` imports in `src-tauri/src/lib.rs`:

```rust
use pipelines::{
    CancelPipelineRunInput, GetPipelineRunInput, GetPipelineRunLogTailInput,
    ListPipelineDefinitionsInput, ListPipelineProjectsInput, ListPipelineRunsInput,
    PipelineDefinitionOption, PipelineLogTail, PipelineProjectOption, PipelineRunDetail,
    PipelineRunSummary, PipelineService, RerunPipelineRunInput,
};
```

- [ ] **Step 2: Add the field to `AppState`**

In the `struct AppState { ... }` definition add:

```rust
    pipelines: PipelineService,
```

And in the `app.manage(AppState { ... })` block in `run()` add:

```rust
                pipelines: PipelineService::new(db.clone(), SecretStore),
```

- [ ] **Step 3: Add the six command functions**

Add near the other `#[tauri::command]` functions in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_pipeline_projects(
    input: ListPipelineProjectsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineProjectOption>> {
    state.pipelines.list_projects(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_pipeline_runs(
    input: ListPipelineRunsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineRunSummary>> {
    state.pipelines.list_runs(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_pipeline_definitions(
    input: ListPipelineDefinitionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineDefinitionOption>> {
    state.pipelines.list_definitions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_pipeline_run(
    input: GetPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunDetail> {
    state.pipelines.get_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_pipeline_run_log_tail(
    input: GetPipelineRunLogTailInput,
    state: State<'_, AppState>,
) -> Result<PipelineLogTail> {
    state.pipelines.get_run_log_tail(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn rerun_pipeline_run(
    input: RerunPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunSummary> {
    ensure_write_enabled(&state)?;
    state.pipelines.rerun_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn cancel_pipeline_run(
    input: CancelPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunSummary> {
    ensure_write_enabled(&state)?;
    state.pipelines.cancel_run(input).await
}
```

- [ ] **Step 4: Register in `generate_handler!`**

Add these names to the `tauri::generate_handler![ ... ]` list (before `trigger_sync`):

```rust
            list_pipeline_projects,
            list_pipeline_runs,
            list_pipeline_definitions,
            get_pipeline_run,
            get_pipeline_run_log_tail,
            rerun_pipeline_run,
            cancel_pipeline_run,
```

- [ ] **Step 5: Verify the whole workspace compiles + tests pass**

Run: `cargo test --workspace`
Expected: PASS (all existing + new tests).
Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): register pipeline IPC commands"
```

---

## Phase 5 — Frontend command layer

### Task 8: Zod schemas, types, and command wrappers

**Files:**
- Modify: `src/lib/azdoCommands.ts`

- [ ] **Step 1: Add schemas + types**

Add to `src/lib/azdoCommands.ts` (after the commit schemas, near line ~150):

```ts
const pipelineProjectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const pipelineProjectOptionsSchema = z.array(pipelineProjectOptionSchema);
export type PipelineProjectOption = z.infer<typeof pipelineProjectOptionSchema>;

const pipelineDefinitionOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
const pipelineDefinitionOptionsSchema = z.array(pipelineDefinitionOptionSchema);
export type PipelineDefinitionOption = z.infer<typeof pipelineDefinitionOptionSchema>;

const pipelineRunSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  buildId: z.number(),
  buildNumber: z.string().nullable(),
  definitionId: z.number().nullable(),
  definitionName: z.string().nullable(),
  status: z.string().nullable(),
  result: z.string().nullable(),
  sourceBranch: z.string().nullable(),
  reason: z.string().nullable(),
  requestedFor: z.string().nullable(),
  queueTime: z.string().nullable(),
  startTime: z.string().nullable(),
  finishTime: z.string().nullable(),
  webUrl: z.string(),
});
const pipelineRunSummariesSchema = z.array(pipelineRunSummarySchema);
export type PipelineRunSummary = z.infer<typeof pipelineRunSummarySchema>;

const timelineNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  nodeType: z.string().nullable(),
  name: z.string().nullable(),
  state: z.string().nullable(),
  result: z.string().nullable(),
  startTime: z.string().nullable(),
  finishTime: z.string().nullable(),
  logId: z.number().nullable(),
  errorCount: z.number(),
  warningCount: z.number(),
  order: z.number().nullable(),
});
export type TimelineNode = z.infer<typeof timelineNodeSchema>;

const pipelineRunDetailSchema = z.object({
  run: pipelineRunSummarySchema,
  timeline: z.array(timelineNodeSchema),
});
export type PipelineRunDetail = z.infer<typeof pipelineRunDetailSchema>;

const pipelineLogTailSchema = z.object({
  lines: z.array(z.string()),
  truncated: z.boolean(),
});
export type PipelineLogTail = z.infer<typeof pipelineLogTailSchema>;

export type ListPipelineRunsInput = {
  organizationId?: string;
  projectId: string;
  definitionId?: number;
  branch?: string;
  result?: string;
  status?: string;
  requestedForMe?: boolean;
};
```

- [ ] **Step 2: Add the wrapper functions**

Add near the commit wrappers (after `listCommitRepositories`, ~line 966):

```ts
export async function listPipelineProjects(input: {
  organizationId?: string;
}): Promise<PipelineProjectOption[]> {
  const result = await invokeCommand("list_pipeline_projects", { input });
  return pipelineProjectOptionsSchema.parse(result);
}

export async function listPipelineRuns(
  input: ListPipelineRunsInput,
): Promise<PipelineRunSummary[]> {
  const result = await invokeCommand("list_pipeline_runs", { input });
  return pipelineRunSummariesSchema.parse(result);
}

export async function listPipelineDefinitions(input: {
  organizationId?: string;
  projectId: string;
  nameFilter?: string;
}): Promise<PipelineDefinitionOption[]> {
  const result = await invokeCommand("list_pipeline_definitions", { input });
  return pipelineDefinitionOptionsSchema.parse(result);
}

export async function getPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
}): Promise<PipelineRunDetail> {
  const result = await invokeCommand("get_pipeline_run", { input });
  return pipelineRunDetailSchema.parse(result);
}

export async function getPipelineRunLogTail(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
  logId: number;
  maxLines?: number;
}): Promise<PipelineLogTail> {
  const result = await invokeCommand("get_pipeline_run_log_tail", { input });
  return pipelineLogTailSchema.parse(result);
}

export async function rerunPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  definitionId: number;
  sourceBranch: string;
}): Promise<PipelineRunSummary> {
  const result = await invokeCommand("rerun_pipeline_run", { input });
  return pipelineRunSummarySchema.parse(result);
}

export async function cancelPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
}): Promise<PipelineRunSummary> {
  const result = await invokeCommand("cancel_pipeline_run", { input });
  return pipelineRunSummarySchema.parse(result);
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (demo cases come next; `demoInvoke` falls through to a default for now — verify the default behavior does not throw at compile time; runtime is covered in Task 9).

- [ ] **Step 4: Commit**

```bash
git add src/lib/azdoCommands.ts
git commit -m "feat(frontend): add pipeline command wrappers and schemas"
```

### Task 9: Demo data + write-command gating

**Files:**
- Modify: `src/lib/azdoDemo.ts`

- [ ] **Step 1: Add demo builders near the other demo functions**

Add to `src/lib/azdoDemo.ts` (above `export async function demoInvoke`):

```ts
function demoPipelineProjects() {
  return [
    { id: "demo-project", name: "Demo Project" },
    { id: "demo-tools", name: "Tooling" },
  ];
}

function demoPipelineDefinitions() {
  return [
    { id: 1, name: "CI" },
    { id: 2, name: "Nightly" },
  ];
}

function demoPipelineRuns() {
  return [
    {
      organizationId: "demo-org",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1001,
      buildNumber: "20260613.3",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "succeeded",
      sourceBranch: "refs/heads/main",
      reason: "individualCI",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T09:00:00Z",
      startTime: "2026-06-13T09:00:05Z",
      finishTime: "2026-06-13T09:04:00Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1001",
    },
    {
      organizationId: "demo-org",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1002,
      buildNumber: "20260613.4",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "failed",
      sourceBranch: "refs/heads/feature/login",
      reason: "pullRequest",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T10:00:00Z",
      startTime: "2026-06-13T10:00:05Z",
      finishTime: "2026-06-13T10:02:30Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1002",
    },
    {
      organizationId: "demo-org",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1003,
      buildNumber: "20260613.5",
      definitionId: 2,
      definitionName: "Nightly",
      status: "inProgress",
      result: null,
      sourceBranch: "refs/heads/main",
      reason: "schedule",
      requestedFor: "Scheduler",
      queueTime: "2026-06-13T11:00:00Z",
      startTime: "2026-06-13T11:00:05Z",
      finishTime: null,
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1003",
    },
  ];
}

function demoPipelineRunDetail(buildId: number) {
  const runs = demoPipelineRuns();
  const run = runs.find((r) => r.buildId === buildId) ?? runs[0];
  return {
    run,
    timeline: [
      {
        id: "stage-1",
        parentId: null,
        nodeType: "Stage",
        name: "Build",
        state: "completed",
        result: run.result ?? "succeeded",
        startTime: run.startTime,
        finishTime: run.finishTime,
        logId: null,
        errorCount: run.result === "failed" ? 1 : 0,
        warningCount: 0,
        order: 1,
      },
      {
        id: "job-1",
        parentId: "stage-1",
        nodeType: "Job",
        name: "Compile",
        state: "completed",
        result: run.result ?? "succeeded",
        startTime: run.startTime,
        finishTime: run.finishTime,
        logId: 7,
        errorCount: run.result === "failed" ? 1 : 0,
        warningCount: 0,
        order: 1,
      },
    ],
  };
}
```

- [ ] **Step 2: Add `demoInvoke` cases**

Inside the `switch` in `demoInvoke` in `src/lib/azdoDemo.ts`, add:

```ts
    case "list_pipeline_projects":
      return demoPipelineProjects();
    case "list_pipeline_definitions":
      return demoPipelineDefinitions();
    case "list_pipeline_runs":
      return demoPipelineRuns();
    case "get_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return demoPipelineRunDetail(input?.buildId ?? 1001);
    }
    case "get_pipeline_run_log_tail":
      return {
        lines: ["[command] npm run build", "ERROR: build failed (exit 1)"],
        truncated: false,
      };
    case "rerun_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return { ...demoPipelineRuns()[0], buildId: input?.buildId ?? 1004, status: "notStarted", result: null };
    }
    case "cancel_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      const run = demoPipelineRuns().find((r) => r.buildId === input?.buildId) ?? demoPipelineRuns()[2];
      return { ...run, status: "cancelling" };
    }
```

- [ ] **Step 3: Gate the write commands**

Find the `writeCommands` set in `src/lib/azdoDemo.ts` and add `"rerun_pipeline_run"` and `"cancel_pipeline_run"` so read-only validation mode blocks them in demo too.

- [ ] **Step 4: Type-check + run TS tests**

Run: `pnpm tsc --noEmit`
Expected: PASS.
Run: `pnpm test -- --run`
Expected: PASS (existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/azdoDemo.ts
git commit -m "feat(frontend): add pipeline demo data and write gating"
```

---

## Phase 6 — Frontend view

### Task 10: status/result badge mapping

**Files:**
- Create: `src/features/pipelines/pipelineStatus.ts`
- Test: `src/features/pipelines/pipelineStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/pipelines/pipelineStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pipelineRunVisual, isInProgressStatus } from "./pipelineStatus";

describe("pipelineRunVisual", () => {
  it("labels a failed completed run", () => {
    const v = pipelineRunVisual("completed", "failed");
    expect(v.label).toBe("Failed");
    expect(v.tone).toBe("error");
  });

  it("labels an in-progress run regardless of result", () => {
    const v = pipelineRunVisual("inProgress", null);
    expect(v.label).toBe("Running");
    expect(v.tone).toBe("active");
  });

  it("detects in-progress statuses", () => {
    expect(isInProgressStatus("inProgress")).toBe(true);
    expect(isInProgressStatus("notStarted")).toBe(true);
    expect(isInProgressStatus("completed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- --run src/features/pipelines/pipelineStatus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/pipelines/pipelineStatus.ts`:

```ts
export type RunTone = "success" | "error" | "warning" | "active" | "neutral" | "canceled";

export type RunVisual = { label: string; tone: RunTone };

const IN_PROGRESS = new Set(["inprogress", "notstarted", "postponed", "cancelling"]);

export function isInProgressStatus(status: string | null | undefined): boolean {
  return !!status && IN_PROGRESS.has(status.toLowerCase());
}

export function pipelineRunVisual(
  status: string | null | undefined,
  result: string | null | undefined,
): RunVisual {
  const s = (status ?? "").toLowerCase();
  if (s === "cancelling") return { label: "Cancelling", tone: "canceled" };
  if (s && s !== "completed" && s !== "none") return { label: "Running", tone: "active" };
  switch ((result ?? "").toLowerCase()) {
    case "succeeded":
      return { label: "Succeeded", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "error" };
    case "partiallysucceeded":
      return { label: "Partial", tone: "warning" };
    case "canceled":
      return { label: "Canceled", tone: "canceled" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- --run src/features/pipelines/pipelineStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/pipelines/pipelineStatus.ts src/features/pipelines/pipelineStatus.test.ts
git commit -m "feat(frontend): add pipeline run status visual mapping"
```

### Task 11: `PipelinesView` shell, selectors, filters, run list, auto-refresh

**Files:**
- Create: `src/features/pipelines/PipelinesView.tsx`

**Layout reference:** Mirror the shell of `src/features/commits/CommitSearch.tsx` — same `organizations` prop, org/project `<select>` controls, `LoadingState`/`ErrorState` from `@/components/StateDisplay`, the local windowing/virtualization pattern used by the grids, and the focus/keyboard data attributes (`data-primary-grid`, etc.). Read that file first and match its styling and structure.

- [ ] **Step 1: Implement the view**

Create `src/features/pipelines/PipelinesView.tsx` with:

- Props: `{ organizations: Organization[] }`.
- Local state: `organizationId` (default first org), `projectId`, `definitionId | null`, `branch` (text), `result` (`"" | "failed" | "succeeded" | "partiallySucceeded" | "canceled"`), `statusFilter` (`"" | "inProgress" | "completed"`), `requestedForMe` (bool), `selectedBuildId | null`.
- Queries (TanStack Query):

```tsx
const projectsQuery = useQuery({
  queryKey: ["pipelineProjects", organizationId],
  queryFn: () => listPipelineProjects({ organizationId }),
  enabled: !!organizationId,
  staleTime: 5 * 60_000,
});

const definitionsQuery = useQuery({
  queryKey: ["pipelineDefinitions", organizationId, projectId],
  queryFn: () => listPipelineDefinitions({ organizationId, projectId }),
  enabled: !!organizationId && !!projectId,
  staleTime: 5 * 60_000,
});

const runsQuery = useQuery({
  queryKey: [
    "pipelineRuns",
    organizationId,
    projectId,
    definitionId,
    branch,
    result,
    statusFilter,
    requestedForMe,
  ],
  queryFn: () =>
    listPipelineRuns({
      organizationId,
      projectId,
      definitionId: definitionId ?? undefined,
      branch: branch.trim() || undefined,
      result: result || undefined,
      status: statusFilter || undefined,
      requestedForMe: requestedForMe || undefined,
    }),
  enabled: !!organizationId && !!projectId,
  placeholderData: keepPreviousData,
  refetchInterval: (query) => {
    const data = query.state.data as PipelineRunSummary[] | undefined;
    return data?.some((r) => isInProgressStatus(r.status)) ? 15_000 : false;
  },
});
```

- Render:
  - Top control row: org `<select>` (hidden when single org, same rule as CommitSearch), project `<select>` (from `projectsQuery`), definition `<select>` (All + names), branch text input, result `<select>`, status `<select>`, "Mine only" checkbox (disabled with title when the selected org has no `authenticatedUserId`; read it from the `organizations` prop), and a manual refresh button calling `runsQuery.refetch()`.
  - When no `projectId`: show a hint "Select a project to load pipeline runs."
  - Run grid (virtualized, mirror CommitSearch windowing): columns = status badge (use `pipelineRunVisual`), definition name, build number, branch (strip `refs/heads/`), reason, requestedFor, queued (relative time — reuse the existing relative-time helper used by other grids; if none, format with `new Date(...).toLocaleString()`), duration (finishTime−startTime, blank if running). Row click sets `selectedBuildId`.
  - Right detail pane: render `<PipelineRunDetailPanel organizationId={organizationId} projectId={projectId} buildId={selectedBuildId} />` (Task 12) when a row is selected; otherwise an empty-state hint.
- Reset `selectedBuildId` to `null` when `projectId` changes.

> Keep imports limited to what is used. Pull `keepPreviousData` and `useQuery` from `@tanstack/react-query`; pull the command wrappers + `isInProgressStatus`/`pipelineRunVisual` + types from the new modules.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS (component compiles; `PipelineRunDetailPanel` import will fail until Task 12 — implement Task 12 before running tests, OR temporarily stub the panel. Prefer doing Task 12 next, then type-check).

- [ ] **Step 3: Commit** (after Task 12 compiles cleanly; if committing now, include a minimal stub panel — recommended to defer commit to Task 12)

### Task 12: `PipelineRunDetailPanel` — timeline tree, log tail, actions

**Files:**
- Create: `src/features/pipelines/PipelineRunDetailPanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `src/features/pipelines/PipelineRunDetailPanel.tsx` with:

- Props: `{ organizationId: string; projectId: string; buildId: number; onChanged?: () => void }`.
- Detail query:

```tsx
const runQuery = useQuery({
  queryKey: ["pipelineRun", organizationId, projectId, buildId],
  queryFn: () => getPipelineRun({ organizationId, projectId, buildId }),
  enabled: !!buildId,
  refetchInterval: (query) => {
    const data = query.state.data as PipelineRunDetail | undefined;
    return data && isInProgressStatus(data.run.status) ? 15_000 : false;
  },
});
```

- App settings query to detect read-only mode:

```tsx
const appSettingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings, staleTime: 5 * 60_000 });
const readOnly = appSettingsQuery.data?.readOnlyValidationModeEnabled ?? false;
```

- Timeline tree: build a parent→children map from `timeline` nodes (root = `parentId == null`), sort each level by `order ?? 0`, render Stage → Job (collapsible `<details>` is acceptable). Each node shows `pipelineRunVisual(node.state, node.result)` badge (note: pass `node.state` as status), name, duration, and `errorCount`/`warningCount` when > 0.
- Selecting a node that has a non-null `logId` triggers a log-tail query:

```tsx
const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
const logQuery = useQuery({
  queryKey: ["pipelineRunLog", organizationId, projectId, buildId, selectedLogId],
  queryFn: () => getPipelineRunLogTail({ organizationId, projectId, buildId, logId: selectedLogId as number }),
  enabled: selectedLogId != null,
});
```

  Render the lines in a `<pre>` monospace block; if `truncated`, show "showing last 200 lines" and a "full log in Azure DevOps" link to `run.webUrl`.
- Header: definition name, build number, `pipelineRunVisual(run.status, run.result)` badge, branch, reason, requestedFor, queued/started/finished, duration, "Open in Azure DevOps" (use `openExternalUrl(run.webUrl)`).
- Mutations + actions:

```tsx
const queryClient = useQueryClient();
const rerun = useMutation({
  mutationFn: () =>
    rerunPipelineRun({
      organizationId,
      projectId,
      definitionId: runQuery.data!.run.definitionId as number,
      sourceBranch: runQuery.data!.run.sourceBranch as string,
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["pipelineRuns", organizationId, projectId] });
    onChanged?.();
  },
});
const cancel = useMutation({
  mutationFn: () => cancelPipelineRun({ organizationId, projectId, buildId }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["pipelineRun", organizationId, projectId, buildId] });
    void queryClient.invalidateQueries({ queryKey: ["pipelineRuns", organizationId, projectId] });
  },
});
```

  - "Re-run" button: enabled only when `run.definitionId != null && run.sourceBranch != null` and `!readOnly`. On click show a `window.confirm` with the exact text: `` `Queue a new run of ${run.definitionName} on ${shortBranch}?` ``. When `readOnly`, render the button disabled with `title="Read-only validation mode is enabled"`.
  - "Cancel" button: shown only when `isInProgressStatus(run.status)`; enabled when `!readOnly`; confirm with `Cancel this run?`.
  - Surface mutation errors via `commandErrorMessage`.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/pipelines/PipelinesView.tsx src/features/pipelines/PipelineRunDetailPanel.tsx
git commit -m "feat(frontend): add Pipelines view and run detail panel"
```

---

## Phase 7 — App integration

### Task 13: Nav, routing, goto key, palette, refresh scope

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the lazy import + View type**

Near the other `lazy(() => import(...))` blocks in `src/App.tsx`:

```tsx
const PipelinesView = lazy(() =>
  import("@/features/pipelines/PipelinesView").then((m) => ({ default: m.PipelinesView })),
);
```

Add `"pipelines"` to the `type View = ...` union.

- [ ] **Step 2: Nav item**

Import an icon (`GitBranch` from `lucide-react`). After the `Commits` `NavButton`, add:

```tsx
            <NavButton
              active={activeView === "pipelines"}
              disabled={organizations.length === 0}
              icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
              label="Pipelines"
              onClick={() => setView("pipelines")}
            />
```

- [ ] **Step 3: Goto key + palette action**

In `GOTO_VIEW_KEYS` add `b: "pipelines",`.
In `commandActions`, add (in the Navigation group):

```tsx
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.pipelines",
      keywords: ["build", "ci", "pipeline"],
      label: "Go to Pipelines",
      run: () => setView("pipelines"),
    },
```

- [ ] **Step 4: Header text + render branch**

In the header title ternary add `activeView === "pipelines" ? "Pipelines"`, and a matching subtitle `"Azure DevOps build runs by project"`.
In the main content render chain add (after the `commits` branch):

```tsx
          ) : activeView === "pipelines" ? (
            <PipelinesView organizations={organizations} />
```

- [ ] **Step 5: Refresh scope**

`pipelines` uses live queries, not background sync. In `currentViewSyncScope()` leave the default (`"myReviews"`) untouched, but make `Ctrl+R` / "Refresh current view" trigger a query refetch for pipelines instead of a sync: in `refreshCurrentView()`, when `activeView === "pipelines"`, call `queryClient.invalidateQueries({ queryKey: ["pipelineRuns"] })` and return early before the `syncMutation`.

```tsx
  function refreshCurrentView(): void {
    if (activeView === "pipelines") {
      void queryClient.invalidateQueries({ queryKey: ["pipelineRuns"] });
      return;
    }
    if (organizations.length > 0 && !syncMutation.isPending) {
      syncMutation.mutate({ scope: currentViewSyncScope() });
    }
  }
```

- [ ] **Step 6: Type-check + run TS tests**

Run: `pnpm tsc --noEmit`
Expected: PASS.
Run: `pnpm test -- --run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): wire Pipelines view into navigation"
```

---

## Phase 8 — Frontend behavior test + final verification

### Task 14: `PipelinesView` focused test

**Files:**
- Create: `src/features/pipelines/PipelinesView.test.tsx`

**Reference:** Mirror the setup of an existing feature test that renders a view with a `QueryClientProvider` and the demo runtime (e.g., look at `src/App.test.tsx` or an existing grid test for the provider/wrapper pattern). The app uses the browser demo path when `isTauriRuntime()` is false, so demo data flows automatically.

- [ ] **Step 1: Write the test**

Create `src/features/pipelines/PipelinesView.test.tsx` covering:
1. Renders runs after selecting a project: select `Demo Project`, assert a row with build number `20260613.4` and a `Failed` badge appears.
2. Read-only gating: with `readOnlyValidationModeEnabled` demo setting on, opening a failed run shows a disabled "Re-run" button (assert `disabled`).

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PipelinesView } from "./PipelinesView";

const organizations = [
  {
    id: "demo-org",
    name: "demo-org",
    displayName: "Demo Org",
    baseUrl: "https://dev.azure.com/demo-org",
    authProvider: "pat",
    credentialKey: "k",
    authenticatedUserId: "user-1",
    authenticatedUserDisplayName: "Demo User",
    authenticatedUserUniqueName: "demo@example.com",
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
];

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelinesView organizations={organizations as never} />
    </QueryClientProvider>,
  );
}

describe("PipelinesView", () => {
  it("lists runs for a selected project", async () => {
    renderView();
    // project select defaults or pick the demo project, then assert a run row.
    await waitFor(() => expect(screen.getByText(/20260613\.4/)).toBeInTheDocument());
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
```

> Adjust the project-selection step to match the actual control (if the view auto-selects the first project, no interaction is needed). If `requestedForMe`/project default differs, set it explicitly via `fireEvent.change` on the project `<select>`.

- [ ] **Step 2: Run the test**

Run: `pnpm test -- --run src/features/pipelines/PipelinesView.test.tsx`
Expected: PASS. Fix selectors/interactions until green.

- [ ] **Step 3: Commit**

```bash
git add src/features/pipelines/PipelinesView.test.tsx
git commit -m "test(frontend): cover Pipelines view run listing"
```

### Task 15: Full verification pass

- [ ] **Step 1: Backend**

Run: `cargo test --workspace`
Expected: PASS.
Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.
Run: `cargo fmt --all --check`
Expected: clean (run `cargo fmt --all` if not).

- [ ] **Step 2: Frontend**

Run: `pnpm tsc --noEmit`
Expected: PASS.
Run: `pnpm test -- --run`
Expected: PASS.

- [ ] **Step 3: Manual demo smoke (browser)**

Run: `pnpm dev`, open the app, go to Pipelines, select the demo project. Confirm: runs list with status badges, click a failed run → timeline shows Build/Compile, click the Compile job → log tail appears, "Re-run" prompts a confirm. Toggle read-only mode in Settings → "Re-run"/"Cancel" become disabled.

- [ ] **Step 4: Final commit (if any formatting/fixups)**

```bash
git add -A
git commit -m "chore: pipelines monitoring view verification fixups"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** list runs (Task 5), filters (Task 11), timeline + failed-job log tail (Tasks 3/4/12), re-run/cancel with confirm + `ensure_write_enabled` + read-only gating (Tasks 7/12), auto-refresh 15s (Tasks 11/12), nav `b` + palette (Task 13), live fetch / no cache (service has no DB writes), web URL built locally (Task 5), error handling via `AppError` (inherited), tests across all layers (Tasks 1–14).
- **Out of scope confirmed unbuilt:** Releases/environments/approvals, manual queue with params, stage-only retry, background sync, build-failed notifications, PR-row build status.
- **Type consistency:** Rust `definition_id: Option<i64>` ↔ TS `definitionId: number | null`; `TimelineNode.node_type` (Rust `node_type` via serde `nodeType`) ↔ TS `nodeType`; status/result are nullable strings throughout. `requestedForMe` is the only camelCase bool input.
- **Open dependency:** `ListResponse<T>` must be `pub` in `git.rs` (it is). `encode_path_segment` is `pub(crate)` in `commits.rs` (it is).
