use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

// Removing by index (or appending) twice would hit a different link, so an
// ambiguous 5xx must not be retried: the first attempt may have been applied.
#[tokio::test]
async fn relation_changes_are_not_retried_on_server_errors() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .respond_with(ResponseTemplate::new(503))
        .expect(2)
        .mount(&server)
        .await;
    let client = test_client(&server).await;

    assert!(client
        .remove_work_item_relation("project-1", 10, 0)
        .await
        .is_err());
    assert!(client
        .add_work_item_relation(
            "project-1",
            10,
            "System.LinkTypes.Related",
            "https://dev.azure.com/testorg/_apis/wit/workItems/11"
        )
        .await
        .is_err());
}

#[tokio::test]
async fn field_updates_are_still_retried_on_server_errors() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": { "System.State": "Active" }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .update_work_item_state("project-1", 10, "Active")
        .await
        .unwrap();
    assert_eq!(item.id, 10);
}
