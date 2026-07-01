use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
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
async fn list_branch_stats_maps_ahead_behind_and_commit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/stats/branches",
        ))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [
                {
                    "name": "main",
                    "aheadCount": 0,
                    "behindCount": 0,
                    "isBaseVersion": true,
                    "commit": {
                        "commitId": "abc123",
                        "comment": "Initial commit",
                        "committer": { "name": "Test User", "email": "test@example.com", "date": "2026-05-24T00:00:00Z" }
                    }
                },
                {
                    "name": "feature/dashboard",
                    "aheadCount": 3,
                    "behindCount": 1,
                    "isBaseVersion": false,
                    "commit": {
                        "commitId": "def456",
                        "comment": "Add dashboard",
                        "committer": { "name": "Dev", "email": "dev@example.com", "date": "2026-05-25T00:00:00Z" }
                    }
                }
            ]
        })))
        .mount(&server)
        .await;

    let branches = test_client(&server)
        .await
        .list_branch_stats("project-1", "repo-1")
        .await
        .unwrap();
    assert_eq!(branches.len(), 2);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].is_base_version);
    assert_eq!(branches[1].name, "feature/dashboard");
    assert_eq!(branches[1].ahead_count, 3);
    assert_eq!(branches[1].behind_count, 1);
    assert_eq!(
        branches[1].commit.as_ref().unwrap().commit_id,
        "def456".to_string()
    );
}
