use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param, query_param_is_missing};
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
async fn get_commit_parses_parents() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/commits/abc123",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "commitId": "abc123",
            "comment": "Fix bug",
            "parents": ["parent1", "parent0"]
        })))
        .mount(&server)
        .await;

    let commit = test_client(&server)
        .await
        .get_commit("project-1", "repo-1", "abc123")
        .await
        .unwrap();
    assert_eq!(commit.commit_id, "abc123");
    assert_eq!(
        commit.parents.as_deref(),
        Some(["parent1".to_string(), "parent0".to_string()].as_slice())
    );
}

#[tokio::test]
async fn get_commit_changes_maps_entries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/commits/abc123/changes",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "changeCounts": { "Edit": 1 },
            "changes": [
                {
                    "item": { "path": "/src/main.rs", "isFolder": false },
                    "changeType": "edit"
                },
                {
                    "item": { "path": "/src", "isFolder": true },
                    "changeType": "edit"
                }
            ]
        })))
        .mount(&server)
        .await;

    let changes = test_client(&server)
        .await
        .get_commit_changes("project-1", "repo-1", "abc123")
        .await
        .unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(
        changes[0].item.as_ref().unwrap().path.as_deref(),
        Some("/src/main.rs")
    );
}

#[tokio::test]
async fn get_commit_diffs_sends_base_and_target_versions() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/git/repositories/repo-1/diffs/commits",
        ))
        .and(query_param("baseVersion", "parent2"))
        .and(query_param("baseVersionType", "commit"))
        .and(query_param("targetVersion", "merge-commit"))
        .and(query_param("targetVersionType", "commit"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "allChangesIncluded": true,
            "changeCounts": { "Edit": 1 },
            "changes": [
                {
                    "item": { "path": "/src/other.rs", "isFolder": false },
                    "changeType": "edit"
                }
            ]
        })))
        .mount(&server)
        .await;

    let changes = test_client(&server)
        .await
        .get_commit_diffs("project-1", "repo-1", "parent2", "merge-commit")
        .await
        .unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(
        changes[0].item.as_ref().unwrap().path.as_deref(),
        Some("/src/other.rs")
    );
}

#[tokio::test]
async fn list_commits_uses_search_criteria() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("$top", "25"))
        .and(query_param("searchCriteria.author", "test@example.com"))
        .and(query_param(
            "searchCriteria.itemVersion.versionType",
            "branch",
        ))
        .and(query_param("searchCriteria.itemVersion.version", "main"))
        .and(query_param(
            "searchCriteria.fromDate",
            "2026-05-01T00:00:00Z",
        ))
        .and(query_param("searchCriteria.toDate", "2026-05-24T23:59:59Z"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "commitId": "abc123",
                "comment": "Add commit search",
                "author": {
                    "name": "Test User",
                    "email": "test@example.com",
                    "date": "2026-05-24T00:00:00Z"
                },
                "remoteUrl": "https://dev.azure.com/testorg/project/_git/repo/commit/abc123"
            }]
        })))
        .mount(&server)
        .await;

    let commits = test_client(&server)
        .await
        .list_commits(
            "project-1",
            "repo-1",
            CommitSearchCriteria {
                author: Some("test@example.com".to_string()),
                branch: Some("refs/heads/main".to_string()),
                item_path: None,
                from_date: Some("2026-05-01T00:00:00Z".to_string()),
                to_date: Some("2026-05-24T23:59:59Z".to_string()),
                top: Some(25),
                skip: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].commit_id, "abc123");
    assert_eq!(
        commits[0].author.as_ref().unwrap().name.as_deref(),
        Some("Test User")
    );
}

#[tokio::test]
async fn list_commits_sends_item_path() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
        .and(query_param("searchCriteria.itemPath", "/src/auth"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "commitId": "pathmatch", "comment": "touch src/auth" }]
        })))
        .mount(&server)
        .await;

    let commits = test_client(&server)
        .await
        .list_commits(
            "project-1",
            "repo-1",
            CommitSearchCriteria {
                item_path: Some("/src/auth".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].commit_id, "pathmatch");
}

#[tokio::test]
async fn list_commits_sends_skip_when_set() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
        .and(query_param("$top", "100"))
        .and(query_param("$skip", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "commitId": "page2", "comment": "second page" }]
        })))
        .mount(&server)
        .await;

    let commits = test_client(&server)
        .await
        .list_commits(
            "project-1",
            "repo-1",
            CommitSearchCriteria {
                top: Some(100),
                skip: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].commit_id, "page2");
}

#[tokio::test]
async fn list_commits_omits_skip_when_zero() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
        .and(query_param_is_missing("$skip"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 0,
            "value": []
        })))
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .list_commits(
            "project-1",
            "repo-1",
            CommitSearchCriteria {
                skip: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn list_branches_filters_heads() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/refs"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("filter", "heads/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 2,
            "value": [
                { "name": "refs/heads/main", "objectId": "abc" },
                { "name": "refs/heads/feature/x", "objectId": "def" }
            ]
        })))
        .mount(&server)
        .await;

    let refs = test_client(&server)
        .await
        .list_branches("project-1", "repo-1")
        .await
        .unwrap();
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0].name, "refs/heads/main");
    assert_eq!(refs[0].object_id.as_deref(), Some("abc"));
}

#[tokio::test]
async fn list_items_requests_one_level_at_branch() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("recursionLevel", "OneLevel"))
        .and(query_param("scopePath", "/src"))
        .and(query_param("versionDescriptor.versionType", "branch"))
        .and(query_param("versionDescriptor.version", "main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 3,
            "value": [
                { "path": "/src", "isFolder": true },
                { "path": "/src/lib", "isFolder": true },
                { "path": "/src/main.py" }
            ]
        })))
        .mount(&server)
        .await;

    let items = test_client(&server)
        .await
        .list_items("project-1", "repo-1", "main", "/src", false)
        .await
        .unwrap();
    assert_eq!(items.len(), 3);
    assert!(items[1].is_folder);
    assert!(!items[2].is_folder);
    assert_eq!(items[2].path, "/src/main.py");
    assert!(items[2].latest_processed_change.is_none());
}

#[tokio::test]
async fn list_items_includes_latest_commit_when_requested() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories/repo-1/items"))
        .and(query_param("latestProcessedChange", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [
                {
                    "path": "/README.md",
                    "latestProcessedChange": {
                        "commitId": "7219380abc",
                        "comment": "Initial calculator service",
                        "author": { "name": "naoto akashi", "date": "2026-06-13T00:00:00Z" }
                    }
                }
            ]
        })))
        .mount(&server)
        .await;

    let items = test_client(&server)
        .await
        .list_items("project-1", "repo-1", "main", "/", true)
        .await
        .unwrap();
    let change = items[0].latest_processed_change.as_ref().unwrap();
    assert_eq!(change.commit_id, "7219380abc");
    assert_eq!(
        change.comment.as_deref(),
        Some("Initial calculator service")
    );
}
