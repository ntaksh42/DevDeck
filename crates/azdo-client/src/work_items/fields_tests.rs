use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

#[tokio::test]
async fn list_work_item_fields_without_project_returns_organization_fields() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/wit/fields"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "value": [{
                "name": "Release",
                "referenceName": "Contoso.Release",
                "type": "string"
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());

    let fields = client.list_work_item_fields("").await.unwrap();

    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].reference_name, "Contoso.Release");
    assert_eq!(fields[0].name, "Release");
    assert_eq!(fields[0].field_type, "string");
}
