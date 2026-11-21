use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn list_build_definitions_follows_continuation_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/definitions"))
        .and(query_param("$top", "2"))
        .and(query_param_is_missing("continuationToken"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-ms-continuationtoken", "next")
                .set_body_json(serde_json::json!({
                    "count": 2,
                    "value": [{ "id": 1, "name": "A" }, { "id": 2, "name": "B" }]
                })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/definitions"))
        .and(query_param("continuationToken", "next"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "id": 3, "name": "C" }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let defs = test_client(&server)
        .await
        .list_build_definitions("project-1", None, 2)
        .await
        .unwrap();
    let ids: Vec<_> = defs.iter().map(|d| d.id).collect();
    assert_eq!(ids, [1, 2, 3]);
}
