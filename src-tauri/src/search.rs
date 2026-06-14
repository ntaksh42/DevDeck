use serde::{Deserialize, Serialize};

use crate::commits::{CommitService, CommitSummary, SearchCommitsInput};
use crate::db::AppDatabase;
use crate::error::Result;
use crate::prs::{PullRequestService, PullRequestSummary, SearchPullRequestsInput};
use crate::work_items::{SearchWorkItemsInput, WorkItemService, WorkItemSummary};

const DEFAULT_LIMIT_PER_KIND: usize = 5;
const MAX_LIMIT_PER_KIND: usize = 50;

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
    pub commits: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAllResult {
    pub work_items: Vec<WorkItemSummary>,
    pub pull_requests: Vec<PullRequestSummary>,
    pub commits: Vec<CommitSummary>,
    pub totals: SearchAllTotals,
}

pub fn search_all(
    db: &AppDatabase,
    work_items: &WorkItemService,
    pull_requests: &PullRequestService,
    commits: &CommitService,
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
            commits: Vec::new(),
            totals: SearchAllTotals {
                work_items: 0,
                pull_requests: 0,
                commits: 0,
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
    let mut commit_results = Vec::new();
    for org_id in &org_ids {
        work_item_results.extend(
            work_items
                .search(SearchWorkItemsInput {
                    organization_id: Some(org_id.clone()),
                    query: Some(query.clone()),
                    state: None,
                    work_item_type: None,
                    project_id: None,
                })?
                .items,
        );
        pull_request_results.extend(pull_requests.search(SearchPullRequestsInput {
            organization_id: Some(org_id.clone()),
            query: Some(query.clone()),
            status: None,
            project_id: None,
            repository_id: None,
        })?);
        commit_results.extend(commits.search(SearchCommitsInput {
            organization_id: Some(org_id.clone()),
            query: Some(query.clone()),
            author: None,
            branch: None,
            from_date: None,
            to_date: None,
            project_id: None,
            repository_id: None,
        })?);
    }
    if org_ids.len() > 1 {
        work_item_results.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
        pull_request_results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        commit_results.sort_by(|a, b| b.author_date.cmp(&a.author_date));
    }

    // Totals are bounded by each underlying search's own cap, not exact counts.
    let totals = SearchAllTotals {
        work_items: work_item_results.len(),
        pull_requests: pull_request_results.len(),
        commits: commit_results.len(),
    };
    work_item_results.truncate(limit);
    pull_request_results.truncate(limit);
    commit_results.truncate(limit);

    Ok(SearchAllResult {
        work_items: work_item_results,
        pull_requests: pull_request_results,
        commits: commit_results,
        totals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AppDatabase, CachedCommit, CachedPr, CachedWorkItem, OrganizationDraft};
    use crate::secrets::SecretStore;

    fn make_services() -> (
        tempfile::NamedTempFile,
        AppDatabase,
        WorkItemService,
        PullRequestService,
        CommitService,
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
                creation_date: "2026-06-03T00:00:00Z".to_string(),
                source_ref_name: "refs/heads/retry-backoff".to_string(),
                target_ref_name: "refs/heads/main".to_string(),
                web_url: None,
            }],
        )
        .unwrap();
        db.replace_commits_for_repo(
            "contoso",
            "repo1",
            &[CachedCommit {
                org_id: "contoso".to_string(),
                project_id: "p1".to_string(),
                project_name: "Platform".to_string(),
                repository_id: "repo1".to_string(),
                repository_name: "platform-api".to_string(),
                commit_id: "abc1234567890".to_string(),
                comment: "tune retry delays".to_string(),
                author_name: Some("Alice".to_string()),
                author_email: None,
                author_date: Some("2026-06-04T00:00:00Z".to_string()),
                web_url: None,
            }],
        )
        .unwrap();

        (
            db_file,
            db.clone(),
            WorkItemService::new(db.clone(), SecretStore),
            PullRequestService::new(db.clone(), SecretStore),
            CommitService::new(db, SecretStore),
        )
    }

    #[test]
    fn search_all_groups_results_by_kind() {
        let (_db_file, db, work_items, pull_requests, commits) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            &commits,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "retry".to_string(),
                limit_per_kind: None,
            },
        )
        .unwrap();

        assert_eq!(result.work_items.len(), 1);
        assert_eq!(result.work_items[0].id, 42);
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].pull_request_id, 421);
        assert_eq!(result.commits.len(), 1);
        assert_eq!(result.commits[0].comment, "tune retry delays");
        assert_eq!(
            result.totals,
            SearchAllTotals {
                work_items: 1,
                pull_requests: 1,
                commits: 1,
            }
        );
    }

    #[test]
    fn search_all_numeric_query_matches_work_item_and_pr_ids() {
        let (_db_file, db, work_items, pull_requests, commits) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            &commits,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "42".to_string(),
                limit_per_kind: None,
            },
        )
        .unwrap();

        assert_eq!(result.work_items.len(), 1);
        assert_eq!(result.work_items[0].id, 42);
        // PR #421 matches the numeric query by ID prefix.
        assert_eq!(result.pull_requests.len(), 1);
        assert_eq!(result.pull_requests[0].pull_request_id, 421);
    }

    #[test]
    fn search_all_empty_query_returns_nothing() {
        let (_db_file, db, work_items, pull_requests, commits) = make_services();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            &commits,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "   ".to_string(),
                limit_per_kind: None,
            },
        )
        .unwrap();

        assert!(result.work_items.is_empty());
        assert!(result.pull_requests.is_empty());
        assert!(result.commits.is_empty());
    }

    #[test]
    fn search_all_without_organization_searches_every_org() {
        let (_db_file, db, work_items, pull_requests, commits) = make_services();
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
        }])
        .unwrap();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            &commits,
            SearchAllInput {
                organization_id: None,
                query: "retry".to_string(),
                limit_per_kind: None,
            },
        )
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

    #[test]
    fn search_all_respects_limit_per_kind() {
        let (_db_file, db, work_items, pull_requests, commits) = make_services();

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
            })
            .collect();
        db.upsert_work_items(&extra).unwrap();

        let result = search_all(
            &db,
            &work_items,
            &pull_requests,
            &commits,
            SearchAllInput {
                organization_id: Some("contoso".to_string()),
                query: "retry".to_string(),
                limit_per_kind: Some(3),
            },
        )
        .unwrap();

        assert_eq!(result.work_items.len(), 3);
        assert_eq!(result.totals.work_items, 11);
    }
}
