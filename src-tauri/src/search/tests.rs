use super::*;
use crate::{db::OrganizationDraft, secrets::SecretStore};
use azdo_client::{AdoClient, PatProvider};
use serde_json::json;
use std::sync::Arc;
use url::Url;
use wiremock::{
    matchers::{body_json, method, path, query_param},
    Mock, MockServer, ResponseTemplate,
};

fn setup() -> (
    tempfile::NamedTempFile,
    AppDatabase,
    crate::db::Organization,
    WorkItemService,
    PullRequestService,
) {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(file.path().into());
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            id: "contoso".into(),
            name: "contoso".into(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".into(),
            auth_provider: "pat".into(),
            credential_key: "test-placeholder".into(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
    (
        file,
        db.clone(),
        org,
        WorkItemService::new(db.clone(), SecretStore),
        PullRequestService::new(db, SecretStore),
    )
}
async fn client(server: &MockServer) -> AdoClient {
    AdoClient::new("contoso", Arc::new(PatProvider::new("test-placeholder")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap())
}
async fn projects(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"p2","name":"Other project"}]})),
        )
        .mount(server)
        .await;
}
fn wi(id: i64) -> serde_json::Value {
    json!({"id":id,"fields":{"System.Title":"Unsynced user's issue","System.TeamProject":"Other project", "System.State":"Active", "System.ChangedDate":"2026-10-31T00:00:00Z"}})
}
fn pr(id: i64, title: &str, status: &str) -> serde_json::Value {
    json!({"pullRequestId":id,"title":title,"status":status,"creationDate":"2026-10-31T00:00:00Z",
        "repository":{"id":"repo","name":"Other repo","project":{"id":"p2","name":"Other project"}},
        "sourceRefName":"refs/heads/change","targetRefName":"refs/heads/main"})
}

#[tokio::test]
async fn title_search_reaches_unsynced_items_across_projects_and_escapes_quotes() {
    let server = MockServer::start().await;
    projects(&server).await;
    Mock::given(method("POST")).and(path("/_apis/wit/wiql"))
        .and(query_param("$top","6"))
        .and(body_json(json!({"query":"SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS 'user''s' ORDER BY [System.ChangedDate] DESC"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"workItems":[{"id":90001}]})))
        .expect(1).mount(&server).await;
    Mock::given(method("POST"))
        .and(path("/_apis/wit/workitemsbatch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[wi(90001)]})))
        .expect(1)
        .mount(&server)
        .await;
    let (_file, db, org, work_items, _) = setup();
    let hits = work_items
        .search_palette_with_client(&client(&server).await, &org, "user's", 5)
        .await
        .unwrap();
    assert_eq!(hits[0].id, 90001);
    assert_eq!(hits[0].project_id, "p2");
    assert_eq!(
        hits[0].web_url.as_deref(),
        Some("https://dev.azure.com/contoso/Other%20project/_workitems/edit/90001")
    );
    assert!(db
        .search_work_items("contoso", None, None, None, None)
        .unwrap()
        .is_empty());
}
#[tokio::test]
async fn numeric_search_looks_up_exact_unsynced_ids_without_scanning_projects_for_prs() {
    let server = MockServer::start().await;
    projects(&server).await;
    Mock::given(method("GET"))
        .and(path("/_apis/wit/workitems/90001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(wi(90001)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/pullrequests/90001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pr(90001, "Unsynced PR", "active")))
        .expect(1)
        .mount(&server)
        .await;
    let (_file, _, org, work_items, prs) = setup();
    let client = client(&server).await;
    let wi = work_items
        .search_palette_with_client(&client, &org, "90001", 5)
        .await
        .unwrap();
    let (pr, warnings) = prs
        .search_palette_with_client(&client, &org, "90001")
        .await
        .unwrap();
    assert_eq!(wi[0].id, 90001);
    assert_eq!(pr[0].pull_request_id, 90001);
    assert!(warnings.is_empty());
}
#[tokio::test]
async fn title_search_pages_all_active_prs_and_reuses_the_snapshot_for_other_queries() {
    let server = MockServer::start().await;
    projects(&server).await;
    for (skip, rows) in [
        ("0", vec![pr(1, "Unrelated", "active")]),
        ("1", vec![pr(90001, "Find this title", "active")]),
        ("2", vec![]),
    ] {
        Mock::given(method("GET"))
            .and(path("/p2/_apis/git/pullrequests"))
            .and(query_param("$skip", skip))
            .and(query_param("searchCriteria.status", "active"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":rows})))
            .expect(1)
            .mount(&server)
            .await;
    }
    let (_file, _, org, _, prs) = setup();
    let client = client(&server).await;
    let (hits, _) = prs
        .search_palette_with_client(&client, &org, "this title")
        .await
        .unwrap();
    assert_eq!(hits[0].pull_request_id, 90001);
    let (hits, _) = prs
        .search_palette_with_client(&client, &org, "Unrelated")
        .await
        .unwrap();
    assert_eq!(hits[0].pull_request_id, 1);
    let (hits, _) = prs
        .search_palette_with_client(&client, &org, "Other repo")
        .await
        .unwrap();
    assert!(hits.is_empty());
}
#[tokio::test]
async fn completed_pr_ids_are_excluded() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/pullrequests/42"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pr(42, "Completed", "completed")))
        .mount(&server)
        .await;
    let (_file, _, org, _, prs) = setup();
    assert!(prs
        .search_palette_with_client(&client(&server).await, &org, "42")
        .await
        .unwrap()
        .0
        .is_empty());
}
#[test]
fn partial_failures_are_visible_and_single_kind_failures_are_errors() {
    let result = finish_search(
        "query",
        5,
        None,
        Ok(Vec::new()),
        Err(crate::error::AppError::AzureDevOps("401".into())),
    )
    .unwrap();
    assert_eq!(result.warnings.len(), 1);
    assert!(finish_search(
        "query",
        5,
        Some(SearchKind::PullRequests),
        Ok(Vec::new()),
        Err(crate::error::AppError::AzureDevOps("401".into()))
    )
    .is_err());
}
#[test]
fn timestamps_are_compared_by_instant_and_missing_dates_sort_last() {
    assert_eq!(
        compare_timestamps_desc(
            Some("2026-10-31T00:00:00.5Z"),
            Some("2026-10-31T00:00:00+00:00")
        ),
        Ordering::Greater
    );
    assert_eq!(
        compare_timestamps_desc(None, Some("2026-10-31T00:00:00Z")),
        Ordering::Less
    );
}
