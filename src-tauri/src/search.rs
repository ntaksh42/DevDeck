use std::cmp::Ordering;

use chrono::DateTime;
use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::error::Result;
use crate::prs::{PullRequestService, PullRequestSummary, SearchPullRequestsInput};
use crate::work_items::{SearchWorkItemsInput, WorkItemService, WorkItemSummary};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllInput {
    pub organization_id: Option<String>,
    pub query: String,
    pub limit_per_kind: Option<usize>,
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
    pub totals: SearchAllTotals,
}

type OrganizationHits = (Vec<WorkItemSummary>, Vec<PullRequestSummary>);

async fn search_organization(
    work_items: &WorkItemService,
    pull_requests: &PullRequestService,
    org_id: &str,
    query: &str,
) -> Result<OrganizationHits> {
    let work_item_hits = work_items.search(SearchWorkItemsInput {
        organization_id: Some(org_id.to_string()),
        query: Some(query.to_string()),
        states: None,
        work_item_types: None,
        project_ids: None,
    })?;
    let pull_request_hits = pull_requests
        .search(SearchPullRequestsInput {
            organization_id: Some(org_id.to_string()),
            query: Some(query.to_string()),
            statuses: None,
            project_ids: None,
            repository_ids: None,
            target_branches: None,
            from_date: None,
            to_date: None,
            date_basis: None,
            exclude_drafts: None,
            sort_by: None,
        })
        .await?
        .pull_requests;
    Ok((work_item_hits, pull_request_hits))
}

pub async fn search_all(
    db: &AppDatabase,
    work_items: &WorkItemService,
    pull_requests: &PullRequestService,
    input: SearchAllInput,
) -> Result<SearchAllResult> {
    let query = input.query.trim().to_string();
    let limit = input
        .limit_per_kind
        .unwrap_or(DEFAULT_LIMIT_PER_KIND)
        .clamp(1, MAX_LIMIT_PER_KIND);

    if query.is_empty() {
        return Ok(SearchAllResult {
            work_items: Vec::new(),
            pull_requests: Vec::new(),
            totals: SearchAllTotals {
                work_items: 0,
                pull_requests: 0,
            },
        });
    }

    // Without an explicit organization the palette searches every configured
    // organization and merges the results.
    let org_ids: Vec<String> = match input.organization_id {
        Some(id) => vec![id],
        None => db
            .list_organizations()?
            .into_iter()
            .map(|organization| organization.id)
            .collect(),
    };

    let mut work_item_results = Vec::new();
    let mut pull_request_results = Vec::new();
    let mut succeeded = 0;
    let mut last_error = None;
    for org_id in &org_ids {
        match search_organization(work_items, pull_requests, org_id, &query).await {
            Ok((work_item_hits, pull_request_hits)) => {
                work_item_results.extend(work_item_hits);
                pull_request_results.extend(pull_request_hits);
                succeeded += 1;
            }
            // One failing connection (e.g. a GitHub outage) must not blank the
            // palette for the others; only fail when nothing could be searched.
            Err(error) => {
                tracing::warn!(organization = %org_id, error = ?error, "search: organization search failed");
                last_error = Some(error);
            }
        }
    }
    if let (0, Some(error)) = (succeeded, last_error) {
        return Err(error);
    }
    if org_ids.len() > 1 {
        // Results from different providers spell the same instant differently:
        // Azure DevOps emits `to_rfc3339()` (`+00:00`) while GitHub passes its
        // `...Z` timestamps through untouched. Comparing those as raw strings
        // orders `.500+00:00` before `Z` within the same second, so parse to an
        // instant and fall back to the string only when a value cannot be read.
        work_item_results.sort_by(|a, b| {
            compare_timestamps_desc(b.changed_date.as_deref(), a.changed_date.as_deref())
        });
        pull_request_results.sort_by(|a, b| {
            compare_timestamps_desc(Some(&b.creation_date), Some(&a.creation_date))
        });
    }

    // Totals are bounded by each underlying search's own cap, not exact counts.
    let totals = SearchAllTotals {
        work_items: work_item_results.len(),
        pull_requests: pull_request_results.len(),
    };
    work_item_results.truncate(limit);
    pull_request_results.truncate(limit);

    Ok(SearchAllResult {
        work_items: work_item_results,
        pull_requests: pull_request_results,
        totals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AppDatabase, CachedPr, CachedWorkItem, OrganizationDraft};
    use crate::secrets::SecretStore;

    fn make_services() -> (
        tempfile::NamedTempFile,
        AppDatabase,
        WorkItemService,
        PullRequestService,
    ) {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(OrganizationDraft {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".to_string(),
        })
        .unwrap();

        db.upsert_work_items(&[
            CachedWorkItem {
                org_id: "contoso".to_string(),
                project_id: "p1".to_string(),
                project_name: "Platform".to_string(),
                id: 42,
                title: "fix retry storm".to_string(),
                work_item_type: Some("Bug".to_string()),
                state: Some("Active".to_string()),
                assigned_to: None,
                assigned_to_unique_name: None,
                changed_date: Some("2026-06-01T00:00:00Z".to_string()),
                web_url: None,
                tags: None,
            },
            CachedWorkItem {
                org_id: "contoso".to_string(),
                project_id: "p1".to_string(),
                project_name: "Platform".to_string(),
                id: 7,
                title: "unrelated item".to_string(),
                work_item_type: Some("Task".to_string()),
                state: Some("New".to_string()),
                assigned_to: None,
                assigned_to_unique_name: None,
                changed_date: Some("2026-06-02T00:00:00Z".to_string()),
                web_url: None,
                tags: None,
            },
        ])
        .unwrap();
        db.replace_pull_requests_for_projects(
            "contoso",
            &["p1"],
            &[CachedPr {
                org_id: "contoso".to_string(),
                project_id: "p1".to_string(),
                project_name: "Platform".to_string(),
                repository_id: "repo1".to_string(),
                repository_name: "platform-api".to_string(),
                pull_request_id: 421,
                title: "Add retry backoff".to_string(),
                status: "active".to_string(),
                created_by: Some("Alice".to_string()),
                created_by_id: None,
                creation_date: "2026-06-03T00:00:00Z".to_string(),
                source_ref_name: "refs/heads/retry-backoff".to_string(),
                target_ref_name: "refs/heads/main".to_string(),
                web_url: None,
                is_draft: false,
            }],
        )
        .unwrap();

        (
            db_file,
            db.clone(),
            WorkItemService::new(db.clone(), SecretStore),
            PullRequestService::new(db, SecretStore),
        )
    }

    #[tokio::test]
    async fn search_all_groups_results_by_kind() {
        let (_db_file, db, work_items, pull_requests) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "retry".to_string(),
                limit_per_kind: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.work_items.len(), 1);
        assert_eq!(result.work_items[0].id, 42);
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].pull_request_id, 421);
        assert_eq!(
            result.totals,
            SearchAllTotals {
                work_items: 1,
                pull_requests: 1,
            }
        );
    }

    #[tokio::test]
    async fn search_all_numeric_query_matches_work_item_and_pr_ids() {
        let (_db_file, db, work_items, pull_requests) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "42".to_string(),
                limit_per_kind: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.work_items.len(), 1);
        assert_eq!(result.work_items[0].id, 42);
        // PR #421 matches the numeric query by ID prefix.
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].pull_request_id, 421);
    }

    #[tokio::test]
    async fn search_all_reports_the_error_when_no_organization_can_be_searched() {
        let (_db_file, db, work_items, pull_requests) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: Some("missing".to_string()),
                query: "retry".to_string(),
                limit_per_kind: None,
            },
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn search_all_empty_query_returns_nothing() {
        let (_db_file, db, work_items, pull_requests) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "   ".to_string(),
                limit_per_kind: None,
            },
        )
        .await
        .unwrap();

        assert!(result.work_items.is_empty());
        assert!(result.pull_requests.is_empty());
    }

    #[tokio::test]
    async fn search_all_without_organization_searches_every_org() {
        let (_db_file, db, work_items, pull_requests) = make_services();
        db.upsert_organization(OrganizationDraft {
            id: "fabrikam".to_string(),
            name: "fabrikam".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/fabrikam".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:fabrikam:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".to_string(),
        })
        .unwrap();
        db.upsert_work_items(&[CachedWorkItem {
            org_id: "fabrikam".to_string(),
            project_id: "p9".to_string(),
            project_name: "Fabrikam".to_string(),
            id: 900,
            title: "retry tuning in fabrikam".to_string(),
            work_item_type: Some("Task".to_string()),
            state: Some("New".to_string()),
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: Some("2026-06-06T00:00:00Z".to_string()),
            web_url: None,
            tags: None,
        }])
        .unwrap();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: None,
                query: "retry".to_string(),
                limit_per_kind: None,
            },
        )
        .await
        .unwrap();

        let orgs: Vec<&str> = result
            .work_items
            .iter()
            .map(|item| item.organization_id.as_str())
            .collect();
        assert!(orgs.contains(&"contoso"));
        assert!(orgs.contains(&"fabrikam"));
        // Most recently changed first when merging organizations.
        assert_eq!(result.work_items[0].id, 900);
    }

    #[tokio::test]
    async fn search_all_respects_limit_per_kind() {
        let (_db_file, db, work_items, pull_requests) = make_services();

        let extra: Vec<CachedWorkItem> = (100..110)
            .map(|id| CachedWorkItem {
                org_id: "contoso".to_string(),
                project_id: "p1".to_string(),
                project_name: "Platform".to_string(),
                id,
                title: format!("retry follow-up {id}"),
                work_item_type: Some("Task".to_string()),
                state: Some("New".to_string()),
                assigned_to: None,
                assigned_to_unique_name: None,
                changed_date: Some("2026-06-05T00:00:00Z".to_string()),
                web_url: None,
                tags: None,
            })
            .collect();
        db.upsert_work_items(&extra).unwrap();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "retry".to_string(),
                limit_per_kind: Some(3),
            },
        )
        .await
        .unwrap();

        assert_eq!(result.work_items.len(), 3);
        assert_eq!(result.totals.work_items, 11);
    }

    #[test]
    fn compare_timestamps_orders_mixed_rfc3339_spellings_by_instant() {
        // Azure DevOps emits `+00:00`, GitHub emits `Z`. Within the same second
        // a raw string comparison puts `.500+00:00` before `Z` even though it
        // is the later instant.
        let azdo = "2026-06-17T12:00:00.500+00:00";
        let github = "2026-06-17T12:00:00Z";
        assert_eq!(
            compare_timestamps_desc(Some(azdo), Some(github)),
            Ordering::Greater
        );
        assert_eq!(
            compare_timestamps_desc(Some(github), Some(azdo)),
            Ordering::Less
        );
        // Same instant written two ways compares equal.
        assert_eq!(
            compare_timestamps_desc(Some("2026-06-17T12:00:00+00:00"), Some(github)),
            Ordering::Equal
        );
    }

    #[test]
    fn compare_timestamps_sorts_missing_values_last_in_a_newest_first_list() {
        let mut values = vec![
            None,
            Some("2026-06-17T12:00:00Z"),
            None,
            Some("2026-06-18T12:00:00Z"),
        ];
        // Mirrors the call shape used for the descending sorts above.
        values.sort_by(|a, b| compare_timestamps_desc(*b, *a));
        assert_eq!(
            values,
            vec![
                Some("2026-06-18T12:00:00Z"),
                Some("2026-06-17T12:00:00Z"),
                None,
                None
            ]
        );
    }

    #[test]
    fn compare_timestamps_falls_back_to_string_order_for_unparseable_values() {
        assert_eq!(
            compare_timestamps_desc(Some("b"), Some("a")),
            Ordering::Greater
        );
    }
}
