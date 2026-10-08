use azdo_client::{summarize_pr_ci, AdoClient, TeamProject};
use chrono::Utc;
use tokio::task::JoinSet;

use super::*;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::shared_cache::SharedReviewer;
use crate::sync::SyncBudget;

use super::group_reviews::{group_review_prs, member_group_ids};

// ── Cache sync ────────────────────────────────────────────────────────────────

pub(crate) struct SyncPrsResult {
    pub(crate) warning: Option<String>,
}

pub(crate) struct PrProjectFetch {
    pub(crate) project_id: String,
    pub(crate) label: String,
    pub(crate) result: Result<Vec<CachedPr>>,
    /// The live query returned `PROJECT_PR_SYNC_TOP` PRs, so the snapshot may be
    /// truncated and must not be used to delete the project's cached rows.
    pub(crate) capped: bool,
    /// Reviewer entries of the fetched PRs. Empty when the list came from the
    /// shared cache, which does not expose reviewers to this app.
    pub(crate) reviewers: Vec<SharedReviewer>,
}

pub async fn sync_prs_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
    force_refresh: bool,
) -> Result<()> {
    let scope = format!("prs:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_prs(db, client, org, projects, budget, force_refresh).await {
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
    /// Projects whose result hit the query cap; their rows are merged, not replaced.
    capped: Vec<String>,
    skipped: Vec<String>,
    last_skip_error: Option<AppError>,
    reviewers: Vec<SharedReviewer>,
}

struct ReviewPrsFetch {
    cached_reviews: Vec<CachedReviewPr>,
    failed_projects: Vec<String>,
    synced_project_ids: Vec<String>,
}

pub(crate) async fn do_sync_prs(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
    force_refresh: bool,
) -> Result<SyncPrsResult> {
    // Run the active-PR and review-PR passes concurrently; both fan out over the
    // same projects but issue independent queries, all bounded by the shared
    // budget. The review pass is only meaningful when the signed-in user is known.
    let review_user = org.authenticated_user_id.clone();
    // Reviews requested from a group the user belongs to are found in the active
    // PR list, which needs live reviewer data, so the shared-cache shortcut is
    // skipped whenever the user has groups.
    let (group_ids, group_warning) = match review_user.as_deref() {
        Some(user_id) => member_group_ids(db, client, org, user_id).await,
        None => (Default::default(), None),
    };
    let (active, review) = tokio::join!(
        fetch_all_active_prs(
            client,
            org,
            projects,
            budget,
            force_refresh || !group_ids.is_empty()
        ),
        async {
            match review_user.as_deref() {
                Some(user_id) => {
                    Some(fetch_all_review_prs(client, org, projects, user_id, budget).await)
                }
                None => None,
            }
        }
    );
    let active = active?;

    // If nothing synced and we have a real error, surface it instead of
    // recording a spurious success.
    if active.synced_project_ids.is_empty() {
        if let Some(e) = active.last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = active
        .synced_project_ids
        .iter()
        .map(String::as_str)
        .collect();
    db.replace_pull_requests_for_projects(&org.id, &synced_ids, &active.cached_prs)?;

    let mut warning_parts: Vec<String> = Vec::new();
    warning_parts.extend(group_warning);
    if !active.skipped.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to PR sync errors: {}.",
            active.skipped.len(),
            active.skipped.join(", ")
        ));
    }
    if !active.capped.is_empty() {
        warning_parts.push(format!(
            "{} project(s) have {PROJECT_PR_SYNC_TOP} or more active PRs; cached PRs outside the fetched window were kept: {}.",
            active.capped.len(),
            active.capped.join(", ")
        ));
    }

    match review {
        Some(review) => {
            let mut review = review?;
            let mut synced = std::mem::take(&mut review.synced_project_ids);
            if !group_ids.is_empty() {
                // Group reviews come from the active list, so a project is only
                // replaced when that list was complete for it too; otherwise its
                // previous rows (including group reviews) are kept.
                synced.retain(|id| active.synced_project_ids.contains(id));
                let extra = group_review_prs(
                    &active.cached_prs,
                    &active.reviewers,
                    &group_ids,
                    &review.cached_reviews,
                    review_user.as_deref().unwrap_or_default(),
                );
                review.cached_reviews.extend(
                    extra
                        .into_iter()
                        .filter(|pr| synced.contains(&pr.project_id)),
                );
            }
            if !review.failed_projects.is_empty() {
                // Only the failed projects keep their previous rows; every other
                // project is refreshed so one flaky project cannot freeze the list.
                warning_parts.push(format!(
                    "Review PRs were not refreshed for project(s) whose query failed: {}.",
                    review.failed_projects.join(", ")
                ));
            }
            enrich_review_ci_status(client, &mut review.cached_reviews, budget).await;
            let synced_ids: Vec<&str> = synced.iter().map(String::as_str).collect();
            db.replace_review_pull_requests_for_projects(
                &org.id,
                &synced_ids,
                &review.cached_reviews,
            )?;
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
    force_refresh: bool,
) -> Result<ActivePrsFetch> {
    let mut tasks: JoinSet<PrProjectFetch> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            fetch_active_prs_for_project(client, org, project, force_refresh).await
        });
    }

    let mut out = ActivePrsFetch::default();
    while let Some(joined) = tasks.join_next().await {
        let fetch =
            joined.map_err(|e| AppError::AzureDevOps(format!("PR sync task failed: {e}")))?;
        match fetch.result {
            Ok(prs) => {
                if fetch.capped {
                    out.capped.push(fetch.label);
                } else {
                    out.synced_project_ids.push(fetch.project_id);
                }
                out.cached_prs.extend(prs);
                out.reviewers.extend(fetch.reviewers);
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
    let mut tasks: JoinSet<(String, String, Result<Vec<CachedReviewPr>>)> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let user_id = user_id.to_string();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            let project_id = project.id.clone();
            let (name, result) = fetch_review_prs_for_project(client, org, project, user_id).await;
            (name, project_id, result)
        });
    }

    let mut cached_reviews: Vec<CachedReviewPr> = Vec::new();
    let mut failed_projects: Vec<String> = Vec::new();
    let mut synced_project_ids: Vec<String> = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (project_name, project_id, result) = joined
            .map_err(|e| AppError::AzureDevOps(format!("review PR sync task failed: {e}")))?;
        let succeeded = result.is_ok();
        collect_review_fetch(
            org,
            project_name,
            result,
            &mut cached_reviews,
            &mut failed_projects,
        );
        if succeeded {
            synced_project_ids.push(project_id);
        }
    }
    Ok(ReviewPrsFetch {
        cached_reviews,
        failed_projects,
        synced_project_ids,
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
    result: Result<Vec<CachedReviewPr>>,
    cached_reviews: &mut Vec<CachedReviewPr>,
    review_failed_projects: &mut Vec<String>,
) {
    match result {
        Ok(reviews) => cached_reviews.extend(reviews),
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
