//! Commit sync must not look healthy, or advance its delta cursor, when a
//! repository could not be fetched (#649).

use std::sync::Arc;

use azdo_client::{AdoClient, PatProvider};
use chrono::{Duration, Utc};
use serde_json::json;
use tokio::sync::Semaphore;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::db::{AppDatabase, Organization, OrganizationDraft};
use crate::sync::SyncBudget;

use super::sync::{commit_full_sync_scope, sync_commits_for_org};

struct Fixture {
    db: AppDatabase,
    org: Organization,
    client: AdoClient,
    _db_file: tempfile::NamedTempFile,
    _server: MockServer,
}

/// Two repositories in one project; `repo-bad` answers its commits request
/// with `bad_status` (a non-retryable error; 200 means an empty, healthy list)
/// while `repo-ok` succeeds.
async fn fixture(bad_status: u16) -> Fixture {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "proj-1", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/proj-1/_apis/git/repositories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 2,
            "value": [
                { "id": "repo-ok", "name": "Good" },
                { "id": "repo-bad", "name": "Bad" }
            ]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/proj-1/_apis/git/repositories/repo-ok/commits"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "commitId": "ok-commit",
                "comment": "fine",
                "author": { "name": "Dev", "email": "dev@example.com", "date": Utc::now().to_rfc3339() }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/proj-1/_apis/git/repositories/repo-bad/commits"))
        .respond_with(if bad_status == 200 {
            ResponseTemplate::new(200).set_body_json(json!({ "count": 0, "value": [] }))
        } else {
            ResponseTemplate::new(bad_status)
        })
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
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);
    Fixture {
        db,
        org,
        client,
        _db_file: db_file,
        _server: server,
    }
}

async fn run_sync(fx: &Fixture) {
    let projects = fx.client.list_projects().await.unwrap();
    let budget: SyncBudget = Arc::new(Semaphore::new(8));
    sync_commits_for_org(&fx.db, &fx.client, &fx.org, &projects, &budget, false)
        .await
        .unwrap();
}

fn mark_synced(fx: &Fixture, scope: &str, at: &str) {
    fx.db
        .update_sync_state(scope, &fx.org.id, Some(at), 0, None, None)
        .unwrap();
}

#[tokio::test]
async fn delta_sync_with_a_failed_repository_warns_and_keeps_the_cursor() {
    let fx = fixture(403).await;
    let old = (Utc::now() - Duration::hours(2)).to_rfc3339();
    mark_synced(&fx, &commit_full_sync_scope(&fx.org.id), &old);
    mark_synced(&fx, &format!("commits:{}", fx.org.id), &old);

    run_sync(&fx).await;

    let state = fx
        .db
        .get_sync_state(&format!("commits:{}", fx.org.id))
        .unwrap()
        .unwrap();
    assert_eq!(
        state.last_synced_at.as_deref(),
        Some(old.as_str()),
        "the cursor must stay put so the next delta window still covers the gap"
    );
    let warning = state
        .last_warning
        .expect("a skipped repository is a warning");
    assert!(warning.contains("Platform/Bad"), "{warning}");
    // The healthy repository was still merged.
    let commits = fx
        .db
        .search_commits(&fx.org.id, None, None, None, None)
        .unwrap();
    assert!(commits.iter().any(|c| c.commit_id == "ok-commit"));
}

#[tokio::test]
async fn full_sync_with_a_failed_repository_stays_due_for_another_full_sync() {
    let fx = fixture(403).await;

    run_sync(&fx).await;

    let state = fx
        .db
        .get_sync_state(&format!("commits:{}", fx.org.id))
        .unwrap()
        .unwrap();
    assert!(state.last_synced_at.is_some());
    assert!(state.last_warning.unwrap().contains("Platform/Bad"));
    // No full-sync marker, so the next pass is a full one again.
    let marker = fx
        .db
        .get_sync_state(&commit_full_sync_scope(&fx.org.id))
        .unwrap();
    assert!(marker.is_none_or(|m| m.last_synced_at.is_none()));
}

#[tokio::test]
async fn clean_delta_sync_advances_the_cursor_without_a_warning() {
    let fx = fixture(200).await;
    let old = (Utc::now() - Duration::hours(2)).to_rfc3339();
    mark_synced(&fx, &commit_full_sync_scope(&fx.org.id), &old);
    mark_synced(&fx, &format!("commits:{}", fx.org.id), &old);

    run_sync(&fx).await;

    let state = fx
        .db
        .get_sync_state(&format!("commits:{}", fx.org.id))
        .unwrap()
        .unwrap();
    assert_ne!(state.last_synced_at.as_deref(), Some(old.as_str()));
    assert!(state.last_warning.is_none());
}
