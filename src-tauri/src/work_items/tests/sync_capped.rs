//! A full sync whose WIQL result hit the query cap is a truncated snapshot; it
//! must not delete the project's other, still-valid cached rows (#476).

use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use super::super::sync::SYNC_WORK_ITEM_QUERY_TOP;
use super::super::*;
use super::test_client;
use crate::db::OrganizationDraft;

/// Answers every `workitemsbatch` request with one minimal item per requested id.
struct EchoBatch;

impl Respond for EchoBatch {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
        let items: Vec<_> = body["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| {
                json!({
                    "id": id,
                    "fields": {
                        "System.Title": format!("Item {id}"),
                        "System.WorkItemType": "Task",
                        "System.State": "Active",
                        "System.ChangedDate": "2026-05-24T00:00:00Z"
                    }
                })
            })
            .collect();
        ResponseTemplate::new(200).set_body_json(json!({ "count": items.len(), "value": items }))
    }
}

fn org_draft() -> OrganizationDraft {
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
        provider_kind: "azdo".to_string(),
    }
}

fn cached(org_id: &str, id: i64, title: &str) -> CachedWorkItem {
    CachedWorkItem {
        org_id: org_id.to_string(),
        project_id: "project-big".to_string(),
        project_name: "Big".to_string(),
        id,
        title: title.to_string(),
        work_item_type: Some("Task".to_string()),
        state: Some("Active".to_string()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: Some("2020-01-01T00:00:00Z".to_string()),
        web_url: None,
        tags: None,
    }
}

#[tokio::test]
async fn capped_full_sync_keeps_cached_rows_outside_the_fetched_window() {
    let server = MockServer::start().await;
    let refs: Vec<_> = (1..=SYNC_WORK_ITEM_QUERY_TOP as i64)
        .map(|id| json!({ "id": id }))
        .collect();
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-big", "name": "Big" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-big/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "workItems": refs })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-big/_apis/wit/workitemsbatch"))
        .respond_with(EchoBatch)
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(org_draft()).unwrap();
    // Older than the 2000-item window, so the capped query cannot return it.
    let old = cached(&org.id, 999_999, "Old but still valid");
    db.replace_work_items(&org.id, &["project-big"], std::slice::from_ref(&old), &[])
        .unwrap();

    let client = test_client(&server).await;
    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    sync_work_items_for_org(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    // The list queries cap their result size, so look the old row up directly.
    let old_rows = db
        .search_work_items_fts(&org.id, "Old but still valid")
        .unwrap();
    assert!(
        old_rows.iter().any(|item| item.id == 999_999),
        "the row outside the capped window must survive a full sync"
    );
    let fresh_rows = db.search_work_items_fts(&org.id, "Item 1").unwrap();
    assert!(fresh_rows.iter().any(|item| item.id == 1));
    let warning = db
        .get_sync_state(&format!("work_items:{}", org.id))
        .unwrap()
        .unwrap()
        .last_warning
        .unwrap();
    assert!(warning.contains("2000-item query limit"), "{warning}");
}
