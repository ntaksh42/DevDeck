use super::*;
use crate::auth::PatProvider;
use serde_json::json;
use std::sync::Arc;
use url::Url;
use wiremock::{
    matchers::{method, path, query_param},
    Mock, MockServer, ResponseTemplate,
};

async fn client(server: &MockServer) -> AdoClient {
    AdoClient::new("test", Arc::new(PatProvider::new("test-placeholder")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap())
}
fn pr(id: i64) -> serde_json::Value {
    json!({"pullRequestId":id,"title":"Unsynced change","status":"active","creationDate":"2026-10-31T00:00:00Z",
        "sourceRefName":"refs/heads/change","targetRefName":"refs/heads/main"})
}
#[tokio::test]
async fn exact_id_uses_organization_endpoint_and_404_is_no_match() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/pullrequests/42"))
        .and(query_param("api-version", "7.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pr(42)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/pullrequests/99"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    let client = client(&server).await;
    assert_eq!(
        client
            .get_pull_request_by_id(42)
            .await
            .unwrap()
            .unwrap()
            .pull_request_id,
        42
    );
    assert!(client.get_pull_request_by_id(99).await.unwrap().is_none());
}
#[tokio::test]
async fn pages_past_short_pages_and_deduplicates_shifting_results() {
    let server = MockServer::start().await;
    for (skip, rows) in [("0", vec![pr(1)]), ("1", vec![pr(1), pr(2)]), ("3", vec![])] {
        Mock::given(method("GET"))
            .and(path("/p/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.status", "active"))
            .and(query_param("$top", "200"))
            .and(query_param("$skip", skip))
            .and(query_param("api-version", "7.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":rows})))
            .expect(1)
            .mount(&server)
            .await;
    }
    let rows = client(&server)
        .await
        .list_palette_active_pull_requests("p")
        .await
        .unwrap();
    assert_eq!(
        rows.iter().map(|p| p.pull_request_id).collect::<Vec<_>>(),
        vec![1, 2]
    );
}
#[tokio::test]
async fn authentication_errors_are_not_treated_as_no_matches() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/pullrequests/42"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).await.get_pull_request_by_id(42).await,
        Err(AdoError::Unauthorized)
    ));
}
