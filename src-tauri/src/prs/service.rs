use std::collections::HashSet;

use azdo_client::PullRequestStatus;
use chrono::Utc;
use tokio::task::JoinSet;

use super::*;
use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

#[derive(Debug, Clone)]
pub struct PullRequestService {
    db: AppDatabase,
    #[allow(dead_code)]
    secrets: SecretStore,
}

impl PullRequestService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn list_my_reviews(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let cached = self.db.list_review_pull_requests(&organization.id)?;
        // Hide only items whose snooze is still in effect; an expired deadline
        // returns the PR to the list immediately instead of waiting for the
        // sync-driven reconcile to delete the row.
        let now = Utc::now();
        let snoozed: std::collections::HashSet<String> = self
            .db
            .list_snoozed_items(&organization.id, crate::snooze::ITEM_TYPE_PULL_REQUEST)?
            .into_iter()
            .filter(|row| crate::snooze::snooze_is_active(now, &row.snooze_until))
            .map(|row| row.item_key)
            .collect();
        let mut results: Vec<ReviewPullRequestSummary> = cached
            .into_iter()
            .filter(|pr| !snoozed.contains(&format!("{}:{}", pr.repository_id, pr.pull_request_id)))
            .map(|pr| ReviewPullRequestSummary {
                organization_id: pr.org_id,
                project_id: pr.project_id,
                project_name: pr.project_name,
                repository_id: pr.repository_id,
                repository_name: pr.repository_name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                created_by: pr.created_by,
                creation_date: pr.creation_date,
                target_ref_name: pr.target_ref_name,
                web_url: pr.web_url,
                my_vote: pr.my_vote,
                my_vote_label: pr.my_vote_label,
                my_is_required: pr.my_is_required,
                is_draft: pr.is_draft,
                merge_status: pr.merge_status,
                ci_status: pr.ci_status,
                ci_context: pr.ci_context,
                ci_check_count: pr.ci_check_count,
            })
            .collect();
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        Ok(results)
    }

    // PRs the user authored are fetched live from Azure DevOps (not cached),
    // mirroring how PR search hits the API on demand. The server filters by
    // `searchCriteria.creatorId`, so we fan out one query per project and merge.
    pub async fn list_my_created_pull_requests(
        &self,
        input: ListMyCreatedPullRequestsInput,
    ) -> Result<Vec<MyCreatedPullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;

        // Without an authenticated user id we cannot identify "my" PRs.
        let Some(user_id) = organization.authenticated_user_id.clone() else {
            return Ok(Vec::new());
        };

        let client = client_for_organization(&organization, &self.secrets)?;
        let projects = project_id_name_pairs(&client).await?;

        let mut tasks: JoinSet<Result<Vec<MyCreatedPullRequestSummary>>> = JoinSet::new();
        for (project_id, _project_name) in projects {
            let client = client.clone();
            let org = organization.clone();
            let user_id = user_id.clone();
            tasks.spawn(async move {
                fetch_created_prs_for_project(&client, &org, &project_id, &user_id).await
            });
        }

        let mut results = Vec::new();
        while let Some(joined) = tasks.join_next().await {
            let fetched = joined
                .map_err(|e| AppError::AzureDevOps(format!("created PR task failed: {e}")))?;
            results.extend(fetched?);
        }
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        Ok(results)
    }

    // Active PRs are served from the local cache (kept fresh by background
    // sync). Completed/abandoned/all are historical and effectively unbounded,
    // so they are never cached; the search fetches them live from Azure DevOps
    // on demand, mirroring how commit search bypasses the cache for non-default
    // branches. Target-branch and date-window filters are pushed to the server
    // on the live path and applied in memory on the cache path.
    pub async fn search(&self, input: SearchPullRequestsInput) -> Result<PullRequestSearchResult> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;

        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let project_set = normalize_set(input.project_ids);
        let repository_set = normalize_set(input.repository_ids);
        let statuses = parse_search_statuses(input.statuses.as_deref())?;

        // Stored target refs are short (no refs/heads/ prefix), so normalize the
        // input the same way for comparison and rebuild the full ref for the API.
        let target_branch =
            normalize_optional(input.target_branch).map(|branch| short_ref(&branch).to_string());
        let from_rfc = parse_date_bound(input.from_date.as_deref(), false)?;
        let to_rfc = parse_date_bound(input.to_date.as_deref(), true)?;
        if let (Some(from), Some(to)) = (&from_rfc, &to_rfc) {
            if from > to {
                return Err(AppError::InvalidInput(
                    "from date must be before or equal to to date".to_string(),
                ));
            }
        }
        let date_basis = parse_date_basis(input.date_basis.as_deref());
        let exclude_drafts = input.exclude_drafts.unwrap_or(false);
        let sort_by = parse_sort_by(input.sort_by.as_deref());

        // Active rows are served from the local cache; completed/abandoned are
        // fetched live. With multiple statuses selected we run each path and
        // union the results (the status sets are disjoint, so no dedup needed).
        let want_cached_active = statuses
            .iter()
            .any(|s| matches!(s, SearchStatus::CachedActive));
        let live_statuses: Vec<PullRequestStatus> = statuses
            .iter()
            .filter_map(|s| match s {
                SearchStatus::Live(status) => Some(*status),
                SearchStatus::CachedActive => None,
            })
            .collect();

        let mut results: Vec<PullRequestSummary> = Vec::new();

        if want_cached_active {
            let cached =
                self.db
                    .search_pull_requests(&organization.id, None, None, Some("active"))?;
            results.extend(cached.into_iter().map(cached_pr_to_summary).filter(|pr| {
                // Active rows have no close date, so the window always applies
                // to creation date here regardless of basis.
                target_branch
                    .as_deref()
                    .is_none_or(|branch| pr.target_ref_name.eq_ignore_ascii_case(branch))
                    && within_window(
                        pr.creation_date.as_str(),
                        from_rfc.as_deref(),
                        to_rfc.as_deref(),
                    )
            }));
        }

        for status in live_statuses {
            let target_ref_full = target_branch
                .as_deref()
                .map(|branch| format!("refs/heads/{branch}"));
            let fetched = self
                .fetch_live_prs(
                    &organization,
                    status,
                    project_set.as_ref(),
                    repository_set.as_ref(),
                    target_ref_full.as_deref(),
                    from_rfc.as_deref(),
                    to_rfc.as_deref(),
                    date_basis,
                )
                .await?;
            results.extend(fetched);
        }

        // Project/repository scoping is applied in memory so the cache path and
        // every live status share one consistent membership filter.
        if let Some(set) = &project_set {
            results.retain(|pr| set.contains(&pr.project_id));
        }
        if let Some(set) = &repository_set {
            results.retain(|pr| set.contains(&pr.repository_id));
        }

        results.retain(|summary| {
            matches_query(summary, &query) && (!exclude_drafts || !summary.is_draft)
        });
        sort_summaries(&mut results, sort_by);
        let total = results.len();
        let truncated = total > PR_SEARCH_RESULT_LIMIT;
        results.truncate(PR_SEARCH_RESULT_LIMIT);
        Ok(PullRequestSearchResult {
            pull_requests: results,
            total,
            truncated,
        })
    }

    /// Fetches PRs of a non-active status straight from Azure DevOps. The query
    /// is scoped to a single project when one is selected, to the project that
    /// owns the selected repository when only a repository is chosen, and to
    /// every project otherwise. Target branch and the date window are filtered
    /// server-side; a repository filter is applied after the fetch because the
    /// project-level endpoint spans all repositories.
    #[allow(clippy::too_many_arguments)]
    async fn fetch_live_prs(
        &self,
        organization: &Organization,
        status: PullRequestStatus,
        project_set: Option<&HashSet<String>>,
        repository_set: Option<&HashSet<String>>,
        target_ref_full: Option<&str>,
        from_rfc: Option<&str>,
        to_rfc: Option<&str>,
        date_basis: DateBasis,
    ) -> Result<Vec<PullRequestSummary>> {
        let client = client_for_organization(organization, &self.secrets)?;

        // Scope the live query to the relevant projects to limit API calls:
        // the selected projects, or the projects owning the selected
        // repositories, or every project when nothing is scoped.
        let all_pairs = project_id_name_pairs(&client).await?;
        let projects: Vec<(String, String)> = if let Some(set) = project_set {
            all_pairs
                .into_iter()
                .filter(|(id, _)| set.contains(id))
                .collect()
        } else if let Some(repo_set) = repository_set {
            let owning: HashSet<String> = self
                .db
                .list_commit_repositories(&organization.id)?
                .into_iter()
                .filter(|repo| repo_set.contains(&repo.repository_id))
                .map(|repo| repo.project_id)
                .collect();
            if owning.is_empty() {
                all_pairs
            } else {
                all_pairs
                    .into_iter()
                    .filter(|(id, _)| owning.contains(id))
                    .collect()
            }
        } else {
            all_pairs
        };

        tracing::info!(
            organization = %organization.name,
            status = status.as_query_value(),
            project_count = projects.len(),
            "fetching pull requests live for search"
        );

        // Owned copies so each spawned task can hold the filter values.
        let target = target_ref_full.map(str::to_string);
        let from = from_rfc.map(str::to_string);
        let to = to_rfc.map(str::to_string);
        let time_range_type = date_basis.query_value();

        let mut tasks: JoinSet<Result<Vec<PullRequestSummary>>> = JoinSet::new();
        for (project_id, project_name) in projects {
            let client = client.clone();
            let org = organization.clone();
            let target = target.clone();
            let from = from.clone();
            let to = to.clone();
            tasks.spawn(async move {
                fetch_status_prs_for_project(
                    &client,
                    &org,
                    &project_id,
                    &project_name,
                    status,
                    target.as_deref(),
                    from.as_deref(),
                    to.as_deref(),
                    time_range_type,
                )
                .await
            });
        }

        let mut results = Vec::new();
        while let Some(joined) = tasks.join_next().await {
            let fetched =
                joined.map_err(|e| AppError::AzureDevOps(format!("PR search task failed: {e}")))?;
            results.extend(fetched?);
        }

        Ok(results)
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }
}
