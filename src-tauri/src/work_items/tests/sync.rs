use serde_json::json;
use wiremock::matchers::{body_string_contains, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::super::*;
use super::test_client;
use crate::db::OrganizationDraft;

fn make_org_draft() -> OrganizationDraft {
    OrganizationDraft {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: Some("contoso".to_string()),
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
    }
}

#[tokio::test]
async fn sync_work_items_skips_not_found_project_and_keeps_other_results() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 2,
            "value": [
                { "id": "project-ok", "name": "Platform" },
                { "id": "project-missing", "name": "Archived" }
            ]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": [{ "id": 10 }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 10,
                "fields": {
                    "System.Title": "Keep synced item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-24T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-missing/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();
    let client = test_client(&server).await;

    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    do_sync_work_items(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].title, "Keep synced item");
    let my_cached = db.list_my_work_items(&org.id).unwrap();
    assert_eq!(my_cached.len(), 1);
    assert_eq!(my_cached[0].title, "Keep synced item");
}

#[test]
fn wiql_with_changed_date_filter_inserts_condition_before_order_by() {
    let filtered = wiql_with_changed_date_filter(SYNC_WI_WIQL, "2026-06-10");
    assert_eq!(
        filtered,
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
         AND [System.ChangedDate] >= '2026-06-10' ORDER BY [System.ChangedDate] DESC"
    );
}

#[tokio::test]
async fn sync_work_items_delta_preserves_items_missing_from_window() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-ok", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    // The "all items" query must carry the ChangedDate delta filter; the
    // "my items" query stays unfiltered. Without the filter no mock
    // matches and the sync fails.
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(body_string_contains("[System.ChangedDate] >="))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": [{ "id": 10 }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(body_string_contains("@Me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": []
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 10,
                "fields": {
                    "System.Title": "Fresh change",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-06-11T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();

    // Cached item outside the delta window: a full sync would delete it.
    db.upsert_work_items(&[CachedWorkItem {
        org_id: org.id.clone(),
        project_id: "project-ok".to_string(),
        project_name: "Platform".to_string(),
        id: 99,
        title: "Old but alive".to_string(),
        work_item_type: Some("Task".to_string()),
        state: Some("Active".to_string()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: Some("2026-01-01T00:00:00Z".to_string()),
        web_url: None,
    }])
    .unwrap();

    let now = Utc::now().to_rfc3339();
    db.update_sync_state(
        &format!("work_items:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();
    db.update_sync_state(
        &full_sync_scope(&org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();

    let client = test_client(&server).await;
    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let result = do_sync_work_items(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();
    assert!(!result.was_full_sync);

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    let mut ids: Vec<i64> = cached.iter().map(|item| item.id).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![10, 99]);
}

#[tokio::test]
async fn sync_work_items_runs_full_sync_when_interval_elapsed() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();

    let now = Utc::now().to_rfc3339();
    let stale_full = (Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
    db.update_sync_state(
        &format!("work_items:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();
    db.update_sync_state(
        &full_sync_scope(&org.id),
        &org.id,
        Some(&stale_full),
        0,
        None,
        None,
    )
    .unwrap();

    assert!(delta_sync_since(&db, &org).is_none());
}

#[tokio::test]
async fn sync_work_items_batches_more_than_two_hundred_ids() {
    let server = MockServer::start().await;
    let refs: Vec<_> = (1..=201).map(|id| json!({ "id": id })).collect();

    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-ok", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": refs
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_string_contains("\"ids\":[1,2,3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 1,
                "fields": {
                    "System.Title": "First batch item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-24T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_string_contains("\"ids\":[201]"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 201,
                "fields": {
                    "System.Title": "Second batch item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-23T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();
    let client = test_client(&server).await;

    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    sync_work_items_for_org(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    assert_eq!(cached.len(), 2);
    assert!(cached.iter().any(|item| item.id == 1));
    assert!(cached.iter().any(|item| item.id == 201));
    let state = db
        .get_sync_state(&format!("work_items:{}", org.id))
        .unwrap()
        .unwrap();
    assert_eq!(state.error_count, 0);
    assert!(state
        .last_warning
        .as_deref()
        .is_some_and(|warning| warning.contains("more than 200 IDs")));
}
