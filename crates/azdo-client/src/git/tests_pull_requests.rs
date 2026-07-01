use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_partial_json, method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn list_projects_maps_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "id": "project-1", "name": "Platform" }]
        })))
        .mount(&server)
        .await;

    let projects = test_client(&server).await.list_projects().await.unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "Platform");
}

#[tokio::test]
async fn list_pull_requests_uses_status_query() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests",
        ))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "pullRequestId": 42,
                "title": "Add dashboard",
                "status": "active",
                "creationDate": "2026-05-24T00:00:00Z",
                "createdBy": { "displayName": "Test User", "uniqueName": "test@example.com" },
                "repository": {
                    "id": "repo-1",
                    "name": "azdo-dashboard",
                    "project": { "id": "project-1", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/feature/dashboard",
                "targetRefName": "refs/heads/main",
                "_links": {
                    "web": { "href": "https://dev.azure.com/testorg/project/_git/repo/pullrequest/42" }
                }
            }]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests("project-1", "repo-1", PullRequestStatus::Active)
        .await
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pull_request_id, 42);
    assert_eq!(
        prs[0].links.as_ref().unwrap().web.as_ref().unwrap().href,
        "https://dev.azure.com/testorg/project/_git/repo/pullrequest/42"
    );
}

#[tokio::test]
async fn list_project_pull_requests_spans_repositories() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("searchCriteria.status", "active"))
        .and(query_param("$top", "500"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [
                {
                    "pullRequestId": 42,
                    "title": "Add dashboard",
                    "status": "active",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/feature/dashboard",
                    "targetRefName": "refs/heads/main"
                },
                {
                    "pullRequestId": 43,
                    "title": "Fix tooling",
                    "status": "active",
                    "creationDate": "2026-05-25T00:00:00Z",
                    "repository": {
                        "id": "repo-2",
                        "name": "tools",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/fix/tooling",
                    "targetRefName": "refs/heads/main"
                }
            ]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_project_pull_requests("project-1", PullRequestStatus::Active, 500)
        .await
        .unwrap();
    assert_eq!(prs.len(), 2);
    assert_eq!(prs[0].repository.as_ref().unwrap().id, "repo-1");
    assert_eq!(prs[1].repository.as_ref().unwrap().id, "repo-2");
}

#[tokio::test]
async fn search_project_pull_requests_passes_target_branch_and_close_window() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("searchCriteria.status", "completed"))
        .and(query_param(
            "searchCriteria.targetRefName",
            "refs/heads/main",
        ))
        .and(query_param("searchCriteria.queryTimeRangeType", "closed"))
        .and(query_param(
            "searchCriteria.minTime",
            "2026-05-01T00:00:00Z",
        ))
        .and(query_param(
            "searchCriteria.maxTime",
            "2026-05-31T23:59:59Z",
        ))
        .and(query_param("$top", "500"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [
                {
                    "pullRequestId": 7,
                    "title": "Ship release",
                    "status": "completed",
                    "creationDate": "2026-05-10T00:00:00Z",
                    "closedDate": "2026-05-20T00:00:00Z",
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/release",
                    "targetRefName": "refs/heads/main"
                }
            ]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .search_project_pull_requests(
            "project-1",
            PullRequestStatus::Completed,
            Some("refs/heads/main"),
            Some("2026-05-01T00:00:00Z"),
            Some("2026-05-31T23:59:59Z"),
            Some("closed"),
            500,
        )
        .await
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].pull_request_id, 7);
    assert!(prs[0].closed_date.is_some());
}

#[tokio::test]
async fn search_project_pull_requests_omits_time_range_without_bounds() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "all"))
        .and(query_param_is_missing("searchCriteria.queryTimeRangeType"))
        .and(query_param_is_missing("searchCriteria.targetRefName"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 0,
            "value": []
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .search_project_pull_requests(
            "project-1",
            PullRequestStatus::All,
            None,
            None,
            None,
            None,
            500,
        )
        .await
        .unwrap();
    assert!(prs.is_empty());
}

#[tokio::test]
async fn list_pull_requests_closed_in_range_pages_and_filters_by_close_time() {
    let server = MockServer::start().await;
    // First page (skip=0) is full, so a second page must be requested.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "completed"))
        .and(query_param("searchCriteria.queryTimeRangeType", "closed"))
        .and(query_param("searchCriteria.minTime", "2026-06-01T00:00:00+00:00"))
        .and(query_param("$skip", "0"))
        .and(query_param("$top", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [
                { "pullRequestId": 50, "title": "A", "status": "completed",
                  "creationDate": "2026-06-02T00:00:00Z", "closedDate": "2026-06-05T00:00:00Z",
                  "sourceRefName": "refs/heads/a", "targetRefName": "refs/heads/main",
                  "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } },
                { "pullRequestId": 51, "title": "B", "status": "completed",
                  "creationDate": "2026-06-03T00:00:00Z", "closedDate": "2026-06-06T00:00:00Z",
                  "sourceRefName": "refs/heads/b", "targetRefName": "refs/heads/main",
                  "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } }
            ]
        })))
        .mount(&server)
        .await;
    // Second page (skip=2) is short, so paging stops here.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("$skip", "2"))
        .and(query_param("$top", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [
                { "pullRequestId": 52, "title": "C", "status": "completed",
                  "creationDate": "2026-06-04T00:00:00Z", "closedDate": "2026-06-07T00:00:00Z",
                  "sourceRefName": "refs/heads/c", "targetRefName": "refs/heads/main",
                  "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } }
            ]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests_closed_in_range(
            "project-1",
            PullRequestStatus::Completed,
            Some("2026-06-01T00:00:00+00:00"),
            None,
            2,
        )
        .await
        .unwrap();
    // All three completed PRs across both pages are returned (no truncation).
    assert_eq!(prs.len(), 3);
    assert_eq!(prs[0].pull_request_id, 50);
    assert_eq!(prs[2].pull_request_id, 52);
}

#[tokio::test]
async fn list_pull_requests_maps_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "pullRequestId": 42,
                "title": "Add dashboard",
                "status": "active",
                "creationDate": "2026-05-24T00:00:00Z",
                "sourceRefName": "refs/heads/feature/dashboard",
                "targetRefName": "refs/heads/main",
                "labels": [{ "id": "lbl-1", "name": "hotfix", "active": true }]
            }]
        })))
        .mount(&server)
        .await;

    let prs = test_client(&server)
        .await
        .list_pull_requests("project-1", "repo-1", PullRequestStatus::Active)
        .await
        .unwrap();
    assert_eq!(prs[0].labels.len(), 1);
    assert_eq!(prs[0].labels[0].name, "hotfix");
}

#[tokio::test]
async fn create_pull_request_posts_refs_and_title() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests",
        ))
        .and(body_partial_json(serde_json::json!({
            "sourceRefName": "refs/heads/feature/x",
            "targetRefName": "refs/heads/main",
            "title": "New PR"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "pullRequestId": 77,
            "title": "New PR",
            "status": "active",
            "creationDate": "2026-05-24T00:00:00Z",
            "repository": {
                "id": "repo-1",
                "name": "azdo-dashboard",
                "project": { "id": "project-1", "name": "Platform" }
            },
            "sourceRefName": "refs/heads/feature/x",
            "targetRefName": "refs/heads/main"
        })))
        .mount(&server)
        .await;

    let pr = test_client(&server)
        .await
        .create_pull_request(
            "project-1",
            "repo-1",
            "refs/heads/feature/x",
            "refs/heads/main",
            "New PR",
            "Body",
        )
        .await
        .unwrap();
    assert_eq!(pr.pull_request_id, 77);
    assert_eq!(
        pr.repository.and_then(|r| r.project).map(|p| p.name),
        Some("Platform".to_string())
    );
}
