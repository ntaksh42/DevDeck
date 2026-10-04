use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

#[tokio::test]
async fn list_branch_stats_parses_counts_tip_and_base() {
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
                    "name": "main", "aheadCount": 0, "behindCount": 0, "isBaseVersion": true,
                    "commit": { "commitId": "c0", "comment": "Tip of main",
                        "committer": { "name": "Ann", "date": "2026-06-01T10:00:00Z" } }
                },
                {
                    "name": "feature/x", "aheadCount": 3, "behindCount": 5,
                    "commit": { "commitId": "c1", "comment": "WIP",
                        "author": { "name": "Bob", "date": "2026-06-02T10:00:00Z" } }
                }
            ]
        })))
        .mount(&server)
        .await;
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);

    let stats = client
        .list_branch_stats("project-1", "repo-1")
        .await
        .unwrap();

    assert_eq!(stats.len(), 2);
    assert!(stats[0].is_base_version);
    assert_eq!(
        stats[0].tip_date().unwrap().to_rfc3339(),
        "2026-06-01T10:00:00+00:00"
    );
    assert_eq!((stats[1].ahead_count, stats[1].behind_count), (3, 5));
    assert!(!stats[1].is_base_version);
    // No committer: the author date is the fallback.
    assert_eq!(
        stats[1].tip_date().unwrap().to_rfc3339(),
        "2026-06-02T10:00:00+00:00"
    );
}
