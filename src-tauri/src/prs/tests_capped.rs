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
        // Older than the fetched window, as rows the window misses are.
        creation_date: "2020-01-01T00:00:00Z".to_string(),
        source_ref_name: "feature".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    }
}

async fn sync_with(
    returned: usize,
    reuse_shared_cache: bool,
    creator: Option<&str>,
) -> (AppDatabase, String, Option<String>, tempfile::NamedTempFile) {
    sync_capped(returned, reuse_shared_cache, creator, "active", false).await
}

fn cached_ids(db: &AppDatabase, org_id: &str) -> Vec<i64> {
    db.list_cached_pr_keys(org_id, "project-1")
        .unwrap()
        .into_iter()
        .map(|row| row.pull_request_id)
        .collect()
}

/// `old_status` is what Azure DevOps reports for the cached PR outside the
/// window when it is checked one by one.
async fn sync_capped(
    returned: usize,
    reuse_shared_cache: bool,
    creator: Option<&str>,
    old_status: &str,
    rebuild: bool,
) -> (AppDatabase, String, Option<String>, tempfile::NamedTempFile) {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests/999999",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pullRequestId": 999_999, "title": "Older PR outside the window", "status": old_status,
            "sourceRefName": "refs/heads/feature", "targetRefName": "refs/heads/main"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-1", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    if let Some(user) = creator {
        let mut authored = pr_json(700);
        authored["createdBy"] = json!({ "id": user });
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.creatorId", user))
            .and(query_param("$skip", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 0, "value": []
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.creatorId", user))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1, "value": [authored]
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.reviewerId", user))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 0, "value": []
            })))
            .mount(&server)
            .await;
    }
    let prs: Vec<_> = (1..=returned as i64).map(pr_json).collect();
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "count": prs.len(), "value": prs })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            // The rebuild request is process-wide per org id; keep it apart
            // from the tests running in parallel.
            id: if rebuild {
                "contoso-rebuild"
            } else {
                "contoso"
            }
            .to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: creator.map(str::to_owned),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".to_string(),
        })
        .unwrap();
    let mut cached = old_pr(&org.id);
    cached.created_by_id = creator.map(str::to_owned);
    db.replace_pull_requests_for_projects(&org.id, &["project-1"], &[cached])
        .unwrap();

    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);
    let projects = client.list_projects().await.unwrap();
    let budget: SyncBudget = Arc::new(Semaphore::new(8));
    if rebuild {
        super::request_rebuild([org.id.clone()]);
    }
    // `force_refresh` so a shared cache written by another test run is never used.
    let result = do_sync_prs(&db, &client, &org, &projects, &budget, true)
        .await
        .unwrap();
    let result = if reuse_shared_cache {
        do_sync_prs(&db, &client, &org, &projects, &budget, false)
            .await
            .unwrap()
    } else {
        result
    };
    (db, org.id, result.warning, db_file)
}

#[tokio::test]
async fn capped_project_keeps_cached_prs_outside_the_fetched_window() {
    let (db, org_id, warning, _file) = sync_with(PROJECT_PR_SYNC_TOP as usize, false, None).await;

    let ids = cached_ids(&db, &org_id);
    assert!(ids.contains(&999_999));
    assert!(ids.contains(&1));
    let warning = warning.expect("a capped project is a sync warning");
    assert!(warning.contains("Platform"), "{warning}");
}

#[tokio::test]
async fn capped_shared_snapshot_keeps_cached_prs_on_the_next_sync() {
    let (db, org_id, warning, _file) = sync_with(PROJECT_PR_SYNC_TOP as usize, true, None).await;
    assert!(cached_ids(&db, &org_id).contains(&999_999));
    assert!(warning.unwrap().contains("or more active PRs"));
}

#[tokio::test]
async fn uncapped_project_still_drops_prs_that_are_no_longer_active() {
    let (db, org_id, warning, _file) = sync_with(3, false, None).await;

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

#[tokio::test]
async fn capped_project_reconciles_authored_prs_outside_the_fetched_window() {
    let (db, org_id, _, _file) = sync_with(PROJECT_PR_SYNC_TOP as usize, false, Some("me")).await;
    let authored = db.list_created_pull_requests(&org_id, "me").unwrap();
    let ids: Vec<_> = authored.iter().map(|row| row.pr.pull_request_id).collect();
    assert_eq!(ids, [700]);
}

#[tokio::test]
async fn capped_project_drops_a_cached_pr_that_was_completed() {
    let (db, org_id, _, _file) = sync_capped(
        PROJECT_PR_SYNC_TOP as usize,
        false,
        None,
        "completed",
        false,
    )
    .await;
    let ids = cached_ids(&db, &org_id);
    assert!(!ids.contains(&999_999));
    assert_eq!(ids.len(), PROJECT_PR_SYNC_TOP as usize);
}

#[tokio::test]
async fn rebuild_replaces_a_capped_project_without_checking_rows() {
    let (db, org_id, _, _file) =
        sync_capped(PROJECT_PR_SYNC_TOP as usize, false, None, "active", true).await;
    assert!(!cached_ids(&db, &org_id).contains(&999_999));
}
