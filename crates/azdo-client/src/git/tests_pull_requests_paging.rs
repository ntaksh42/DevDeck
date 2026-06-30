use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, method, path, query_param};
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
async fn list_pull_requests_by_reviewer_filters_by_reviewer_id() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("searchCriteria.reviewerId", "user-42"))
        .and(query_param("searchCriteria.status", "active"))
        .and(query_param("$top", "200"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "pullRequestId": 7,
                "title": "Fix bug",
                "status": "active",
                "creationDate": "2026-05-20T00:00:00Z",
                "createdBy": { "id": "author-1", "displayName": "Author" },
                "repository": {
                    "id": "repo-1",
                    "name": "dashboard",
                    "project": { "id": "project-1", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/fix/bug",
                "targetRefName": "refs/heads/main",
                "isDraft": false,
                "reviewers": [
                    { "id": "user-42", "displayName": "Me", "vote": 0, "isRequired": true }
                ]
            }]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests_by_reviewer("project-1", "user-42", 200)
        .await
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pull_request_id, 7);
    let reviewers = prs[0].reviewers.as_ref().unwrap();
    assert_eq!(reviewers[0].vote, 0);
    assert!(reviewers[0].is_required);
}

#[tokio::test]
async fn list_pull_requests_by_reviewer_pages_through_all_results() {
    fn reviewer_pr(id: i64) -> serde_json::Value {
        serde_json::json!({
            "pullRequestId": id,
            "title": format!("PR {id}"),
            "status": "active",
            "creationDate": "2026-05-20T00:00:00Z",
            "createdBy": { "id": "author-1", "displayName": "Author" },
            "repository": {
                "id": "repo-1",
                "name": "dashboard",
                "project": { "id": "project-1", "name": "Platform" }
            },
            "sourceRefName": "refs/heads/fix/bug",
            "targetRefName": "refs/heads/main",
            "isDraft": false,
            "reviewers": [
                { "id": "user-42", "displayName": "Me", "vote": 0, "isRequired": true }
            ]
        })
    }

    let server = MockServer::start().await;

    // Page 1: a full page (page_size = 2) means the client must keep paging.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.reviewerId", "user-42"))
        .and(query_param("$top", "2"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [reviewer_pr(1), reviewer_pr(2)]
        })))
        .expect(1)
        .mount(&server)
        .await;

    // Page 2: a short page (1 < page_size) ends the pagination loop.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.reviewerId", "user-42"))
        .and(query_param("$top", "2"))
        .and(query_param("$skip", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [reviewer_pr(3)]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests_by_reviewer("project-1", "user-42", 2)
        .await
        .unwrap();

    let ids: Vec<i64> = prs.iter().map(|pr| pr.pull_request_id).collect();
    assert_eq!(ids, vec![1, 2, 3]);
}

#[tokio::test]
async fn list_pull_requests_by_creator_filters_by_creator_id() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("searchCriteria.creatorId", "user-42"))
        .and(query_param("searchCriteria.status", "active"))
        .and(query_param("$top", "200"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "pullRequestId": 9,
                "title": "Add feature",
                "status": "active",
                "creationDate": "2026-05-20T00:00:00Z",
                "createdBy": { "id": "user-42", "displayName": "Me" },
                "repository": {
                    "id": "repo-1",
                    "name": "dashboard",
                    "project": { "id": "project-1", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/feature/x",
                "targetRefName": "refs/heads/main",
                "isDraft": false,
                "reviewers": [
                    { "id": "user-7", "displayName": "Reviewer", "vote": 10, "isRequired": true }
                ]
            }]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests_by_creator("project-1", "user-42", 200)
        .await
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pull_request_id, 9);
    assert_eq!(
        prs[0].created_by.as_ref().unwrap().id.as_deref(),
        Some("user-42")
    );
}

#[tokio::test]
async fn list_pull_requests_by_creator_pages_through_all_results() {
    fn creator_pr(id: i64) -> serde_json::Value {
        serde_json::json!({
            "pullRequestId": id,
            "title": format!("PR {id}"),
            "status": "active",
            "creationDate": "2026-05-20T00:00:00Z",
            "createdBy": { "id": "user-42", "displayName": "Me" },
            "repository": {
                "id": "repo-1",
                "name": "dashboard",
                "project": { "id": "project-1", "name": "Platform" }
            },
            "sourceRefName": "refs/heads/feature/x",
            "targetRefName": "refs/heads/main",
            "isDraft": false
        })
    }

    let server = MockServer::start().await;

    // Page 1: a full page (page_size = 2) means the client must keep paging.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.creatorId", "user-42"))
        .and(query_param("$top", "2"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [creator_pr(1), creator_pr(2)]
        })))
        .expect(1)
        .mount(&server)
        .await;

    // Page 2: a short page (1 < page_size) ends the pagination loop.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.creatorId", "user-42"))
        .and(query_param("$top", "2"))
        .and(query_param("$skip", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [creator_pr(3)]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests_by_creator("project-1", "user-42", 2)
        .await
        .unwrap();

    let ids: Vec<i64> = prs.iter().map(|pr| pr.pull_request_id).collect();
    assert_eq!(ids, vec![1, 2, 3]);
}

#[tokio::test]
async fn list_commit_pull_requests_maps_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/_apis/git/repositories/repo-1/pullrequestquery"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "results": [{
                "abc123": [{
                    "pullRequestId": 99,
                    "title": "Land the fix",
                    "status": "completed",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/fix",
                    "targetRefName": "refs/heads/main"
                }]
            }]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_commit_pull_requests("repo-1", "abc123")
        .await
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pull_request_id, 99);
    assert_eq!(prs[0].status, "completed");
}

#[tokio::test]
async fn list_commit_pull_requests_empty_when_commit_absent() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/_apis/git/repositories/repo-1/pullrequestquery"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "results": [{}]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_commit_pull_requests("repo-1", "abc123")
        .await
        .unwrap();
    assert!(prs.is_empty());
}

#[tokio::test]
async fn list_pull_requests_for_commits_batches_multiple_commits() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/_apis/git/repositories/repo-1/pullrequestquery"))
        .and(body_json(serde_json::json!({
            "queries": [{ "items": ["abc123", "def456"], "type": "commit" }]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "results": [{
                "abc123": [{
                    "pullRequestId": 99,
                    "title": "Land the fix",
                    "status": "completed",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/fix",
                    "targetRefName": "refs/heads/main"
                }],
                "def456": []
            }]
        })))
        .mount(&server)
        .await;

    let by_commit = test_client(&server)
        .await
        .list_pull_requests_for_commits("repo-1", &["abc123".to_string(), "def456".to_string()])
        .await
        .unwrap();
    assert_eq!(by_commit.get("abc123").map(Vec::len), Some(1));
    assert_eq!(by_commit.get("def456").map(Vec::len), Some(0));
}

#[tokio::test]
async fn list_pull_requests_for_commits_empty_input_skips_request() {
    let server = MockServer::start().await;
    let by_commit = test_client(&server)
        .await
        .list_pull_requests_for_commits("repo-1", &[])
        .await
        .unwrap();
    assert!(by_commit.is_empty());
}
