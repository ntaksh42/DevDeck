//! CI verdict enrichment for review PRs, split from `sync.rs` to keep files
//! under 500 lines.

use azdo_client::{summarize_pr_ci, AdoClient};
use tokio::task::JoinSet;

use crate::db::CachedReviewPr;
use crate::sync::SyncBudget;

// CI status is fetched per-PR, so it is capped to keep sync cost bounded on
// large review lists. The most recently created PRs are the ones a reviewer
// acts on first, so they get the live CI verdict; older ones render as unknown.
const CI_STATUS_SCAN_LIMIT: usize = 50;

// (status, context_name, check_count) for one PR; `None` when the fetch failed.
type CiFetchResult = (usize, Option<(String, Option<String>, i64)>);

/// Fills in the CI verdict for the most recent review PRs by querying each PR's
/// status checks. A failed fetch leaves the PR's CI fields unset (rendered as
/// "unknown"), never failing the sync. Per-PR fetches are bounded by the shared
/// budget.
pub(super) async fn enrich_review_ci_status(
    client: &AdoClient,
    reviews: &mut [CachedReviewPr],
    budget: &SyncBudget,
) {
    // Pick the newest PRs by creation date; creation_date is an RFC3339 string
    // so lexicographic comparison matches chronological order.
    let mut indices: Vec<usize> = (0..reviews.len()).collect();
    indices.sort_by(|&a, &b| reviews[b].creation_date.cmp(&reviews[a].creation_date));
    indices.truncate(CI_STATUS_SCAN_LIMIT);

    let mut results: std::collections::HashMap<usize, (String, Option<String>, i64)> =
        std::collections::HashMap::new();
    let mut tasks: JoinSet<CiFetchResult> = JoinSet::new();

    for &index in &indices {
        let pr = &reviews[index];
        let client = client.clone();
        let project_id = pr.project_id.clone();
        let repository_id = pr.repository_id.clone();
        let pull_request_id = pr.pull_request_id;
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            let outcome = client
                .list_pull_request_statuses(&project_id, &repository_id, pull_request_id)
                .await;
            let value = match outcome {
                Ok(checks) => {
                    let summary = summarize_pr_ci(&checks);
                    Some((
                        summary.state.as_str().to_string(),
                        summary.context_name,
                        summary.check_count as i64,
                    ))
                }
                Err(e) => {
                    tracing::warn!(pr = pull_request_id, error = %e, "failed to fetch PR CI status");
                    None
                }
            };
            (index, value)
        });
    }
    while !tasks.is_empty() {
        if let Some((idx, Some(value))) = join_ci_task(&mut tasks).await {
            results.insert(idx, value);
        }
    }

    for (index, (status, context, count)) in results {
        reviews[index].ci_status = Some(status);
        reviews[index].ci_context = context;
        reviews[index].ci_check_count = count;
    }
}

async fn join_ci_task(tasks: &mut JoinSet<CiFetchResult>) -> Option<CiFetchResult> {
    match tasks.join_next().await {
        Some(Ok(result)) => Some(result),
        Some(Err(e)) => {
            tracing::warn!(error = %e, "PR CI status task failed");
            None
        }
        None => None,
    }
}
