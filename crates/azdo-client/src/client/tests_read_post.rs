use super::*;
use crate::auth::PatProvider;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn retrying_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
        .with_retry_policy(RetryPolicy {
            max_attempts: 2,
            base_delay: Duration::ZERO,
            max_delay: Duration::ZERO,
            retry_after_cap: Duration::ZERO,
        })
}

#[tokio::test]
async fn retries_read_only_post_after_server_error() {
    // WIQL and batch fetches are POSTs that only read, so a transient 5xx is
    // retried like a GET (unlike a mutating POST).
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItems": []
        })))
        .with_priority(2)
        .mount(&server)
        .await;

    let value: serde_json::Value = retrying_client(&server)
        .post_json_read(
            "project-1/_apis/wit/wiql",
            &[("api-version", "7.1-preview")],
            &serde_json::json!({ "query": "SELECT [System.Id] FROM WorkItems" }),
        )
        .await
        .unwrap();

    assert_eq!(value["workItems"], serde_json::json!([]));
}
