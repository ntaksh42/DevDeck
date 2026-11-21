use crate::{AdoClient, PatProvider, PullRequestPageCriteria, PullRequestStatus};
use std::sync::Arc;
use url::Url;
use wiremock::{
    matchers::{method, path, query_param},
    Mock, MockServer, ResponseTemplate,
};

fn criteria() -> PullRequestPageCriteria<'static> {
    PullRequestPageCriteria {
        project: Some("project"),
        repository: None,
        status: PullRequestStatus::Completed,
        author: Some("author"),
        reviewer: Some("reviewer"),
        target: Some("refs/heads/main"),
        min_time: Some("2026-01-01T00:00:00Z"),
        max_time: Some("2026-02-01T23:59:59Z"),
        date_basis: "closed",
        skip: 600,
        top: 200,
    }
}
async fn client(server: &MockServer) -> AdoClient {
    AdoClient::new("org", Arc::new(PatProvider::new("test")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap())
}
#[tokio::test]
async fn search_page_sends_person_window_and_cursor_filters() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project/_apis/git/pullrequests"))
        .and(query_param("api-version", "7.1"))
        .and(query_param("$skip", "600"))
        .and(query_param("$top", "200"))
        .and(query_param("searchCriteria.creatorId", "author"))
        .and(query_param("searchCriteria.reviewerId", "reviewer"))
        .and(query_param("searchCriteria.status", "completed"))
        .and(query_param(
            "searchCriteria.targetRefName",
            "refs/heads/main",
        ))
        .and(query_param("searchCriteria.queryTimeRangeType", "closed"))
        .and(query_param(
            "searchCriteria.minTime",
            "2026-01-01T00:00:00Z",
        ))
        .and(query_param(
            "searchCriteria.maxTime",
            "2026-02-01T23:59:59Z",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"value":[]})))
        .expect(1)
        .mount(&server)
        .await;
    assert!(client(&server)
        .await
        .search_pull_request_page(&criteria())
        .await
        .unwrap()
        .is_empty());
}
#[tokio::test]
async fn repository_page_does_not_require_a_project_and_returns_short_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/_apis/git/repositories/repo/pullrequests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"value":[{
            "pullRequestId":7,"title":"Match","status":"completed","creationDate":"2026-01-01T00:00:00Z",
            "sourceRefName":"refs/heads/fix","targetRefName":"refs/heads/main"
        }]}))).expect(1).mount(&server).await;
    let mut criteria = criteria();
    criteria.project = None;
    criteria.repository = Some("repo");
    let rows = client(&server)
        .await
        .search_pull_request_page(&criteria)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].pull_request_id, 7);
}
