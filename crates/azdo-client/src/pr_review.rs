use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::{IdentityRef, IdentityRefWithVote, ListResponse};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequestDetail {
    pub pull_request_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub created_by: Option<IdentityRef>,
    pub creation_date: Option<DateTime<Utc>>,
    pub reviewers: Option<Vec<IdentityRefWithVote>>,
    pub is_draft: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThread {
    pub id: i64,
    pub status: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
    pub comments: Option<Vec<GitThreadComment>>,
    pub thread_context: Option<GitThreadContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThreadComment {
    pub id: i64,
    pub parent_comment_id: Option<i64>,
    pub content: Option<String>,
    pub comment_type: Option<String>,
    pub author: Option<IdentityRef>,
    pub published_date: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThreadContext {
    pub file_path: Option<String>,
    pub right_file_start: Option<GitFilePosition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFilePosition {
    pub line: i64,
}

/// Anchor for a new file-scoped thread (right/target side of the diff).
#[derive(Debug, Clone)]
pub struct NewThreadContext {
    pub file_path: String,
    pub right_line: i64,
}

impl AdoClient {
    pub async fn get_pull_request_detail(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<GitPullRequestDetail> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullrequests/{pull_request_id}"
        );
        self.get_json(&path, &[("api-version", "7.1-preview")])
            .await
    }

    pub async fn list_pull_request_threads(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<GitThread>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads"
        );
        let response: ListResponse<GitThread> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    pub async fn create_pull_request_thread(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        content: &str,
        thread_context: Option<NewThreadContext>,
    ) -> Result<GitThread> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads"
        );
        let mut body = json!({
            "comments": [{ "parentCommentId": 0, "content": content, "commentType": 1 }],
            "status": 1
        });
        if let Some(context) = thread_context {
            body["threadContext"] = json!({
                "filePath": context.file_path,
                "rightFileStart": { "line": context.right_line, "offset": 1 },
                "rightFileEnd": { "line": context.right_line, "offset": 1 }
            });
        }
        self.post_json(&path, &[("api-version", "7.1-preview")], &body)
            .await
    }

    pub async fn add_pull_request_comment(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        thread_id: i64,
        parent_comment_id: i64,
        content: &str,
    ) -> Result<GitThreadComment> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads/{thread_id}/comments"
        );
        let body = json!({
            "parentCommentId": parent_comment_id,
            "content": content,
            "commentType": 1
        });
        self.post_json(&path, &[("api-version", "7.1-preview")], &body)
            .await
    }

    pub async fn update_pull_request_thread_status(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        thread_id: i64,
        status: &str,
    ) -> Result<GitThread> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads/{thread_id}"
        );
        let body = json!({ "status": status });
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json",
            &body,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_partial_json, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn get_pull_request_detail_maps_description_and_reviewers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullrequests/42",
            ))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "pullRequestId": 42,
                "title": "Add dashboard",
                "description": "This PR adds the dashboard.",
                "status": "active",
                "creationDate": "2026-05-24T00:00:00Z",
                "sourceRefName": "refs/heads/feature/dashboard",
                "targetRefName": "refs/heads/main",
                "createdBy": { "displayName": "Author", "uniqueName": "author@example.com" },
                "reviewers": [
                    { "id": "user-42", "displayName": "Me", "vote": 10, "isRequired": true }
                ],
                "isDraft": false
            })))
            .mount(&server)
            .await;

        let detail = test_client(&server)
            .await
            .get_pull_request_detail("project-1", "repo-1", 42)
            .await
            .unwrap();
        assert_eq!(
            detail.description.as_deref(),
            Some("This PR adds the dashboard.")
        );
        assert_eq!(detail.reviewers.as_ref().unwrap()[0].vote, 10);
    }

    #[tokio::test]
    async fn list_pull_request_threads_maps_context_and_comments() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/threads",
            ))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 7,
                    "status": "active",
                    "threadContext": {
                        "filePath": "/src/app.ts",
                        "rightFileStart": { "line": 12, "offset": 1 }
                    },
                    "comments": [{
                        "id": 1,
                        "parentCommentId": 0,
                        "content": "Please rename this.",
                        "commentType": "text",
                        "author": { "displayName": "Reviewer" },
                        "publishedDate": "2026-06-01T00:00:00Z"
                    }]
                }]
            })))
            .mount(&server)
            .await;

        let threads = test_client(&server)
            .await
            .list_pull_request_threads("project-1", "repo-1", 42)
            .await
            .unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(
            threads[0]
                .thread_context
                .as_ref()
                .unwrap()
                .file_path
                .as_deref(),
            Some("/src/app.ts")
        );
        assert_eq!(
            threads[0]
                .thread_context
                .as_ref()
                .unwrap()
                .right_file_start
                .as_ref()
                .unwrap()
                .line,
            12
        );
        assert_eq!(
            threads[0].comments.as_ref().unwrap()[0].content.as_deref(),
            Some("Please rename this.")
        );
    }

    #[tokio::test]
    async fn create_pull_request_thread_posts_content_and_context() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/threads",
            ))
            .and(body_partial_json(serde_json::json!({
                "comments": [{ "parentCommentId": 0, "content": "New comment", "commentType": 1 }],
                "threadContext": {
                    "filePath": "/src/app.ts",
                    "rightFileStart": { "line": 12, "offset": 1 }
                }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 9,
                "status": "active",
                "comments": [{ "id": 1, "parentCommentId": 0, "content": "New comment" }]
            })))
            .mount(&server)
            .await;

        let thread = test_client(&server)
            .await
            .create_pull_request_thread(
                "project-1",
                "repo-1",
                42,
                "New comment",
                Some(NewThreadContext {
                    file_path: "/src/app.ts".to_string(),
                    right_line: 12,
                }),
            )
            .await
            .unwrap();
        assert_eq!(thread.id, 9);
    }

    #[tokio::test]
    async fn add_pull_request_comment_posts_reply() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/threads/7/comments",
            ))
            .and(body_partial_json(serde_json::json!({
                "parentCommentId": 1,
                "content": "Done."
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 2,
                "parentCommentId": 1,
                "content": "Done."
            })))
            .mount(&server)
            .await;

        let comment = test_client(&server)
            .await
            .add_pull_request_comment("project-1", "repo-1", 42, 7, 1, "Done.")
            .await
            .unwrap();
        assert_eq!(comment.id, 2);
    }

    #[tokio::test]
    async fn update_pull_request_thread_status_patches_status() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/threads/7",
            ))
            .and(body_partial_json(serde_json::json!({ "status": "closed" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 7,
                "status": "closed",
                "comments": []
            })))
            .mount(&server)
            .await;

        let thread = test_client(&server)
            .await
            .update_pull_request_thread_status("project-1", "repo-1", 42, 7, "closed")
            .await
            .unwrap();
        assert_eq!(thread.status.as_deref(), Some("closed"));
    }
}
