use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::test_client;

#[tokio::test]
async fn get_item_content_at_version_sends_requested_version_type() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("path", "/README.md"))
        .and(query_param("versionDescriptor.versionType", "tag"))
        .and(query_param("versionDescriptor.version", "v1.0.0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": "# Hello\n",
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .get_item_content_at_version("project-1", "repo-1", "/README.md", "v1.0.0", "tag")
        .await
        .unwrap();
    assert_eq!(item.content.as_deref(), Some("# Hello\n"));
}
