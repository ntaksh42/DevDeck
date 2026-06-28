use azdo_client::AdoClient;
use chrono::Utc;

use crate::db::{AppDatabase, CachedCommit, Organization};
use crate::sync::SyncBudget;

use super::helpers::{
    commit_web_url, normalize_date, normalize_item_path, normalize_optional, ChangeFlags,
};
use super::sync::{commit_full_sync_scope, sync_commits_for_org};

#[test]
fn change_flags_parse_detects_add_and_delete() {
    let add = ChangeFlags::parse("add");
    assert!(add.is_add && !add.is_delete);
    let delete = ChangeFlags::parse("delete");
    assert!(delete.is_delete && !delete.is_add);
    let edit = ChangeFlags::parse("edit");
    assert!(!edit.is_add && !edit.is_delete);
    let rename_edit = ChangeFlags::parse("edit, rename");
    assert!(!rename_edit.is_add && !rename_edit.is_delete);
}

#[test]
fn normalize_optional_trims_empty_values() {
    assert_eq!(
        normalize_optional(Some(" main ".to_string())),
        Some("main".to_string())
    );
    assert_eq!(normalize_optional(Some(" ".to_string())), None);
}

#[test]
fn normalize_item_path_adds_leading_slash_and_trims() {
    assert_eq!(normalize_item_path("src/auth"), "/src/auth");
    assert_eq!(normalize_item_path("/src/auth/"), "/src/auth");
    assert_eq!(normalize_item_path("  src/auth  "), "/src/auth");
}

#[test]
fn normalize_date_expands_date_only_values() {
    assert_eq!(
        normalize_date(Some("2026-05-24"), false)
            .unwrap()
            .unwrap()
            .to_rfc3339(),
        "2026-05-24T00:00:00+00:00"
    );
    assert_eq!(
        normalize_date(Some("2026-05-24"), true)
            .unwrap()
            .unwrap()
            .to_rfc3339(),
        "2026-05-24T23:59:59+00:00"
    );
    assert!(normalize_date(Some("24/05/2026"), false).is_err());
}

#[test]
fn commit_web_url_encodes_spaces_and_trims_trailing_slash() {
    let org = Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: None,
        base_url: "https://dev.azure.com/contoso/".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
    };
    assert_eq!(
        commit_web_url(&org, "Platform Team", "azdo dashboard", "abcdef123456"),
        "https://dev.azure.com/contoso/Platform%20Team/_git/azdo%20dashboard/commit/abcdef123456"
    );
}

#[tokio::test]
async fn delta_commit_sync_merges_without_dropping_existing_commits() {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use tokio::sync::Semaphore;
    use url::Url;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::db::OrganizationDraft;

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
            "count": 1,
            "value": [{ "id": "repo-1", "name": "Repo" }]
        })))
        .mount(&server)
        .await;
    // The delta pass fetches only newer commits; the mock returns just the
    // new one (the previously cached commit is not in this response).
    Mock::given(method("GET"))
        .and(path("/proj-1/_apis/git/repositories/repo-1/commits"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "commitId": "new-commit",
                "comment": "New commit",
                "author": { "name": "Dev", "email": "dev@example.com", "date": "2026-06-20T00:00:00Z" }
            }]
        })))
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

    // Pre-existing cached commit that must survive a delta (merge) sync.
    db.replace_commits_for_repo(
        &org.id,
        "repo-1",
        &[CachedCommit {
            org_id: org.id.clone(),
            project_id: "proj-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "Repo".to_string(),
            commit_id: "old-commit".to_string(),
            comment: "Old commit".to_string(),
            author_name: Some("Dev".to_string()),
            author_email: Some("dev@example.com".to_string()),
            author_date: Some("2026-06-19T00:00:00Z".to_string()),
            web_url: None,
        }],
    )
    .unwrap();

    // Mark a recent full sync and a recent incremental sync so this pass
    // takes the delta path instead of a full window replace.
    let now = Utc::now().to_rfc3339();
    db.update_sync_state(
        &commit_full_sync_scope(&org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();
    db.update_sync_state(
        &format!("commits:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();

    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);
    let projects = client.list_projects().await.unwrap();
    let budget: SyncBudget = Arc::new(Semaphore::new(8));

    sync_commits_for_org(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let commits = db.search_commits(&org.id, None, None, None, None).unwrap();
    let ids: Vec<&str> = commits.iter().map(|c| c.commit_id.as_str()).collect();
    // Delta merged the new commit while preserving the previously cached one;
    // a full replace would have dropped "old-commit".
    assert!(
        ids.contains(&"old-commit"),
        "delta sync must not drop existing commits"
    );
    assert!(ids.contains(&"new-commit"));
}
