use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use url::Url;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use super::*;
use crate::auth::PatProvider;
use crate::client::{AdoClient, AsyncRefOperationPollPolicy};

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
        // Tests never actually need to wait; the interval only matters for
        // real polling against Azure DevOps.
        .with_poll_policy(AsyncRefOperationPollPolicy {
            max_attempts: 5,
            interval: Duration::from_millis(1),
        })
}

/// Returns a fixed sequence of JSON bodies for successive GET requests to the
/// same mock, so a test can simulate an operation moving from `queued` to
/// `completed` across polls without racing real time.
struct Sequenced {
    bodies: Vec<serde_json::Value>,
    calls: AtomicUsize,
}

impl Sequenced {
    fn new(bodies: Vec<serde_json::Value>) -> Self {
        Self {
            bodies,
            calls: AtomicUsize::new(0),
        }
    }
}

impl Respond for Sequenced {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        let index = self.calls.fetch_add(1, Ordering::SeqCst);
        let body = self
            .bodies
            .get(index)
            .or_else(|| self.bodies.last())
            .expect("at least one response body configured");
        ResponseTemplate::new(200).set_body_json(body)
    }
}

#[tokio::test]
async fn create_cherry_pick_sends_documented_request_shape() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks",
        ))
        .and(wiremock::matchers::query_param("api-version", "7.1"))
        .and(wiremock::matchers::body_partial_json(serde_json::json!({
            "repository": { "id": "repo-1" },
            "source": { "commitList": [{ "commitId": "abc123" }] },
            "ontoRefName": "refs/heads/main",
            "generatedRefName": "refs/heads/cherry-pick/abc123"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "cherryPickId": 42,
            "status": "queued"
        })))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .create_cherry_pick(
            "project-1",
            "repo-1",
            "abc123",
            "refs/heads/main",
            "refs/heads/cherry-pick/abc123",
        )
        .await
        .unwrap();

    assert_eq!(result.cherry_pick_id, 42);
    assert_eq!(result.status, GitAsyncOperationStatus::Queued);
    assert!(!result.status.is_terminal());
}

#[tokio::test]
async fn get_cherry_pick_parses_completed_status_and_detail() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks/42",
        ))
        .and(wiremock::matchers::query_param("api-version", "7.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "cherryPickId": 42,
            "status": "completed",
            "detailedStatus": { "conflict": false }
        })))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .get_cherry_pick("project-1", "repo-1", 42)
        .await
        .unwrap();

    assert_eq!(result.status, GitAsyncOperationStatus::Completed);
    assert!(result.status.is_terminal());
    assert!(!result.detailed_status.unwrap().conflict);
}

#[tokio::test]
async fn cherry_pick_commit_and_wait_polls_until_completed() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "cherryPickId": 7,
            "status": "queued"
        })))
        .mount(&server)
        .await;
    Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks/7",
        ))
        .respond_with(Sequenced::new(vec![
            serde_json::json!({ "cherryPickId": 7, "status": "inProgress" }),
            serde_json::json!({ "cherryPickId": 7, "status": "completed" }),
        ]))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .cherry_pick_commit_and_wait(
            "project-1",
            "repo-1",
            "abc123",
            "refs/heads/main",
            "refs/heads/cherry-pick/abc123",
        )
        .await
        .unwrap();

    assert_eq!(result.status, GitAsyncOperationStatus::Completed);
}

#[tokio::test]
async fn cherry_pick_commit_and_wait_returns_last_state_when_still_in_progress() {
    // Regression guard: the operation never reaches a terminal status within
    // the poll budget. The wait must return the last observed state instead
    // of erroring, so the caller can report "still processing" rather than a
    // false failure.
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "cherryPickId": 9,
            "status": "queued"
        })))
        .mount(&server)
        .await;
    Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks/9",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "cherryPickId": 9,
            "status": "inProgress"
        })))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .cherry_pick_commit_and_wait(
            "project-1",
            "repo-1",
            "abc123",
            "refs/heads/main",
            "refs/heads/cherry-pick/abc123",
        )
        .await
        .unwrap();

    assert_eq!(result.status, GitAsyncOperationStatus::InProgress);
    assert!(!result.status.is_terminal());
}

#[tokio::test]
async fn cherry_pick_commit_and_wait_surfaces_conflict_failure() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "cherryPickId": 11,
            "status": "queued"
        })))
        .mount(&server)
        .await;
    Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/cherryPicks/11",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "cherryPickId": 11,
            "status": "failed",
            "detailedStatus": {
                "conflict": true,
                "failureMessage": "A conflict was generated."
            }
        })))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .cherry_pick_commit_and_wait(
            "project-1",
            "repo-1",
            "abc123",
            "refs/heads/main",
            "refs/heads/cherry-pick/abc123",
        )
        .await
        .unwrap();

    assert_eq!(result.status, GitAsyncOperationStatus::Failed);
    let detail = result.detailed_status.unwrap();
    assert!(detail.conflict);
    assert_eq!(
        detail.failure_message.as_deref(),
        Some("A conflict was generated.")
    );
}

#[tokio::test]
async fn revert_commit_and_wait_polls_the_reverts_resource() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/reverts",
        ))
        .and(wiremock::matchers::query_param("api-version", "7.1"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "revertId": 5,
            "status": "queued"
        })))
        .mount(&server)
        .await;
    Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(
            "/project-1/_apis/git/repositories/repo-1/reverts/5",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "revertId": 5,
            "status": "completed"
        })))
        .mount(&server)
        .await;

    let result = test_client(&server)
        .await
        .revert_commit_and_wait(
            "project-1",
            "repo-1",
            "abc123",
            "refs/heads/main",
            "refs/heads/revert/abc123",
        )
        .await
        .unwrap();

    assert_eq!(result.revert_id, 5);
    assert_eq!(result.status, GitAsyncOperationStatus::Completed);
}
