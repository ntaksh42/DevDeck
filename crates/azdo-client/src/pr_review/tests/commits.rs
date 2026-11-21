use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::test_client;

#[tokio::test]
async fn list_pull_request_commits_follows_continuation_tokens() {
    let server = MockServer::start().await;
    let commits_path = "/project-1/_apis/git/repositories/repo-1/pullRequests/42/commits";
    Mock::given(method("GET"))
        .and(path(commits_path))
        .and(query_param_is_missing("continuationToken"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-ms-continuationtoken", "page-2")
                .set_body_json(serde_json::json!({
                    "count": 1,
                    "value": [{ "commitId": "c2", "comment": "Second" }]
                })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(commits_path))
        .and(query_param("continuationToken", "page-2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "commitId": "c1", "comment": "First" }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let commits = test_client(&server)
        .await
        .list_pull_request_commits("project-1", "repo-1", 42)
        .await
        .unwrap();
    let ids: Vec<_> = commits.iter().map(|c| c.commit_id.as_str()).collect();
    assert_eq!(ids, ["c2", "c1"]);
}
