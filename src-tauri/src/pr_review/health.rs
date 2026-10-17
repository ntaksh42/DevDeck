//! A pull request's CI verdict and unresolved-comment count, fetched on demand
//! for the rows of My Pull Requests (issue #721). Two requests per pull request,
//! so the caller only asks for the rows it shows.

use azdo_client::{summarize_pr_ci, GitThread};
use serde::Serialize;

use crate::auth::client_for_organization;
use crate::error::Result;

use super::helpers::thread_resolved;
use super::types::PrLocator;
use super::PrReviewService;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrHealth {
    /// `succeeded` | `failed` | `in_progress` | `none`.
    pub ci_status: String,
    pub ci_context: Option<String>,
    pub ci_check_count: i64,
    /// Threads with a human comment that are still open.
    pub unresolved_threads: i64,
}

/// Open threads that carry a human comment; votes, pushes and other system
/// threads are not "comments waiting for a reply".
pub(super) fn count_unresolved(threads: &[GitThread]) -> i64 {
    threads
        .iter()
        .filter(|thread| !thread.is_deleted && !thread_resolved(thread.status.as_deref()))
        .filter(|thread| {
            thread.comments.iter().flatten().any(|comment| {
                !comment.is_deleted && comment.comment_type.as_deref() != Some("system")
            })
        })
        .count() as i64
}

impl PrReviewService {
    pub async fn get_health(&self, pr: PrLocator) -> Result<PrHealth> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (statuses, threads) = tokio::try_join!(
            client.list_pull_request_statuses(
                &pr.project_id,
                &pr.repository_id,
                pr.pull_request_id
            ),
            client.list_pull_request_threads(&pr.project_id, &pr.repository_id, pr.pull_request_id),
        )?;
        let ci = summarize_pr_ci(&statuses);
        Ok(PrHealth {
            ci_status: ci.state.as_str().to_string(),
            ci_context: ci.context_name,
            ci_check_count: ci.check_count as i64,
            unresolved_threads: count_unresolved(&threads),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(value: serde_json::Value) -> GitThread {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn counts_only_open_human_threads() {
        let threads = vec![
            thread(serde_json::json!({
                "id": 1, "status": "active",
                "comments": [{ "id": 1, "commentType": "text", "content": "fix" }]
            })),
            thread(serde_json::json!({
                "id": 2, "status": "fixed",
                "comments": [{ "id": 1, "commentType": "text", "content": "done" }]
            })),
            thread(serde_json::json!({
                "id": 3, "status": "active",
                "comments": [{ "id": 1, "commentType": "system", "content": "voted" }]
            })),
            thread(serde_json::json!({
                "id": 4, "status": "active", "isDeleted": true,
                "comments": [{ "id": 1, "commentType": "text", "content": "gone" }]
            })),
            thread(
                serde_json::json!({ "id": 5, "comments": [{ "id": 1, "content": "no status" }] }),
            ),
        ];
        assert_eq!(count_unresolved(&threads), 2);
    }
}
