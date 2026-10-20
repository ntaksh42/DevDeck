//! Group/team reviews in projects whose active-PR list hit the query cap.
//!
//! Group reviews are normally matched against the active PR list
//! (`group_reviews`), which is truncated at `PROJECT_PR_SYNC_TOP` in a busy
//! project and would miss anything past the cap. For those projects the PRs are
//! asked for per group instead: `searchCriteria.reviewerId` also matches a group
//! when given the group's own id, and is paged in full.

use std::collections::{HashMap, HashSet};

use azdo_client::{AdoClient, GitPullRequest, TeamProject};
use tokio::task::JoinSet;

use super::sync_fetch::{list_reviews_of, review_prs_to_cached};
use crate::db::{CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::sync::SyncBudget;

#[derive(Default)]
pub(crate) struct CappedGroupReviews {
    pub(crate) reviews: Vec<CachedReviewPr>,
    /// Projects whose every group query succeeded, so their review rows can be
    /// replaced rather than merged.
    pub(crate) synced_project_ids: Vec<String>,
    pub(crate) failed_projects: Vec<String>,
}

type GroupFetch = (usize, Result<Vec<GitPullRequest>>);

pub(crate) async fn fetch_capped_group_reviews(
    client: &AdoClient,
    org: &Organization,
    capped_projects: &[TeamProject],
    group_ids: &HashSet<String>,
    user_id: &str,
    budget: &SyncBudget,
) -> Result<CappedGroupReviews> {
    let mut tasks: JoinSet<GroupFetch> = JoinSet::new();
    for (index, project) in capped_projects.iter().enumerate() {
        for group_id in group_ids {
            let client = client.clone();
            let org = org.clone();
            let project = project.clone();
            let group_id = group_id.clone();
            let budget = budget.clone();
            tasks.spawn(async move {
                let _permit = budget.acquire_owned().await;
                (
                    index,
                    list_reviews_of(&client, &org, &project, &group_id, 200).await,
                )
            });
        }
    }

    let mut by_project: Vec<HashMap<(String, i64), GitPullRequest>> =
        capped_projects.iter().map(|_| HashMap::new()).collect();
    let mut failed = vec![false; capped_projects.len()];
    while let Some(joined) = tasks.join_next().await {
        let (index, result) = joined
            .map_err(|e| AppError::AzureDevOps(format!("group review sync task failed: {e}")))?;
        match result {
            Ok(prs) => {
                for pr in prs {
                    let Some(repo_id) = pr.repository.as_ref().map(|r| r.id.clone()) else {
                        continue;
                    };
                    by_project[index].insert((repo_id, pr.pull_request_id), pr);
                }
            }
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %capped_projects[index].name,
                    error = %e,
                    "group review query failed for capped project, preserving cached data"
                );
                failed[index] = true;
            }
        }
    }

    let mut out = CappedGroupReviews::default();
    for ((project, prs), failed) in capped_projects.iter().zip(by_project).zip(failed) {
        if failed {
            out.failed_projects.push(project.name.clone());
            continue;
        }
        out.synced_project_ids.push(project.id.clone());
        out.reviews.extend(review_prs_to_cached(
            prs.into_values().collect(),
            org,
            project,
            user_id,
            Some(group_ids),
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use tokio::sync::Semaphore;
    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn org() -> Organization {
        Organization {
            id: "contoso".into(),
            name: "contoso".into(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".into(),
            auth_provider: "pat".into(),
            credential_key: "azdodeck:org:contoso:pat".into(),
            authenticated_user_id: Some("me".into()),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            created_at: String::new(),
            updated_at: String::new(),
            provider_kind: "azdo".into(),
        }
    }

    fn pr_json(id: i64, author: &str) -> serde_json::Value {
        json!({
            "pullRequestId": id,
            "title": format!("PR {id}"),
            "status": "active",
            "creationDate": "2026-06-09T00:00:00Z",
            "createdBy": { "id": author, "displayName": author },
            "repository": { "id": "repo", "name": "Repo" },
            "sourceRefName": "refs/heads/feature",
            "targetRefName": "refs/heads/main",
            "reviewers": [{ "id": "team", "vote": 0, "isRequired": true }]
        })
    }

    async fn mount_group(
        server: &MockServer,
        project: &str,
        skip: &str,
        prs: Vec<serde_json::Value>,
    ) {
        Mock::given(method("GET"))
            .and(path(format!("/{project}/_apis/git/pullrequests")))
            .and(query_param("searchCriteria.reviewerId", "team"))
            .and(query_param("$skip", skip))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "count": prs.len(), "value": prs })),
            )
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn queries_each_group_and_skips_own_prs() {
        let server = MockServer::start().await;
        mount_group(
            &server,
            "busy",
            "0",
            vec![pr_json(1, "alice"), pr_json(2, "me")],
        )
        .await;
        mount_group(&server, "busy", "2", vec![]).await;
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("pat")))
            .unwrap()
            .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
        let projects = vec![TeamProject {
            id: "busy".into(),
            name: "Busy".into(),
        }];
        let groups: HashSet<String> = ["team".to_string()].into();
        let budget: SyncBudget = Arc::new(Semaphore::new(4));

        let out = fetch_capped_group_reviews(&client, &org(), &projects, &groups, "me", &budget)
            .await
            .unwrap();

        assert_eq!(out.synced_project_ids, vec!["busy".to_string()]);
        assert!(out.failed_projects.is_empty());
        assert_eq!(out.reviews.len(), 1);
        assert_eq!(out.reviews[0].pull_request_id, 1);
        assert!(out.reviews[0].my_is_required);
    }

    #[tokio::test]
    async fn failed_group_query_leaves_project_unsynced() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/busy/_apis/git/pullrequests"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("pat")))
            .unwrap()
            .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
        let projects = vec![TeamProject {
            id: "busy".into(),
            name: "Busy".into(),
        }];
        let groups: HashSet<String> = ["team".to_string()].into();
        let budget: SyncBudget = Arc::new(Semaphore::new(4));

        let out = fetch_capped_group_reviews(&client, &org(), &projects, &groups, "me", &budget)
            .await
            .unwrap();

        assert!(out.synced_project_ids.is_empty());
        assert_eq!(out.failed_projects, vec!["Busy".to_string()]);
    }
}
