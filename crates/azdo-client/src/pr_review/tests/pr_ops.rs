use wiremock::matchers::{body_json, body_partial_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::test_client;

#[tokio::test]
async fn update_pull_request_patches_completion() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests/42",
        ))
        .and(body_partial_json(
            serde_json::json!({ "status": "completed" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "pullRequestId": 42,
            "title": "Add dashboard",
            "sourceRefName": "refs/heads/feature",
            "targetRefName": "refs/heads/main",
            "status": "completed",
            "isDraft": false
        })))
        .mount(&server)
        .await;

    let detail = test_client(&server)
        .await
        .update_pull_request(
            "project-1",
            "repo-1",
            42,
            &serde_json::json!({
                "status": "completed",
                "lastMergeSourceCommit": { "commitId": "abc" },
                "completionOptions": { "mergeStrategy": "squash" }
            }),
        )
        .await
        .unwrap();
    assert_eq!(detail.status.as_deref(), Some("completed"));
    assert_eq!(detail.is_draft, Some(false));
}

#[tokio::test]
async fn update_pull_request_patches_title_and_description() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullrequests/42",
        ))
        .and(body_partial_json(serde_json::json!({
            "title": "New title",
            "description": "New description"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "pullRequestId": 42,
            "title": "New title",
            "description": "New description",
            "sourceRefName": "refs/heads/feature",
            "targetRefName": "refs/heads/main"
        })))
        .mount(&server)
        .await;

    let detail = test_client(&server)
        .await
        .update_pull_request(
            "project-1",
            "repo-1",
            42,
            &serde_json::json!({ "title": "New title", "description": "New description" }),
        )
        .await
        .unwrap();
    assert_eq!(detail.title, "New title");
    assert_eq!(detail.description.as_deref(), Some("New description"));
}

#[tokio::test]
async fn submit_pull_request_vote_preserves_required_reviewer() {
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
            "reviewers": [{
                "id": "user-42",
                "vote": 0,
                "isRequired": true
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/reviewers/user-42",
        ))
        .and(body_json(serde_json::json!({
            "vote": 10,
            "id": "user-42",
            "isRequired": true
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "user-42",
            "displayName": "Me",
            "vote": 10,
            "isRequired": true
        })))
        .mount(&server)
        .await;

    let reviewer = test_client(&server)
        .await
        .submit_pull_request_vote("project-1", "repo-1", 42, "user-42", 10)
        .await
        .unwrap();
    assert_eq!(reviewer.vote, 10);
    assert!(reviewer.is_required);
}

#[tokio::test]
async fn set_pull_request_reviewer_required_puts_is_required() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/reviewers/user-42",
        ))
        .and(body_partial_json(serde_json::json!({ "isRequired": true })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "user-42",
            "displayName": "Me",
            "vote": 0,
            "isRequired": true
        })))
        .mount(&server)
        .await;

    let reviewer = test_client(&server)
        .await
        .set_pull_request_reviewer_required("project-1", "repo-1", 42, "user-42", true)
        .await
        .unwrap();
    assert!(reviewer.is_required);
}

#[tokio::test]
async fn remove_pull_request_reviewer_issues_delete() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/reviewers/user-42",
        ))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .remove_pull_request_reviewer("project-1", "repo-1", 42, "user-42")
        .await
        .unwrap();
}

#[tokio::test]
async fn list_pull_request_iterations_maps_commits() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/iterations",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": 3,
                "sourceRefCommit": { "commitId": "abc" },
                "commonRefCommit": { "commitId": "base" }
            }]
        })))
        .mount(&server)
        .await;

    let iterations = test_client(&server)
        .await
        .list_pull_request_iterations("project-1", "repo-1", 42)
        .await
        .unwrap();
    assert_eq!(iterations[0].id, 3);
    assert_eq!(
        iterations[0].common_ref_commit.as_ref().unwrap().commit_id,
        "base"
    );
}

#[tokio::test]
async fn get_pull_request_iteration_changes_compares_to_base() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/iterations/3/changes",
        ))
        .and(query_param("$compareTo", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "changeEntries": [{
                "changeType": "edit",
                "item": { "path": "/src/app.ts", "isFolder": false }
            }]
        })))
        .mount(&server)
        .await;

    let changes = test_client(&server)
        .await
        .get_pull_request_iteration_changes("project-1", "repo-1", 42, 3)
        .await
        .unwrap();
    assert_eq!(
        changes[0].item.as_ref().unwrap().path.as_deref(),
        Some("/src/app.ts")
    );
}

#[tokio::test]
async fn get_pull_request_iteration_changes_handles_missing_change_entries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/iterations/3/changes",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&server)
        .await;

    let changes = test_client(&server)
        .await
        .get_pull_request_iteration_changes("project-1", "repo-1", 42, 3)
        .await
        .unwrap();
    assert!(changes.is_empty());
}

#[tokio::test]
async fn list_pull_request_commits_maps_commit_fields() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/pullRequests/42/commits",
        ))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "commitId": "abc1234567890",
                "comment": "Add rate limiting\n\nDetails here.",
                "author": {
                    "name": "Alice",
                    "email": "alice@example.com",
                    "date": "2026-06-01T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;

    let commits = test_client(&server)
        .await
        .list_pull_request_commits("project-1", "repo-1", 42)
        .await
        .unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].commit_id, "abc1234567890");
    assert_eq!(
        commits[0].author.as_ref().unwrap().name.as_deref(),
        Some("Alice")
    );
}

#[tokio::test]
async fn get_item_content_requests_commit_version() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("path", "/src/app.ts"))
        .and(query_param("versionDescriptor.version", "abc"))
        .and(query_param("includeContent", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": "const x = 1;\n",
            "contentMetadata": { "isBinary": false }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .get_item_content("project-1", "repo-1", "/src/app.ts", "abc")
        .await
        .unwrap();
    assert_eq!(item.content.as_deref(), Some("const x = 1;\n"));
}

#[tokio::test]
async fn get_item_content_at_branch_requests_branch_version() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("path", "/src/app.ts"))
        .and(query_param("versionDescriptor.versionType", "branch"))
        .and(query_param("versionDescriptor.version", "main"))
        .and(query_param("includeContent", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": "line1\nline2\n",
            "contentMetadata": { "isBinary": false }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .get_item_content_at_branch("project-1", "repo-1", "/src/app.ts", "main")
        .await
        .unwrap();
    assert_eq!(item.content.as_deref(), Some("line1\nline2\n"));
}

#[tokio::test]
async fn get_item_content_at_version_requests_tag_version() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("path", "/src/app.ts"))
        .and(query_param("versionDescriptor.versionType", "tag"))
        .and(query_param("versionDescriptor.version", "v1.0"))
        .and(query_param("includeContent", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "content": "tagged\n",
            "contentMetadata": { "isBinary": false }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .get_item_content_at_version(
            "project-1",
            "repo-1",
            "/src/app.ts",
            crate::GitVersionType::Tag,
            "v1.0",
        )
        .await
        .unwrap();
    assert_eq!(item.content.as_deref(), Some("tagged\n"));
}

#[tokio::test]
async fn get_item_bytes_downloads_octet_stream() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("path", "/logo.png"))
        .and(query_param("$format", "octetStream"))
        .and(query_param("versionDescriptor.versionType", "branch"))
        .and(query_param("versionDescriptor.version", "main"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "image/png")
                .set_body_bytes(vec![0x89u8, 0x50, 0x4e, 0x47]),
        )
        .mount(&server)
        .await;

    let response = test_client(&server)
        .await
        .get_item_bytes(
            "project-1",
            "repo-1",
            "/logo.png",
            crate::GitVersionType::Branch,
            "main",
        )
        .await
        .unwrap();
    assert_eq!(response.bytes, vec![0x89u8, 0x50, 0x4e, 0x47]);
    assert_eq!(response.content_type.as_deref(), Some("image/png"));
}
