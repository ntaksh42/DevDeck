use std::cmp::Ordering;

use chrono::DateTime;
use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::error::Result;
use crate::prs::{PullRequestService, PullRequestSummary};
use crate::work_items::{WorkItemService, WorkItemSummary};

const DEFAULT_LIMIT_PER_KIND: usize = 5;
const MAX_LIMIT_PER_KIND: usize = 50;

/// Orders two RFC3339 timestamps that may use different spellings of the same
/// instant (`+00:00` vs `Z`, with or without sub-second digits). Values that
/// cannot be parsed fall back to a string comparison, and absent values sort
/// last. Callers pass the arguments already swapped for a descending sort.
fn compare_timestamps_desc(left: Option<&str>, right: Option<&str>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => {
            match (
                DateTime::parse_from_rfc3339(left),
                DateTime::parse_from_rfc3339(right),
            ) {
                (Ok(left), Ok(right)) => left.cmp(&right),
                _ => left.cmp(right),
            }
        }
        // `None` is "no timestamp"; keep those at the end of a newest-first list.
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => Ordering::Equal,
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchKind {
    WorkItems,
    PullRequests,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllInput {
    pub organization_id: Option<String>,
    pub query: String,
    pub limit_per_kind: Option<usize>,
    pub kind: Option<SearchKind>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllTotals {
    pub work_items: usize,
    pub pull_requests: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllResult {
    pub work_items: Vec<WorkItemSummary>,
    pub pull_requests: Vec<PullRequestSummary>,
    /// Available hits, possibly bounded by the live query's limit + 1.
    pub totals: SearchAllTotals,
    pub warnings: Vec<String>,
}

pub async fn search_all(
    db: &AppDatabase,
    work_items: &WorkItemService,
    pull_requests: &PullRequestService,
    input: SearchAllInput,
) -> Result<SearchAllResult> {
    let query = input.query.trim();
    let limit = input
        .limit_per_kind
        .unwrap_or(DEFAULT_LIMIT_PER_KIND)
        .clamp(1, MAX_LIMIT_PER_KIND);
    if query.is_empty() {
        return finish_search(
            query,
            limit,
            input.kind,
            Ok(Vec::new()),
            Ok((Vec::new(), Vec::new())),
        );
    }
    if query.chars().count() > 200 {
        return Err(crate::error::AppError::InvalidInput(
            "Search text must be 200 characters or fewer".into(),
        ));
    }
    if query.bytes().all(|b| b.is_ascii_digit())
        && query.parse::<i32>().ok().is_none_or(|id| id < 1)
    {
        return Err(crate::error::AppError::InvalidInput(
            "Enter a valid positive item ID".into(),
        ));
    }
    let org = db.resolve_organization(input.organization_id.as_deref())?;
    let wi = async {
        if input.kind == Some(SearchKind::PullRequests) {
            return Ok(Vec::new());
        }
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            work_items.search_palette(&org.id, query, limit),
        )
        .await
        .map_err(|_| {
            crate::error::AppError::AzureDevOps("Work item search timed out. Please retry.".into())
        })?
    };
    let pr = async {
        if input.kind == Some(SearchKind::WorkItems) {
            return Ok((Vec::new(), Vec::new()));
        }
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            pull_requests.search_palette(&org.id, query),
        )
        .await
        .map_err(|_| {
            crate::error::AppError::AzureDevOps("PR search timed out. Please retry.".into())
        })?
    };
    let (wi, pr) = tokio::join!(wi, pr);
    finish_search(query, limit, input.kind, wi, pr)
}

fn finish_search(
    query: &str,
    limit: usize,
    kind: Option<SearchKind>,
    wi: Result<Vec<WorkItemSummary>>,
    pr: Result<(Vec<PullRequestSummary>, Vec<String>)>,
) -> Result<SearchAllResult> {
    let mut warnings = Vec::new();
    let mut success = 0;
    let mut work_items = match wi {
        Ok(rows) => {
            if kind != Some(SearchKind::PullRequests) {
                success += 1;
            }
            rows
        }
        Err(error) => {
            warnings.push(format!("Work item search failed: {error}"));
            Vec::new()
        }
    };
    let mut pull_requests = match pr {
        Ok((rows, notices)) => {
            if kind != Some(SearchKind::WorkItems) {
                success += 1;
            }
            warnings.extend(notices);
            rows
        }
        Err(error) => {
            warnings.push(format!("PR search failed: {error}"));
            Vec::new()
        }
    };
    if success == 0 {
        return Err(crate::error::AppError::AzureDevOps(warnings.join("; ")));
    }
    work_items.sort_by(|a, b| {
        (b.id.to_string() == query)
            .cmp(&(a.id.to_string() == query))
            .then_with(|| {
                compare_timestamps_desc(b.changed_date.as_deref(), a.changed_date.as_deref())
            })
    });
    pull_requests.sort_by(|a, b| {
        (b.pull_request_id.to_string() == query)
            .cmp(&(a.pull_request_id.to_string() == query))
            .then_with(|| compare_timestamps_desc(Some(&b.creation_date), Some(&a.creation_date)))
    });
    let totals = SearchAllTotals {
        work_items: work_items.len(),
        pull_requests: pull_requests.len(),
    };
    work_items.truncate(limit);
    pull_requests.truncate(limit);
    Ok(SearchAllResult {
        work_items,
        pull_requests,
        totals,
        warnings,
    })
}

#[cfg(test)]
mod tests;
