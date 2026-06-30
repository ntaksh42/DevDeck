use azdo_client::{summarize_pr_ci, AdoClient, TeamProject};
use chrono::Utc;
use tokio::task::JoinSet;

use super::*;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::sync::SyncBudget;

// ── Cache sync ────────────────────────────────────────────────────────────────

pub(crate) struct SyncPrsResult {
    pub(crate) warning: Option<String>,
}

pub(crate) type ReviewPrFetchResult = (String, Result<(Vec<CachedReviewPr>, usize)>);

pub(crate) struct PrProjectFetch {
    pub(crate) project_id: String,
    pub(crate) label: String,
    /// Raw count returned by the project's active-PR query, before any
    /// filtering. Used to detect when the query hit `PROJECT_PR_SYNC_TOP`.
    pub(crate) queried_count: usize,
    pub(crate) result: Result<Vec<CachedPr>>,
}

pub async fn sync_prs_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<()> {
    let scope = format!("prs:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_prs(db, client, org, projects, budget).await {
        Ok(result) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(
                &scope,
                &org.id,
                Some(&now),
                0,
                None,
                result.warning.as_deref(),
            )?;
            tracing::info!(org = %org.name, "PR sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) = db.update_sync_state(
                &scope,
                &org.id,
                None,
                error_count + 1,
                Some(&e.to_string()),
                None,
            ) {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            Err(e)
        }
    }
}

#[derive(Default)]
struct ActivePrsFetch {
    cached_prs: Vec<CachedPr>,
    synced_project_ids: Vec<String>,
    // Projects whose query hit PROJECT_PR_SYNC_TOP: the fetched snapshot is
    // truncated, so it must not be used to destructively delete that
    // project's existing cached rows.
    capped_project_ids: Vec<String>,
    skipped: Vec<String>,
    last_skip_error: Option<AppError>,
}

struct ReviewPrsFetch {
    cached_reviews: Vec<CachedReviewPr>,
    failed_projects: Vec<String>,
    // Projects whose review-PR query hit REVIEW_PR_SYNC_TOP; treated like a
    // failed project so the org-wide review cache replace is skipped rather
    // than dropping valid rows the truncated query missed.
    capped_projects: Vec<String>,
}

pub(crate) async fn do_sync_prs(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<SyncPrsResult> {
    // Run the active-PR and review-PR passes concurrently; both fan out over the
    // same projects but issue independent queries, all bounded by the shared
    // budget. The review pass is only meaningful when the signed-in user is known.
    let review_user = org.authenticated_user_id.clone();
    let (active, review) =
        tokio::join!(fetch_all_active_prs(client, org, projects, budget), async {
            match review_user.as_deref() {
                Some(user_id) => {
                    Some(fetch_all_review_prs(client, org, projects, user_id, budget).await)
                }
                None => None,
            }
        });
    let active = active?;

    // If nothing synced and we have a real error, surface it instead of
    // recording a spurious success.
    if active.synced_project_ids.is_empty() {
        if let Some(e) = active.last_skip_error {
            return Err(e);
        }
    }

    let delete_safe_ids: Vec<&str> = active
        .synced_project_ids
        .iter()
        .filter(|id| !active.capped_project_ids.contains(id))
        .map(String::as_str)
        .collect();
    db.replace_pull_requests_for_projects(&org.id, &delete_safe_ids, &active.cached_prs)?;

    let mut warning_parts: Vec<String> = Vec::new();
    if !active.skipped.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to PR sync errors: {}.",
            active.skipped.len(),
            active.skipped.join(", ")
        ));
    }
    if !active.capped_project_ids.is_empty() {
        warning_parts.push(format!(
            "{} project(s) have more than {PROJECT_PR_SYNC_TOP} active pull requests; cached rows for those projects were preserved rather than replaced.",
            active.capped_project_ids.len()
        ));
    }

    match review {
        Some(review) => {
            let mut review = review?;
            if review.failed_projects.is_empty() && review.capped_projects.is_empty() {
                enrich_review_ci_status(client, &mut review.cached_reviews, budget).await;
                db.replace_review_pull_requests(&org.id, &review.cached_reviews)?;
            } else {
                // A partial review list would silently drop PRs from the failed
                // or capped projects, so keep the previous cache instead.
                if !review.failed_projects.is_empty() {
                    warning_parts.push(format!(
                        "Review PR cache was not refreshed; query failed for project(s): {}.",
                        review.failed_projects.join(", ")
                    ));
                }
                if !review.capped_projects.is_empty() {
                    warning_parts.push(format!(
                        "Review PR cache was not refreshed; project(s) have more than {REVIEW_PR_SYNC_TOP} review pull requests: {}.",
                        review.capped_projects.join(", ")
                    ));
                }
            }
        }
        None => {
            // Without an authenticated user id we cannot compute "my reviews".
            // Clearing the cache avoids freezing a stale list after a re-auth that
            // dropped the user id; the grid then shows empty rather than wrong.
            db.replace_review_pull_requests(&org.id, &[])?;
            warning_parts.push(
                "My Reviews could not be refreshed because the signed-in user is unknown; \
                 re-authenticate the organization to restore it."
                    .to_string(),
            );
        }
    }

    let warning = if warning_parts.is_empty() {
        None
    } else {
        Some(warning_parts.join(" "))
    };
    Ok(SyncPrsResult { warning })
}

/// Fans out the active-PR query across all projects, bounded by the shared
/// budget. A per-project error preserves that project's cached rows.
async fn fetch_all_active_prs(
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<ActivePrsFetch> {
    let mut tasks: JoinSet<PrProjectFetch> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            fetch_active_prs_for_project(client, org, project).await
        });
    }

    let mut out = ActivePrsFetch::default();
    while let Some(joined) = tasks.join_next().await {
        let fetch =
            joined.map_err(|e| AppError::AzureDevOps(format!("PR sync task failed: {e}")))?;
        match fetch.result {
            Ok(prs) => {
                if fetch.queried_count >= PROJECT_PR_SYNC_TOP as usize {
                    out.capped_project_ids.push(fetch.project_id.clone());
                }
                out.synced_project_ids.push(fetch.project_id);
                out.cached_prs.extend(prs);
            }
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %fetch.label,
                    error = %e,
                    "PR sync failed for project, preserving cached data"
                );
                out.skipped.push(fetch.label);
                out.last_skip_error = Some(e);
            }
        }
    }
    Ok(out)
}

/// Fans out the review-PR query (PRs where the user is a reviewer) across all
/// projects, bounded by the shared budget.
async fn fetch_all_review_prs(
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    user_id: &str,
    budget: &SyncBudget,
) -> Result<ReviewPrsFetch> {
    let mut tasks: JoinSet<ReviewPrFetchResult> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let user_id = user_id.to_string();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            fetch_review_prs_for_project(client, org, project, user_id).await
        });
    }

    let mut cached_reviews: Vec<CachedReviewPr> = Vec::new();
    let mut failed_projects: Vec<String> = Vec::new();
    let mut capped_projects: Vec<String> = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (project_name, result) = joined
            .map_err(|e| AppError::AzureDevOps(format!("review PR sync task failed: {e}")))?;
        collect_review_fetch(
            org,
            project_name,
            result,
            &mut cached_reviews,
            &mut failed_projects,
            &mut capped_projects,
        );
    }
    Ok(ReviewPrsFetch {
        cached_reviews,
        failed_projects,
        capped_projects,
    })
}

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
async fn enrich_review_ci_status(
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

fn collect_review_fetch(
    org: &Organization,
    project_name: String,
    result: Result<(Vec<CachedReviewPr>, usize)>,
    cached_reviews: &mut Vec<CachedReviewPr>,
    review_failed_projects: &mut Vec<String>,
    review_capped_projects: &mut Vec<String>,
) {
    match result {
        Ok((reviews, queried_count)) => {
            if queried_count >= REVIEW_PR_SYNC_TOP as usize {
                tracing::warn!(
                    org = %org.name,
                    project = %project_name,
                    queried_count,
                    "review PR query hit REVIEW_PR_SYNC_TOP, preserving cached data instead of a truncated replace"
                );
                review_capped_projects.push(project_name);
            } else {
                cached_reviews.extend(reviews);
            }
        }
        Err(e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "review PR sync failed for project, preserving cached data"
            );
            review_failed_projects.push(project_name);
        }
    }
}
