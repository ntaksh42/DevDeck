use azdo_client::{
    summarize_pr_ci, AdoClient, AdoError, GitPullRequest, GitThread, IdentityRefWithVote,
    PullRequestStatus, TeamProject,
};
use chrono::{NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tokio::task::JoinSet;

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;
use crate::sync::{PrNotificationItem, PrNotificationKind, SyncBudget};

// Active PRs across one project; well above what a project realistically has.
const PROJECT_PR_SYNC_TOP: u32 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyReviewPullRequestsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub my_is_required: bool,
    pub is_draft: bool,
    pub merge_status: Option<String>,
    pub ci_status: Option<String>,
    pub ci_context: Option<String>,
    pub ci_check_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    /// Statuses to include. Empty/omitted defaults to active (cached) only.
    pub statuses: Option<Vec<String>>,
    /// Projects to include. Empty/omitted means all projects.
    pub project_ids: Option<Vec<String>>,
    /// Repositories to include. Empty/omitted means all repositories.
    pub repository_ids: Option<Vec<String>>,
    /// Target branch to filter by, e.g. `main` or `refs/heads/main`.
    pub target_branch: Option<String>,
    /// Inclusive date window (`YYYY-MM-DD`) interpreted against `date_basis`.
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    /// `created` (default) or `closed`: which date the window applies to.
    pub date_basis: Option<String>,
    pub exclude_drafts: Option<bool>,
    /// `created` (default), `closed`, or `title`.
    pub sort_by: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub closed_date: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub is_draft: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSearchResult {
    pub pull_requests: Vec<PullRequestSummary>,
    /// Total matches before the display cap, so the UI can show "100+".
    pub total: usize,
    pub truncated: bool,
}

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

/// Resolves the requested search status into either the cached-active fast path
/// or a live Azure DevOps query for historical statuses. Unknown values are
/// rejected so the UI cannot silently request an unsupported status.
enum SearchStatus {
    CachedActive,
    Live(PullRequestStatus),
}

/// Resolves the requested statuses, de-duplicating and defaulting to active
/// (the cheap cached path) when nothing is selected. Unknown values are
/// rejected so the UI cannot silently request an unsupported status.
fn parse_search_statuses(values: Option<&[String]>) -> Result<Vec<SearchStatus>> {
    let mut seen = HashSet::new();
    let normalized: Vec<String> = values
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect();
    if normalized.is_empty() {
        return Ok(vec![SearchStatus::CachedActive]);
    }
    normalized
        .into_iter()
        .map(|value| match value.as_str() {
            "active" => Ok(SearchStatus::CachedActive),
            "completed" => Ok(SearchStatus::Live(PullRequestStatus::Completed)),
            "abandoned" => Ok(SearchStatus::Live(PullRequestStatus::Abandoned)),
            other => Err(AppError::InvalidInput(format!(
                "unsupported pull request status: {other}"
            ))),
        })
        .collect()
}

/// Trims and drops blanks from a multi-value filter, returning `None` when the
/// resulting set is empty so callers can treat "no values" as "no filter".
fn normalize_set(values: Option<Vec<String>>) -> Option<HashSet<String>> {
    let set: HashSet<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    (!set.is_empty()).then_some(set)
}

// How many search rows the UI renders; extra matches set the `truncated` flag.
const PR_SEARCH_RESULT_LIMIT: usize = 100;

/// Which date a date-window filter applies to.
#[derive(Clone, Copy)]
enum DateBasis {
    Created,
    Closed,
}

impl DateBasis {
    fn query_value(self) -> &'static str {
        match self {
            DateBasis::Created => "created",
            DateBasis::Closed => "closed",
        }
    }
}

fn parse_date_basis(value: Option<&str>) -> DateBasis {
    match value.map(str::trim) {
        Some("closed") => DateBasis::Closed,
        _ => DateBasis::Created,
    }
}

#[derive(Clone, Copy)]
enum SortBy {
    Created,
    Closed,
    Title,
}

fn parse_sort_by(value: Option<&str>) -> SortBy {
    match value.map(str::trim) {
        Some("closed") => SortBy::Closed,
        Some("title") => SortBy::Title,
        _ => SortBy::Created,
    }
}

fn sort_summaries(results: &mut [PullRequestSummary], sort_by: SortBy) {
    match sort_by {
        SortBy::Created => results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date)),
        SortBy::Closed => results.sort_by(|a, b| {
            // Most recently closed first; PRs without a close date sort last.
            b.closed_date
                .cmp(&a.closed_date)
                .then_with(|| b.creation_date.cmp(&a.creation_date))
        }),
        SortBy::Title => results.sort_by(|a, b| {
            a.title
                .to_ascii_lowercase()
                .cmp(&b.title.to_ascii_lowercase())
        }),
    }
}

/// Parses a `YYYY-MM-DD` filter bound into an RFC3339 instant. `end_of_day`
/// pushes the bound to 23:59:59 so the `to` date is inclusive.
fn parse_date_bound(value: Option<&str>, end_of_day: bool) -> Result<Option<String>> {
    let Some(trimmed) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::InvalidInput(format!("invalid date: {trimmed}")))?;
    let time = if end_of_day {
        NaiveTime::from_hms_opt(23, 59, 59)
    } else {
        NaiveTime::from_hms_opt(0, 0, 0)
    }
    .expect("valid constant time");
    Ok(Some(
        Utc.from_utc_datetime(&date.and_time(time)).to_rfc3339(),
    ))
}

/// Inclusive RFC3339 range check by lexicographic comparison; both bounds and
/// `value` are produced by `to_rfc3339()` so the string order matches time order.
fn within_window(value: &str, from: Option<&str>, to: Option<&str>) -> bool {
    from.is_none_or(|f| value >= f) && to.is_none_or(|t| value <= t)
}

async fn project_id_name_pairs(client: &AdoClient) -> Result<Vec<(String, String)>> {
    Ok(client
        .list_projects()
        .await?
        .into_iter()
        .map(|project| (project.id, project.name))
        .collect())
}

/// Lists PRs of `status` across one project with optional server-side target
/// branch and date-window filters, dropping a deleted project (404) rather than
/// failing the whole search.
#[allow(clippy::too_many_arguments)]
async fn fetch_status_prs_for_project(
    client: &AdoClient,
    org: &Organization,
    project_id: &str,
    project_name: &str,
    status: PullRequestStatus,
    target_ref_name: Option<&str>,
    min_time: Option<&str>,
    max_time: Option<&str>,
    time_range_type: &str,
) -> Result<Vec<PullRequestSummary>> {
    let prs = match client
        .search_project_pull_requests(
            project_id,
            status,
            target_ref_name,
            min_time,
            max_time,
            Some(time_range_type),
            PROJECT_PR_SYNC_TOP,
        )
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "pull request search returned 404, skipping project"
            );
            return Ok(Vec::new());
        }
        Err(e) => return Err(e.into()),
    };
    Ok(prs
        .into_iter()
        .filter_map(|pr| live_pr_to_summary(org, project_id, project_name, pr))
        .collect())
}

fn cached_pr_to_summary(pr: CachedPr) -> PullRequestSummary {
    PullRequestSummary {
        organization_id: pr.org_id,
        project_id: pr.project_id,
        project_name: pr.project_name,
        repository_id: pr.repository_id,
        repository_name: pr.repository_name,
        pull_request_id: pr.pull_request_id,
        title: pr.title,
        status: pr.status,
        created_by: pr.created_by,
        creation_date: pr.creation_date,
        // Active PRs have no close date; live results fill this in.
        closed_date: None,
        source_ref_name: pr.source_ref_name,
        target_ref_name: pr.target_ref_name,
        web_url: pr.web_url,
        is_draft: pr.is_draft,
    }
}

/// Maps a live Azure DevOps PR into a search summary, falling back to the
/// queried project's id/name when the PR omits repository project metadata.
fn live_pr_to_summary(
    org: &Organization,
    default_project_id: &str,
    default_project_name: &str,
    pr: GitPullRequest,
) -> Option<PullRequestSummary> {
    let repo = pr.repository?;
    let (project_id, project_name) = repo
        .project
        .as_ref()
        .map(|project| (project.id.clone(), project.name.clone()))
        .unwrap_or_else(|| {
            (
                default_project_id.to_string(),
                default_project_name.to_string(),
            )
        });
    let web_url = format!(
        "{}/{}/_git/{}/pullrequest/{}",
        org.base_url,
        encode_path_segment(&project_name),
        encode_path_segment(&repo.name),
        pr.pull_request_id
    );
    Some(PullRequestSummary {
        organization_id: org.id.clone(),
        project_id,
        project_name,
        repository_id: repo.id,
        repository_name: repo.name,
        pull_request_id: pr.pull_request_id,
        title: pr.title,
        status: pr.status,
        created_by: pr.created_by.and_then(|u| u.display_name.or(u.unique_name)),
        creation_date: pr.creation_date.to_rfc3339(),
        closed_date: pr.closed_date.map(|date| date.to_rfc3339()),
        source_ref_name: short_ref(&pr.source_ref_name),
        target_ref_name: short_ref(&pr.target_ref_name),
        web_url: Some(web_url),
        is_draft: pr.is_draft.unwrap_or(false),
    })
}

pub(crate) fn short_ref(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .to_string()
}

pub(crate) fn vote_label(vote: i32) -> &'static str {
    match vote {
        10 => "Approved",
        5 => "Approved w/ Suggestions",
        0 => "No Vote",
        -5 => "Waiting",
        -10 => "Rejected",
        _ => "No Vote",
    }
}

/// Resolves the authenticated user's (vote, is_required) for a PR. The user may
/// be a direct individual reviewer, or a reviewer only via a group/team. A group
/// reviewer rolls up its members' votes into `voted_for`; if the user voted that
/// way, surface their vote and treat them as required when the group is required.
/// Falls back to (No Vote, not required) when the user is not found — note a
/// group member who has not voted does not appear in `voted_for`, so that case
/// is not detectable from PR data alone.
fn resolve_reviewer_vote(reviewers: &[IdentityRefWithVote], user_id: &str) -> (i32, bool) {
    if let Some(direct) = reviewers.iter().find(|r| r.id.as_deref() == Some(user_id)) {
        return (direct.vote, direct.is_required);
    }
    reviewers
        .iter()
        .find_map(|group| {
            group
                .voted_for
                .as_deref()?
                .iter()
                .find(|member| member.id.as_deref() == Some(user_id))
                .map(|member| (member.vote, group.is_required))
        })
        .unwrap_or((0, false))
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

fn matches_query(summary: &PullRequestSummary, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }

    // Numeric queries also match the PR number by prefix.
    if query.bytes().all(|b| b.is_ascii_digit())
        && summary.pull_request_id.to_string().starts_with(query)
    {
        return true;
    }

    [
        summary.title.as_str(),
        summary.project_name.as_str(),
        summary.repository_name.as_str(),
        summary.created_by.as_deref().unwrap_or_default(),
        summary.source_ref_name.as_str(),
        summary.target_ref_name.as_str(),
    ]
    .iter()
    .any(|value| value.to_ascii_lowercase().contains(query))
}

fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}

// ── Cache sync ────────────────────────────────────────────────────────────────

struct SyncPrsResult {
    warning: Option<String>,
}

struct PrProjectFetch {
    project_id: String,
    label: String,
    result: Result<Vec<CachedPr>>,
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
    skipped: Vec<String>,
    last_skip_error: Option<AppError>,
}

struct ReviewPrsFetch {
    cached_reviews: Vec<CachedReviewPr>,
    failed_projects: Vec<String>,
}

async fn do_sync_prs(
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

    let synced_ids: Vec<&str> = active
        .synced_project_ids
        .iter()
        .map(String::as_str)
        .collect();
    db.replace_pull_requests_for_projects(&org.id, &synced_ids, &active.cached_prs)?;

    let mut warning_parts: Vec<String> = Vec::new();
    if !active.skipped.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to PR sync errors: {}.",
            active.skipped.len(),
            active.skipped.join(", ")
        ));
    }

    match review {
        Some(review) => {
            let mut review = review?;
            if review.failed_projects.is_empty() {
                enrich_review_ci_status(client, &mut review.cached_reviews, budget).await;
                db.replace_review_pull_requests(&org.id, &review.cached_reviews)?;
            } else {
                // A partial review list would silently drop PRs from the failed
                // projects, so keep the previous cache instead.
                warning_parts.push(format!(
                    "Review PR cache was not refreshed; query failed for project(s): {}.",
                    review.failed_projects.join(", ")
                ));
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
    let mut tasks: JoinSet<(String, Result<Vec<CachedReviewPr>>)> = JoinSet::new();
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
    while let Some(joined) = tasks.join_next().await {
        let (project_name, result) = joined
            .map_err(|e| AppError::AzureDevOps(format!("review PR sync task failed: {e}")))?;
        collect_review_fetch(
            org,
            project_name,
            result,
            &mut cached_reviews,
            &mut failed_projects,
        );
    }
    Ok(ReviewPrsFetch {
        cached_reviews,
        failed_projects,
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

// One project-level query replaces a request per repository; repositories
// with zero active PRs simply contribute nothing.
async fn fetch_active_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
) -> PrProjectFetch {
    let project_id = project.id.clone();
    let label = project.name.clone();
    let prs = match client
        .list_project_pull_requests(&project.id, PullRequestStatus::Active, PROJECT_PR_SYNC_TOP)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "pull request list returned 404, skipping project"
            );
            // 404 means the project is gone; treat as synced-empty so its
            // stale cached rows are cleaned up.
            return PrProjectFetch {
                project_id,
                label,
                result: Ok(Vec::new()),
            };
        }
        Err(e) => {
            return PrProjectFetch {
                project_id,
                label,
                result: Err(e.into()),
            }
        }
    };

    let cached = prs
        .into_iter()
        .filter_map(|pr| {
            let Some(repo) = pr.repository else {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    pull_request_id = pr.pull_request_id,
                    "pull request response carried no repository; skipping"
                );
                return None;
            };
            let project_name = repo
                .project
                .as_ref()
                .map(|p| p.name.clone())
                .unwrap_or_else(|| project.name.clone());
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                org.base_url,
                encode_path_segment(&project_name),
                encode_path_segment(&repo.name),
                pr.pull_request_id
            );
            Some(CachedPr {
                org_id: org.id.clone(),
                project_id: project.id.clone(),
                project_name,
                repository_id: repo.id,
                repository_name: repo.name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                status: pr.status,
                created_by: pr.created_by.and_then(|u| u.display_name.or(u.unique_name)),
                creation_date: pr.creation_date.to_rfc3339(),
                source_ref_name: short_ref(&pr.source_ref_name),
                target_ref_name: short_ref(&pr.target_ref_name),
                web_url: Some(web_url),
                is_draft: pr.is_draft.unwrap_or(false),
            })
        })
        .collect();
    PrProjectFetch {
        project_id,
        label,
        result: Ok(cached),
    }
}

async fn fetch_review_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    user_id: String,
) -> (String, Result<Vec<CachedReviewPr>>) {
    let project_name = project.name.clone();
    let prs = match client
        .list_pull_requests_by_reviewer(&project.id, &user_id, 200)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "review pull request list returned 404, skipping project"
            );
            return (project_name, Ok(Vec::new()));
        }
        Err(e) => return (project_name, Err(e.into())),
    };

    let mut cached_reviews = Vec::new();
    for pr in prs {
        let Some(repo) = &pr.repository else {
            continue;
        };
        let repo_id = repo.id.clone();
        let repo_name = repo.name.clone();
        let (proj_id, proj_name) = repo
            .project
            .as_ref()
            .map(|p| (p.id.clone(), p.name.clone()))
            .unwrap_or_else(|| (project.id.clone(), project.name.clone()));

        let (my_vote, my_is_required) =
            resolve_reviewer_vote(pr.reviewers.as_deref().unwrap_or(&[]), &user_id);

        let web_url = format!(
            "{}/{}/_git/{}/pullrequest/{}",
            org.base_url,
            encode_path_segment(&proj_name),
            encode_path_segment(&repo_name),
            pr.pull_request_id
        );
        cached_reviews.push(CachedReviewPr {
            org_id: org.id.clone(),
            project_id: proj_id,
            project_name: proj_name,
            repository_id: repo_id,
            repository_name: repo_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title.clone(),
            created_by: pr
                .created_by
                .as_ref()
                .and_then(|u| u.display_name.clone().or(u.unique_name.clone())),
            creation_date: pr.creation_date.to_rfc3339(),
            target_ref_name: short_ref(&pr.target_ref_name),
            web_url: Some(web_url),
            my_vote,
            my_vote_label: vote_label(my_vote).to_string(),
            my_is_required,
            is_draft: pr.is_draft.unwrap_or(false),
            merge_status: pr.merge_status.clone(),
            ci_status: None,
            ci_context: None,
            ci_check_count: 0,
        });
    }
    (project_name, Ok(cached_reviews))
}

// Threads are only fetched for the most recently created review PRs each sync.
pub(crate) const PR_COMMENT_SCAN_LIMIT: usize = 50;
// Concurrent thread fetches, mirroring CI_FETCH_CONCURRENCY so the comment scan
// does not serialize up to 50 network round-trips and block the sync loop.
const PR_COMMENT_FETCH_CONCURRENCY: usize = 6;

pub(crate) struct CommentHit {
    pub author: Option<String>,
    pub snippet: Option<String>,
}

// Azure DevOps stores mentions in comment content as `@<GUID>`. Matching the
// authenticated user's id substring (case-insensitive) catches it without
// depending on the exact bracket form.
fn mentions_user(content: &str, me: &str) -> bool {
    if me.is_empty() {
        return false;
    }
    content
        .to_ascii_lowercase()
        .contains(&me.to_ascii_lowercase())
}

fn truncate_snippet(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Pure detection of comment replies/mentions for a single PR.
///
/// Returns the hits to notify about and the largest comment id observed (used to
/// advance the per-PR "seen" cursor). A `last_seen` of `None` means this PR has
/// never been observed, so nothing is notified (avoids backfilling history) and
/// only the max id is reported. A comment is a hit when it is newer than
/// `last_seen`, authored by someone other than `me`, not a system comment, and
/// either lands in a thread the user has commented in (a reply) or mentions the
/// user.
pub(crate) fn pr_comment_notification_items(
    threads: &[GitThread],
    me: Option<&str>,
    last_seen: Option<i64>,
) -> (Vec<CommentHit>, Option<i64>) {
    let Some(me) = me else {
        return (Vec::new(), None);
    };
    let backfill = last_seen.is_none();
    let threshold = last_seen.unwrap_or(0);
    let mut max_id: Option<i64> = None;
    let mut hits = Vec::new();
    for thread in threads {
        if thread.is_deleted {
            continue;
        }
        let Some(comments) = thread.comments.as_ref() else {
            continue;
        };
        let i_am_in_thread = comments
            .iter()
            .any(|c| c.author.as_ref().and_then(|a| a.id.as_deref()) == Some(me));
        for comment in comments {
            if comment.is_deleted {
                continue;
            }
            max_id = Some(max_id.map_or(comment.id, |m| m.max(comment.id)));
            if backfill || comment.id <= threshold {
                continue;
            }
            let author_id = comment.author.as_ref().and_then(|a| a.id.as_deref());
            if author_id == Some(me) {
                continue;
            }
            if comment.comment_type.as_deref() == Some("system") {
                continue;
            }
            let content = comment.content.as_deref().unwrap_or("");
            if i_am_in_thread || mentions_user(content, me) {
                hits.push(CommentHit {
                    author: comment.author.as_ref().and_then(|a| a.display_name.clone()),
                    snippet: Some(truncate_snippet(content, 90)),
                });
            }
        }
    }
    (hits, max_id)
}

/// Fetches threads for the most recent review PRs, detects new reply/mention
/// comments, advances the per-PR seen cursor, and returns notification items.
/// A failure for one PR is logged and skipped so other PRs still get processed.
pub(crate) async fn collect_pr_comment_notifications(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Vec<PrNotificationItem> {
    let reviews = match db.list_review_pull_requests(&org.id) {
        Ok(reviews) => reviews,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "pr-notify: failed to list review PRs");
            return Vec::new();
        }
    };
    let me = org.authenticated_user_id.clone();
    let scanned: Vec<CachedReviewPr> = reviews.into_iter().take(PR_COMMENT_SCAN_LIMIT).collect();

    // Fetch each PR's threads concurrently (the network round-trip is the slow
    // part); keep results by index so PRs are still processed in their original
    // order below. A failure for one PR is logged and skipped.
    let mut threads_by_index: std::collections::HashMap<usize, Vec<GitThread>> =
        std::collections::HashMap::new();
    let mut tasks: JoinSet<(usize, Option<Vec<GitThread>>)> = JoinSet::new();
    for (index, pr) in scanned.iter().enumerate() {
        let client = client.clone();
        let org_name = org.name.clone();
        let project_id = pr.project_id.clone();
        let repository_id = pr.repository_id.clone();
        let pull_request_id = pr.pull_request_id;
        while tasks.len() >= PR_COMMENT_FETCH_CONCURRENCY {
            if let Some((idx, Some(threads))) = join_comment_task(&mut tasks).await {
                threads_by_index.insert(idx, threads);
            }
        }
        tasks.spawn(async move {
            let value = match client
                .list_pull_request_threads(&project_id, &repository_id, pull_request_id)
                .await
            {
                Ok(threads) => Some(threads),
                Err(e) => {
                    tracing::warn!(org = %org_name, pr = pull_request_id, error = ?e, "pr-notify: failed to fetch threads");
                    None
                }
            };
            (index, value)
        });
    }
    while !tasks.is_empty() {
        if let Some((idx, Some(threads))) = join_comment_task(&mut tasks).await {
            threads_by_index.insert(idx, threads);
        }
    }

    // Detect new comments and advance the seen cursor serially, in PR order, so
    // DB access stays single-threaded and notifications keep a stable order.
    let mut items = Vec::new();
    for (index, pr) in scanned.iter().enumerate() {
        let Some(threads) = threads_by_index.get(&index) else {
            continue;
        };
        let last_seen = db
            .get_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id)
            .unwrap_or(None);
        let (hits, max_id) = pr_comment_notification_items(threads, me.as_deref(), last_seen);
        for hit in hits {
            items.push(PrNotificationItem {
                kind: PrNotificationKind::CommentReply,
                pull_request_id: pr.pull_request_id,
                repository_id: pr.repository_id.clone(),
                title: pr.title.clone(),
                repository_name: pr.repository_name.clone(),
                project_name: pr.project_name.clone(),
                web_url: pr.web_url.clone(),
                comment_author: hit.author,
                snippet: hit.snippet,
            });
        }
        if let Some(max_id) = max_id {
            if let Err(e) =
                db.set_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id, max_id)
            {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "pr-notify: failed to update seen cursor");
            }
        }
    }
    items
}

async fn join_comment_task(
    tasks: &mut JoinSet<(usize, Option<Vec<GitThread>>)>,
) -> Option<(usize, Option<Vec<GitThread>>)> {
    match tasks.join_next().await {
        Some(Ok(result)) => Some(result),
        Some(Err(e)) => {
            tracing::warn!(error = %e, "PR comment thread task failed");
            None
        }
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::db::OrganizationDraft;
    use azdo_client::{GitThreadComment, IdentityRef};

    fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
        GitThreadComment {
            id,
            parent_comment_id: None,
            content: Some(content.into()),
            comment_type: Some("text".into()),
            author: Some(IdentityRef {
                id: Some(author_id.into()),
                display_name: Some(author_id.into()),
                unique_name: None,
            }),
            published_date: None,
            is_deleted: false,
        }
    }

    fn thread(id: i64, comments: Vec<GitThreadComment>) -> GitThread {
        GitThread {
            id,
            status: Some("active".into()),
            is_deleted: false,
            comments: Some(comments),
            thread_context: None,
        }
    }

    #[test]
    fn comment_items_suppressed_on_first_observation() {
        let threads = vec![thread(
            1,
            vec![comment(10, "me", "q"), comment(11, "other", "a")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), None);
        assert!(hits.is_empty());
        assert_eq!(max, Some(11));
    }

    #[test]
    fn comment_items_detects_reply_to_my_thread() {
        let threads = vec![thread(
            1,
            vec![comment(10, "me", "q"), comment(12, "other", "a")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(11));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].author.as_deref(), Some("other"));
        assert_eq!(max, Some(12));
    }

    #[test]
    fn comment_items_detects_mention_without_my_thread() {
        let threads = vec![thread(
            1,
            vec![comment(20, "other", "hello @<me-guid> please")],
        )];
        let (hits, _max) = pr_comment_notification_items(&threads, Some("me-guid"), Some(0));
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn comment_items_ignores_my_own_and_seen() {
        let threads = vec![thread(
            1,
            vec![comment(30, "me", "note"), comment(31, "other", "unrelated")],
        )];
        let (hits, _max) = pr_comment_notification_items(&threads, Some("me"), Some(31));
        assert!(hits.is_empty());
    }

    #[test]
    fn comment_items_ignores_unrelated_thread() {
        let threads = vec![thread(
            1,
            vec![comment(40, "alice", "hi"), comment(41, "bob", "yo")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(0));
        assert!(hits.is_empty());
        assert_eq!(max, Some(41));
    }

    #[tokio::test]
    async fn pr_sync_skips_failing_project_and_preserves_its_cache() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 2,
                "value": [
                    { "id": "project-ok", "name": "Platform" },
                    { "id": "project-bad", "name": "Broken" }
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-ok/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.status", "active"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 1,
                    "title": "Fresh PR",
                    "status": "active",
                    "creationDate": "2026-06-09T00:00:00Z",
                    "repository": {
                        "id": "repo-ok",
                        "name": "Good Repo",
                        "project": { "id": "project-ok", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/feature",
                    "targetRefName": "refs/heads/main"
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-bad/_apis/git/pullrequests"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db
            .upsert_organization(OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: None,
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: None,
                authenticated_user_display_name: None,
                authenticated_user_unique_name: None,
            })
            .unwrap();
        // Pre-existing cached PRs: one in the project that is about to fail
        // (must survive) and one in the healthy project (must be replaced).
        db.replace_pull_requests_for_projects(
            &org.id,
            &["project-bad", "project-ok"],
            &[
                CachedPr {
                    org_id: org.id.clone(),
                    project_id: "project-bad".to_string(),
                    project_name: "Broken".to_string(),
                    repository_id: "repo-bad".to_string(),
                    repository_name: "Bad Repo".to_string(),
                    pull_request_id: 99,
                    title: "Stale but preserved".to_string(),
                    status: "active".to_string(),
                    created_by: None,
                    creation_date: "2026-06-01T00:00:00Z".to_string(),
                    source_ref_name: "feature".to_string(),
                    target_ref_name: "main".to_string(),
                    web_url: None,
                    is_draft: false,
                },
                CachedPr {
                    org_id: org.id.clone(),
                    project_id: "project-ok".to_string(),
                    project_name: "Platform".to_string(),
                    repository_id: "repo-ok".to_string(),
                    repository_name: "Good Repo".to_string(),
                    pull_request_id: 98,
                    title: "Closed since last sync".to_string(),
                    status: "active".to_string(),
                    created_by: None,
                    creation_date: "2026-06-01T00:00:00Z".to_string(),
                    source_ref_name: "feature".to_string(),
                    target_ref_name: "main".to_string(),
                    web_url: None,
                    is_draft: false,
                },
            ],
        )
        .unwrap();

        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let projects = client.list_projects().await.unwrap();
        let budget: SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
        let result = do_sync_prs(&db, &client, &org, &projects, &budget)
            .await
            .unwrap();

        let cached = db.search_pull_requests(&org.id, None, None, None).unwrap();
        let titles: Vec<&str> = cached.iter().map(|pr| pr.title.as_str()).collect();
        assert!(titles.contains(&"Fresh PR"));
        assert!(titles.contains(&"Stale but preserved"));
        // The healthy project was fully replaced, so its stale row is gone.
        assert!(!titles.contains(&"Closed since last sync"));
        assert!(result
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("Broken")));
    }

    #[test]
    fn normalize_optional_trims_and_rejects_blank() {
        assert_eq!(
            normalize_optional(Some(" project-1 ".to_string())),
            Some("project-1".to_string())
        );
        assert_eq!(normalize_optional(Some("all".to_string())), None);
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
        assert_eq!(normalize_optional(None), None);
    }

    #[test]
    fn parse_search_statuses_routes_active_to_cache_and_others_live() {
        // Nothing selected defaults to the cached active path.
        assert!(matches!(
            parse_search_statuses(None).as_deref().unwrap(),
            [SearchStatus::CachedActive]
        ));
        assert!(matches!(
            parse_search_statuses(Some(&[])).as_deref().unwrap(),
            [SearchStatus::CachedActive]
        ));

        let owned = [" Active ".to_string(), "completed".to_string()];
        assert!(matches!(
            parse_search_statuses(Some(&owned)).as_deref().unwrap(),
            [
                SearchStatus::CachedActive,
                SearchStatus::Live(PullRequestStatus::Completed)
            ]
        ));

        // Duplicates collapse to a single entry.
        let dupes = ["active".to_string(), "Active".to_string()];
        assert_eq!(
            parse_search_statuses(Some(&dupes)).unwrap().len(),
            1,
            "duplicate statuses should be de-duplicated"
        );

        let abandoned = ["abandoned".to_string()];
        assert!(matches!(
            parse_search_statuses(Some(&abandoned)).as_deref().unwrap(),
            [SearchStatus::Live(PullRequestStatus::Abandoned)]
        ));

        let bad = ["draft".to_string()];
        assert!(parse_search_statuses(Some(&bad)).is_err());
    }

    #[test]
    fn normalize_set_drops_blanks_and_empty() {
        assert_eq!(normalize_set(None), None);
        assert_eq!(normalize_set(Some(vec![" ".to_string()])), None);
        assert_eq!(
            normalize_set(Some(vec![" repo-1 ".to_string(), "".to_string()])),
            Some(HashSet::from(["repo-1".to_string()]))
        );
    }

    #[test]
    fn parse_date_bound_spans_start_and_end_of_day() {
        let from = parse_date_bound(Some("2026-05-01"), false)
            .unwrap()
            .unwrap();
        let to = parse_date_bound(Some(" 2026-05-31 "), true)
            .unwrap()
            .unwrap();
        assert!(from.starts_with("2026-05-01T00:00:00"));
        assert!(to.starts_with("2026-05-31T23:59:59"));
        assert_eq!(parse_date_bound(None, false).unwrap(), None);
        assert_eq!(parse_date_bound(Some("  "), false).unwrap(), None);
        assert!(parse_date_bound(Some("not-a-date"), false).is_err());
    }

    #[test]
    fn within_window_is_inclusive_and_open_ended() {
        assert!(within_window("2026-05-10T00:00:00+00:00", None, None));
        assert!(within_window(
            "2026-05-10T00:00:00+00:00",
            Some("2026-05-01T00:00:00+00:00"),
            Some("2026-05-31T23:59:59+00:00"),
        ));
        assert!(!within_window(
            "2026-04-30T00:00:00+00:00",
            Some("2026-05-01T00:00:00+00:00"),
            None,
        ));
        assert!(!within_window(
            "2026-06-01T00:00:00+00:00",
            None,
            Some("2026-05-31T23:59:59+00:00"),
        ));
    }

    #[test]
    fn parse_date_basis_and_sort_by_default_and_match() {
        assert!(matches!(parse_date_basis(None), DateBasis::Created));
        assert!(matches!(
            parse_date_basis(Some("closed")),
            DateBasis::Closed
        ));
        assert_eq!(DateBasis::Closed.query_value(), "closed");
        assert!(matches!(parse_sort_by(None), SortBy::Created));
        assert!(matches!(parse_sort_by(Some("closed")), SortBy::Closed));
        assert!(matches!(parse_sort_by(Some("title")), SortBy::Title));
        assert!(matches!(parse_sort_by(Some("bogus")), SortBy::Created));
    }

    #[test]
    fn sort_summaries_orders_by_close_then_title() {
        let make = |id: i64, title: &str, created: &str, closed: Option<&str>| PullRequestSummary {
            organization_id: "o".into(),
            project_id: "p".into(),
            project_name: "P".into(),
            repository_id: "r".into(),
            repository_name: "R".into(),
            pull_request_id: id,
            title: title.into(),
            status: "completed".into(),
            created_by: None,
            creation_date: created.into(),
            closed_date: closed.map(str::to_string),
            source_ref_name: "f".into(),
            target_ref_name: "main".into(),
            web_url: None,
            is_draft: false,
        };
        let mut rows = vec![
            make(
                1,
                "banana",
                "2026-05-01T00:00:00Z",
                Some("2026-05-10T00:00:00Z"),
            ),
            make(2, "apple", "2026-05-02T00:00:00Z", None),
            make(
                3,
                "cherry",
                "2026-05-03T00:00:00Z",
                Some("2026-05-20T00:00:00Z"),
            ),
        ];

        sort_summaries(&mut rows, SortBy::Closed);
        // Most recent close first; the PR with no close date sorts last.
        assert_eq!(
            rows.iter().map(|r| r.pull_request_id).collect::<Vec<_>>(),
            vec![3, 1, 2]
        );

        sort_summaries(&mut rows, SortBy::Title);
        assert_eq!(
            rows.iter().map(|r| r.title.clone()).collect::<Vec<_>>(),
            vec!["apple", "banana", "cherry"]
        );
    }

    #[test]
    fn short_ref_removes_heads_prefix() {
        assert_eq!(short_ref("refs/heads/feature/prs"), "feature/prs");
        assert_eq!(short_ref("refs/tags/v1"), "refs/tags/v1");
    }

    fn reviewer(id: &str, vote: i32, is_required: bool) -> IdentityRefWithVote {
        IdentityRefWithVote {
            id: Some(id.to_string()),
            display_name: None,
            unique_name: None,
            vote,
            is_required,
            voted_for: None,
        }
    }

    #[test]
    fn resolve_reviewer_vote_prefers_direct_reviewer() {
        let reviewers = vec![reviewer("me", 10, true), reviewer("other", -10, false)];
        assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (10, true));
    }

    #[test]
    fn resolve_reviewer_vote_uses_group_rollup_when_not_direct() {
        // The user is not a direct reviewer; they voted via a required group whose
        // votedFor rolls up the member vote.
        let mut group = reviewer("team-guid", 0, true);
        group.voted_for = Some(vec![reviewer("me", 5, false)]);
        let reviewers = vec![reviewer("other", -10, false), group];
        // Member's vote, but the group's required flag.
        assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (5, true));
    }

    #[test]
    fn resolve_reviewer_vote_defaults_when_absent() {
        let reviewers = vec![reviewer("other", -10, true)];
        assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (0, false));
    }

    #[test]
    fn matches_query_checks_title_repo_author_and_branches() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 42,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            closed_date: None,
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
            is_draft: false,
        };

        assert!(matches_query(&summary, "dashboard"));
        assert!(matches_query(&summary, "test user"));
        assert!(matches_query(&summary, "pr-search"));
        assert!(!matches_query(&summary, "work item"));
    }

    #[test]
    fn matches_query_matches_pr_number_by_prefix() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 421,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            closed_date: None,
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
            is_draft: false,
        };

        assert!(matches_query(&summary, "421"));
        assert!(matches_query(&summary, "42"));
        assert!(!matches_query(&summary, "21"));
    }

    #[test]
    fn is_ado_not_found_only_matches_404_api_errors() {
        assert!(is_ado_not_found(&AdoError::api(
            404,
            "not found".to_string()
        )));
        assert!(!is_ado_not_found(&AdoError::api(
            500,
            "server error".to_string()
        )));
        assert!(!is_ado_not_found(&AdoError::Unauthorized));
    }
}
