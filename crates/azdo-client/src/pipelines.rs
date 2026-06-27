use std::collections::HashMap;

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

/// A build definition's trigger and variable configuration, as parsed from
/// `GET .../_apis/build/definitions/{id}`. Variables arrive as an unordered
/// map in the API; we flatten them into a sorted `Vec` for stable display.
#[derive(Debug, Clone)]
pub struct BuildDefinitionDetail {
    pub id: i64,
    pub name: String,
    pub triggers: Vec<DefinitionTrigger>,
    pub variables: Vec<DefinitionVariable>,
}

#[derive(Debug, Clone)]
pub struct DefinitionTrigger {
    pub trigger_type: Option<String>,
    pub branch_filters: Vec<String>,
    pub path_filters: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DefinitionVariable {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
    pub allow_override: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBuildDefinition {
    id: i64,
    name: String,
    #[serde(default)]
    triggers: Vec<RawTrigger>,
    #[serde(default)]
    variables: HashMap<String, RawVariable>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTrigger {
    trigger_type: Option<String>,
    #[serde(default)]
    branch_filters: Vec<String>,
    #[serde(default)]
    path_filters: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVariable {
    value: Option<String>,
    #[serde(default)]
    is_secret: bool,
    #[serde(default)]
    allow_override: bool,
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
pub struct BuildArtifactResource {
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildArtifact {
    pub name: String,
    pub resource: Option<BuildArtifactResource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLogRef {
    pub id: i64,
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

#[derive(Debug, Clone)]
pub struct BuildLogTail {
    pub lines: Vec<String>,
    pub truncated: bool,
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

        let query_refs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let response: ListResponse<Build> = self.get_json(&path, &query_refs).await?;
        Ok(response.value)
    }

    pub async fn get_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    pub async fn list_build_artifacts(
        &self,
        project_id: &str,
        build_id: i64,
    ) -> Result<Vec<BuildArtifact>> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/artifacts");
        let response: ListResponse<BuildArtifact> =
            self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(response.value)
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
        let response: ListResponse<BuildDefinitionRef> = self.get_json(&path, &query).await?;
        Ok(response.value)
    }

    pub async fn get_build_definition(
        &self,
        project_id: &str,
        definition_id: i64,
    ) -> Result<BuildDefinitionDetail> {
        let path = format!("{project_id}/_apis/build/definitions/{definition_id}");
        let raw: RawBuildDefinition = self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(build_definition_detail(raw))
    }

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
        self.post_json(&path, &[("api-version", "7.1")], &body)
            .await
    }

    pub async fn cancel_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        let body = json!({ "status": "cancelling" });
        self.patch_json(&path, &[("api-version", "7.1")], "application/json", &body)
            .await
    }
}

fn build_definition_detail(raw: RawBuildDefinition) -> BuildDefinitionDetail {
    let triggers = raw
        .triggers
        .into_iter()
        .map(|trigger| DefinitionTrigger {
            trigger_type: trigger.trigger_type,
            branch_filters: trigger.branch_filters,
            path_filters: trigger.path_filters,
        })
        .collect();
    let mut variables: Vec<DefinitionVariable> = raw
        .variables
        .into_iter()
        .map(|(name, variable)| DefinitionVariable {
            name,
            value: variable.value,
            is_secret: variable.is_secret,
            allow_override: variable.allow_override,
        })
        .collect();
    variables.sort_by(|a, b| a.name.cmp(&b.name));
    BuildDefinitionDetail {
        id: raw.id,
        name: raw.name,
        triggers,
        variables,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_json, method, path, query_param};
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
    async fn list_build_artifacts_maps_download_urls() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/builds/101/artifacts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 1,
                    "name": "drop",
                    "resource": { "type": "Container", "downloadUrl": "https://dev.azure.com/x/drop.zip" }
                }]
            })))
            .mount(&server)
            .await;

        let artifacts = test_client(&server)
            .await
            .list_build_artifacts("project-1", 101)
            .await
            .unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].name, "drop");
        assert_eq!(
            artifacts[0]
                .resource
                .as_ref()
                .unwrap()
                .download_url
                .as_deref(),
            Some("https://dev.azure.com/x/drop.zip")
        );
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

    #[tokio::test]
    async fn get_build_definition_parses_triggers_and_sorts_variables() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/build/definitions/12"))
            .and(query_param("api-version", "7.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 12,
                "name": "CI",
                "triggers": [
                    {
                        "triggerType": "continuousIntegration",
                        "branchFilters": ["+refs/heads/main"],
                        "pathFilters": []
                    },
                    {
                        "triggerType": "schedule"
                    }
                ],
                "variables": {
                    "Zeta": { "value": "last", "allowOverride": true },
                    "Alpha": { "value": "first" },
                    "ApiKey": { "isSecret": true }
                }
            })))
            .mount(&server)
            .await;

        let detail = test_client(&server)
            .await
            .get_build_definition("project-1", 12)
            .await
            .unwrap();

        assert_eq!(detail.id, 12);
        assert_eq!(detail.triggers.len(), 2);
        assert_eq!(
            detail.triggers[0].trigger_type.as_deref(),
            Some("continuousIntegration")
        );
        assert_eq!(detail.triggers[0].branch_filters, vec!["+refs/heads/main"]);
        assert_eq!(detail.triggers[1].trigger_type.as_deref(), Some("schedule"));

        // Variables are sorted by name regardless of map order.
        let names: Vec<&str> = detail.variables.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "ApiKey", "Zeta"]);

        let secret = detail
            .variables
            .iter()
            .find(|v| v.name == "ApiKey")
            .unwrap();
        assert!(secret.is_secret);
        assert_eq!(secret.value, None);

        let overridable = detail.variables.iter().find(|v| v.name == "Zeta").unwrap();
        assert!(overridable.allow_override);
    }

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
}
