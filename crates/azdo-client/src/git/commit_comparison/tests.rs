use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::{AdoClient, PatProvider};

#[tokio::test]
async fn comparison_pages_exact_snapshots_and_keeps_renames_and_deletes() {
    let server = MockServer::start().await;
    let endpoint = "/project/_apis/git/repositories/repo/diffs/commits";
    for (skip, included, entries) in [
        (
            "0",
            false,
            serde_json::json!([{
                "item": { "path": "/new.rs", "isFolder": false },
                "changeType": "edit, rename", "sourceServerItem": "/old.rs"
            }]),
        ),
        (
            "1",
            true,
            serde_json::json!([{
                "item": { "path": "/removed.rs", "isFolder": false },
                "changeType": "delete"
            }]),
        ),
    ] {
        Mock::given(method("GET"))
            .and(path(endpoint))
            .and(query_param("diffCommonCommit", "false"))
            .and(query_param("baseVersion", "reviewed-head"))
            .and(query_param("targetVersion", "force-pushed-head"))
            .and(query_param("baseVersionType", "commit"))
            .and(query_param("targetVersionType", "commit"))
            .and(query_param("$top", "1000"))
            .and(query_param("$skip", skip))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "allChangesIncluded": included, "changes": entries
            })))
            .expect(1)
            .mount(&server)
            .await;
    }
    let client = AdoClient::new("org", Arc::new(PatProvider::new("test-token")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
    let changes = client
        .compare_commit_snapshots("project", "repo", "reviewed-head", "force-pushed-head")
        .await
        .unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0].source_server_item.as_deref(), Some("/old.rs"));
    assert_eq!(changes[1].change_type.as_deref(), Some("delete"));
}

#[tokio::test]
async fn incomplete_empty_page_is_an_error_not_a_successful_empty_diff() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "allChangesIncluded": false, "changes": []
        })))
        .mount(&server)
        .await;
    let client = AdoClient::new("org", Arc::new(PatProvider::new("test-token")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
    assert!(client
        .compare_commit_snapshots("project", "repo", "old", "new")
        .await
        .unwrap_err()
        .to_string()
        .contains("incomplete empty page"));
}
