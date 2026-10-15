use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::client::RetryPolicy;
use crate::{FileContent, GitHubClient, GitHubError};

fn client(server: &MockServer) -> GitHubClient {
    GitHubClient::with_base_url("test-token", &format!("{}/", server.uri()))
        .unwrap()
        .with_retry_policy(RetryPolicy::no_retries())
}

fn files(range: std::ops::Range<u32>) -> serde_json::Value {
    json!(range
        .map(|i| json!({ "filename": format!("f{i}.rs"), "status": "modified" }))
        .collect::<Vec<_>>())
}

#[tokio::test]
async fn lists_every_page_of_pull_request_files() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/1/files"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(files(0..100)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/1/files"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(files(100..150)))
        .mount(&server)
        .await;

    let all = client(&server)
        .list_pull_request_files("o", "r", 1)
        .await
        .unwrap();
    assert_eq!(all.len(), 150);
    assert_eq!(all[149].filename, "f149.rs");
}

#[tokio::test]
async fn a_file_over_the_contents_limit_is_too_large_not_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/contents/big.bin"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "encoding": "none", "content": "" })),
        )
        .mount(&server)
        .await;

    let content = client(&server)
        .get_file_content("o", "r", "big.bin", "main")
        .await
        .unwrap();
    assert_eq!(content, FileContent::TooLarge);
}

#[tokio::test]
async fn a_secondary_rate_limit_403_is_a_rate_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/1"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("Retry-After", "30")
                .insert_header("X-RateLimit-Remaining", "4000")
                .set_body_json(json!({ "message": "You have exceeded a secondary rate limit" })),
        )
        .mount(&server)
        .await;

    let error = client(&server)
        .get_pull_request("o", "r", 1)
        .await
        .unwrap_err();
    assert!(matches!(error, GitHubError::RateLimited(d) if d.as_secs() == 30));
}
