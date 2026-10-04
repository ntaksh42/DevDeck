//! A project whose active-PR query returned `PROJECT_PR_SYNC_TOP` PRs has a
//! truncated snapshot; syncing it must not delete the project's other cached
//! PRs, which still exist upstream (#476).

use std::sync::Arc;

use azdo_client::{AdoClient, PatProvider};
use serde_json::json;
use tokio::sync::Semaphore;
use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::sync::do_sync_prs;
use super::util::PROJECT_PR_SYNC_TOP;
use crate::db::{AppDatabase, CachedPr, OrganizationDraft};
use crate::sync::SyncBudget;

fn pr_json(id: i64) -> serde_json::Value {
    json!({
        "pullRequestId": id,
        "title": format!("PR {id}"),
        "status": "active",
        "creationDate": "2026-06-09T00:00:00Z",
        "repository": {
            "id": "repo-1",
            "name": "Repo",
            "project": { "id": "project-1", "name": "Platform" }
        },
        "sourceRefName": "refs/heads/feature",
        "targetRefName": "refs/heads/main"
    })
}

fn old_pr(org_id: &str) -> CachedPr {
    CachedPr {
        org_id: org_id.to_string(),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id: 999_999,
        title: "Older PR outside the window".to_string(),
        status: "active".to_string(),
        created_by: None,
        created_by_id: None,
        // Sorts first in the (500-row, newest-first) cache search, so the
        // assertions can see it even when the fetched window fills the list.
        creation_date: "2099-01-01T00:00:00Z".to_string(),
        source_ref_name: "feature".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    }
}

async fn sync_with(
    returned: usize,
) -> (AppDatabase, String, Option<String>, tempfile::NamedTempFile) {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-1", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    let prs: Vec<_> = (1..=returned as i64).map(pr_json).collect();
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "count": prs.len(), "value": prs })),
        )
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
            provider_kind: "azdo".to_string(),
        })
        .unwrap();
    db.replace_pull_requests_for_projects(&org.id, &["project-1"], &[old_pr(&org.id)])
        .unwrap();

    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);
    let projects = client.list_projects().await.unwrap();
    let budget: SyncBudget = Arc::new(Semaphore::new(8));
    // `force_refresh` so a shared cache written by another test run is never used.
    let result = do_sync_prs(&db, &client, &org, &projects, &budget, true)
        .await
        .unwrap();
    (db, org.id, result.warning, db_file)
}

#[tokio::test]
async fn capped_project_keeps_cached_prs_outside_the_fetched_window() {
    let (db, org_id, warning, _file) = sync_with(PROJECT_PR_SYNC_TOP as usize).await;

    let titles: Vec<String> = db
        .search_pull_requests(&org_id, None, None, None)
        .unwrap()
        .into_iter()
        .map(|pr| pr.title)
        .collect();
    assert!(titles.contains(&"Older PR outside the window".to_string()));
    assert!(titles.contains(&"PR 1".to_string()));
    let warning = warning.expect("a capped project is a sync warning");
    assert!(warning.contains("Platform"), "{warning}");
}

#[tokio::test]
async fn uncapped_project_still_drops_prs_that_are_no_longer_active() {
    let (db, org_id, warning, _file) = sync_with(3).await;

    let titles: Vec<String> = db
        .search_pull_requests(&org_id, None, None, None)
        .unwrap()
        .into_iter()
        .map(|pr| pr.title)
        .collect();
    assert!(!titles.contains(&"Older PR outside the window".to_string()));
    assert_eq!(titles.len(), 3);
    // (The org has no signed-in user id, so an unrelated My Reviews warning is
    // expected; there must be no cap warning.)
    assert!(warning.is_none_or(|w| !w.contains("or more active PRs")));
}
