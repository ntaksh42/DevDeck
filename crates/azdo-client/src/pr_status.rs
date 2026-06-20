use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

/// A single status check posted against a pull request (CI builds, branch
/// policies, and custom integrations all surface here).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusCheck {
    /// `succeeded` | `failed` | `pending` | `notApplicable` | `error` | `notSet`.
    pub state: Option<String>,
    pub description: Option<String>,
    pub context: Option<PrStatusContext>,
    pub creation_date: Option<DateTime<Utc>>,
    /// Higher ids are newer; used to pick the latest check per context when
    /// creation dates collide or are missing.
    pub id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusContext {
    pub name: Option<String>,
    pub genre: Option<String>,
}

/// Aggregated CI/check verdict for a pull request, derived from its status
/// checks. `none` means no relevant checks were posted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrCiState {
    Succeeded,
    Failed,
    InProgress,
    None,
}

impl PrCiState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::InProgress => "in_progress",
            Self::None => "none",
        }
    }
}

/// Aggregate CI summary suitable for a compact grid cell: an overall state, the
/// name of the most relevant check (for the tooltip), and how many checks were
/// considered.
#[derive(Debug, Clone)]
pub struct PrCiSummary {
    pub state: PrCiState,
    pub context_name: Option<String>,
    pub check_count: usize,
}

impl AdoClient {
    /// Lists the status checks attached to a pull request. The repository id is
    /// used so the call works regardless of which project the PR lives in.
    pub async fn list_pull_request_statuses(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<PrStatusCheck>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/statuses"
        );
        let response: ListResponse<PrStatusCheck> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }
}

/// Collapses raw status checks into a single grid-friendly verdict.
///
/// Azure DevOps can post several checks per context over a PR's lifetime, so we
/// keep only the latest check per context (by creation date, then id) before
/// aggregating. The overall state is the worst non-stale verdict: any failure
/// wins, then any in-progress, then success. `notApplicable` / `notSet` checks
/// are ignored. When nothing relevant remains the summary is `None`.
pub fn summarize_pr_ci(checks: &[PrStatusCheck]) -> PrCiSummary {
    use std::collections::HashMap;

    // Latest check per context key (name+genre); a missing context falls back
    // to a stable empty key so unnamed checks still count.
    let mut latest: HashMap<String, &PrStatusCheck> = HashMap::new();
    for check in checks {
        let key = check
            .context
            .as_ref()
            .map(|c| {
                format!(
                    "{}|{}",
                    c.genre.as_deref().unwrap_or(""),
                    c.name.as_deref().unwrap_or("")
                )
            })
            .unwrap_or_default();
        let newer = match latest.get(&key) {
            None => true,
            Some(existing) => is_newer(check, existing),
        };
        if newer {
            latest.insert(key, check);
        }
    }

    let mut failed_name: Option<String> = None;
    let mut in_progress_name: Option<String> = None;
    let mut succeeded_name: Option<String> = None;
    let mut count = 0usize;

    for check in latest.values() {
        let verdict = match check.state.as_deref() {
            Some("failed") | Some("error") => PrCiState::Failed,
            Some("succeeded") => PrCiState::Succeeded,
            Some("pending") => PrCiState::InProgress,
            // notApplicable / notSet / unknown: ignore.
            _ => continue,
        };
        count += 1;
        let name = check.context.as_ref().and_then(|c| c.name.clone());
        match verdict {
            PrCiState::Failed => {
                failed_name.get_or_insert_with(|| name.clone().unwrap_or_default());
            }
            PrCiState::InProgress => {
                in_progress_name.get_or_insert_with(|| name.clone().unwrap_or_default());
            }
            PrCiState::Succeeded => {
                succeeded_name.get_or_insert_with(|| name.clone().unwrap_or_default());
            }
            PrCiState::None => {}
        }
    }

    // Worst verdict wins so a failing check is never hidden by a green one.
    let (state, name) = if let Some(name) = failed_name {
        (PrCiState::Failed, Some(name))
    } else if let Some(name) = in_progress_name {
        (PrCiState::InProgress, Some(name))
    } else if let Some(name) = succeeded_name {
        (PrCiState::Succeeded, Some(name))
    } else {
        (PrCiState::None, None)
    };

    PrCiSummary {
        state,
        context_name: name.filter(|n| !n.is_empty()),
        check_count: count,
    }
}

fn is_newer(candidate: &PrStatusCheck, current: &PrStatusCheck) -> bool {
    match (candidate.creation_date, current.creation_date) {
        (Some(a), Some(b)) if a != b => a > b,
        _ => candidate.id.unwrap_or(0) >= current.id.unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    fn check(id: i64, name: &str, state: &str, date: &str) -> PrStatusCheck {
        PrStatusCheck {
            state: Some(state.to_string()),
            description: None,
            context: Some(PrStatusContext {
                name: Some(name.to_string()),
                genre: Some("continuous-integration".to_string()),
            }),
            creation_date: Some(date.parse().unwrap()),
            id: Some(id),
        }
    }

    #[test]
    fn summarize_returns_none_without_checks() {
        let summary = summarize_pr_ci(&[]);
        assert_eq!(summary.state, PrCiState::None);
        assert_eq!(summary.check_count, 0);
        assert!(summary.context_name.is_none());
    }

    #[test]
    fn summarize_failure_wins_over_success() {
        let checks = vec![
            check(1, "build", "succeeded", "2026-06-01T00:00:00Z"),
            check(2, "lint", "failed", "2026-06-01T00:00:00Z"),
        ];
        let summary = summarize_pr_ci(&checks);
        assert_eq!(summary.state, PrCiState::Failed);
        assert_eq!(summary.context_name.as_deref(), Some("lint"));
        assert_eq!(summary.check_count, 2);
    }

    #[test]
    fn summarize_in_progress_when_no_failure() {
        let checks = vec![
            check(1, "build", "succeeded", "2026-06-01T00:00:00Z"),
            check(2, "deploy", "pending", "2026-06-01T00:00:00Z"),
        ];
        let summary = summarize_pr_ci(&checks);
        assert_eq!(summary.state, PrCiState::InProgress);
    }

    #[test]
    fn summarize_keeps_latest_check_per_context() {
        // An older failure superseded by a newer success on the same context
        // must not count as failed.
        let checks = vec![
            check(1, "build", "failed", "2026-06-01T00:00:00Z"),
            check(2, "build", "succeeded", "2026-06-02T00:00:00Z"),
        ];
        let summary = summarize_pr_ci(&checks);
        assert_eq!(summary.state, PrCiState::Succeeded);
        assert_eq!(summary.check_count, 1);
    }

    #[test]
    fn summarize_ignores_not_applicable() {
        let checks = vec![PrStatusCheck {
            state: Some("notApplicable".to_string()),
            description: None,
            context: Some(PrStatusContext {
                name: Some("optional".to_string()),
                genre: None,
            }),
            creation_date: None,
            id: Some(1),
        }];
        let summary = summarize_pr_ci(&checks);
        assert_eq!(summary.state, PrCiState::None);
        assert_eq!(summary.check_count, 0);
    }

    #[tokio::test]
    async fn list_pull_request_statuses_maps_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/statuses",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 5,
                    "state": "succeeded",
                    "description": "Build succeeded",
                    "context": { "name": "ci-build", "genre": "continuous-integration" },
                    "creationDate": "2026-06-10T00:00:00Z"
                }]
            })))
            .mount(&server)
            .await;

        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let checks = client
            .list_pull_request_statuses("project-1", "repo-1", 42)
            .await
            .unwrap();
        assert_eq!(checks.len(), 1);
        let summary = summarize_pr_ci(&checks);
        assert_eq!(summary.state, PrCiState::Succeeded);
        assert_eq!(summary.context_name.as_deref(), Some("ci-build"));
    }
}
