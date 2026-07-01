use std::collections::HashSet;

use azdo_client::{AdoClient, GitPullRequest, PullRequestStatus};
use chrono::{NaiveDate, NaiveTime, TimeZone, Utc};

use super::*;
use crate::commits::encode_path_segment;
use crate::db::{CachedPr, Organization};
use crate::error::{AppError, Result};

/// Resolves the requested search status into either the cached-active fast path
/// or a live Azure DevOps query for historical statuses. Unknown values are
/// rejected so the UI cannot silently request an unsupported status.
pub(crate) enum SearchStatus {
    CachedActive,
    Live(PullRequestStatus),
}

/// Resolves the requested statuses, de-duplicating and defaulting to active
/// (the cheap cached path) when nothing is selected. Unknown values are
/// rejected so the UI cannot silently request an unsupported status.
pub(crate) fn parse_search_statuses(values: Option<&[String]>) -> Result<Vec<SearchStatus>> {
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
pub(crate) fn normalize_set(values: Option<Vec<String>>) -> Option<HashSet<String>> {
    let set: HashSet<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    (!set.is_empty()).then_some(set)
}

// How many search rows the UI renders; extra matches set the `truncated` flag.
pub(crate) const PR_SEARCH_RESULT_LIMIT: usize = 100;

/// Which date a date-window filter applies to.
#[derive(Clone, Copy)]
pub(crate) enum DateBasis {
    Created,
    Closed,
}

impl DateBasis {
    pub(crate) fn query_value(self) -> &'static str {
        match self {
            DateBasis::Created => "created",
            DateBasis::Closed => "closed",
        }
    }
}

pub(crate) fn parse_date_basis(value: Option<&str>) -> DateBasis {
    match value.map(str::trim) {
        Some("closed") => DateBasis::Closed,
        _ => DateBasis::Created,
    }
}

#[derive(Clone, Copy)]
pub(crate) enum SortBy {
    Created,
    Closed,
    Title,
}

pub(crate) fn parse_sort_by(value: Option<&str>) -> SortBy {
    match value.map(str::trim) {
        Some("closed") => SortBy::Closed,
        Some("title") => SortBy::Title,
        _ => SortBy::Created,
    }
}

pub(crate) fn sort_summaries(results: &mut [PullRequestSummary], sort_by: SortBy) {
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
pub(crate) fn parse_date_bound(value: Option<&str>, end_of_day: bool) -> Result<Option<String>> {
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
pub(crate) fn within_window(value: &str, from: Option<&str>, to: Option<&str>) -> bool {
    from.is_none_or(|f| value >= f) && to.is_none_or(|t| value <= t)
}

pub(crate) async fn project_id_name_pairs(client: &AdoClient) -> Result<Vec<(String, String)>> {
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
pub(crate) async fn fetch_status_prs_for_project(
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

pub(crate) fn cached_pr_to_summary(pr: CachedPr) -> PullRequestSummary {
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
        labels: pr.labels,
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
        labels: pr.labels.into_iter().map(|label| label.name).collect(),
    })
}

pub(crate) fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

pub(crate) fn matches_query(summary: &PullRequestSummary, query: &str) -> bool {
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
