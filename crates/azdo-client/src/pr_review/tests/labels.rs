use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::test_client;

#[tokio::test]
async fn add_pull_request_label_posts_name() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/labels",
        ))
        .and(body_partial_json(serde_json::json!({ "name": "hotfix" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "lbl-1",
            "name": "hotfix",
            "active": true
        })))
        .mount(&server)
        .await;

    let label = test_client(&server)
        .await
        .add_pull_request_label("project-1", "repo-1", 42, "hotfix")
        .await
        .unwrap();
    assert_eq!(label.id, "lbl-1");
    assert_eq!(label.name, "hotfix");
}

#[tokio::test]
async fn remove_pull_request_label_issues_delete() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/labels/lbl-1",
        ))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .remove_pull_request_label("project-1", "repo-1", 42, "lbl-1")
        .await
        .unwrap();
}

#[tokio::test]
async fn get_pull_request_detail_maps_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests/42",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "pullRequestId": 42,
            "title": "Add dashboard",
            "sourceRefName": "refs/heads/feature",
            "targetRefName": "refs/heads/main",
            "labels": [
                { "id": "lbl-1", "name": "hotfix", "active": true },
                { "id": "lbl-2", "name": "needs-docs", "active": true }
            ]
        })))
        .mount(&server)
        .await;

    let detail = test_client(&server)
        .await
        .get_pull_request_detail("project-1", "repo-1", 42)
        .await
        .unwrap();
    assert_eq!(detail.labels.len(), 2);
    assert_eq!(detail.labels[1].name, "needs-docs");
}
