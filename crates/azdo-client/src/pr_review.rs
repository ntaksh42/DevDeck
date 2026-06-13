use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::{GitCommitRef, IdentityRef, IdentityRefWithVote, ListResponse};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIteration {
    pub id: i64,
    pub source_ref_commit: Option<GitCommitRefId>,
    pub common_ref_commit: Option<GitCommitRefId>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRefId {
    pub commit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIterationChanges {
    pub change_entries: Vec<GitChangeEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeEntry {
    pub change_type: Option<String>,
    pub item: Option<GitChangeItem>,
    /// Pre-rename path when the change is a rename.
    pub source_server_item: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeItem {
    pub path: Option<String>,
    pub is_folder: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitItemContent {
    pub content: Option<String>,
    pub content_metadata: Option<GitContentMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContentMetadata {
    pub is_binary: Option<bool>,
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

    pub async fn submit_pull_request_vote(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        reviewer_id: &str,
        vote: i32,
    ) -> Result<IdentityRefWithVote> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/reviewers/{reviewer_id}"
        );
        let body = json!({ "vote": vote, "id": reviewer_id });
        self.put_json(&path, &[("api-version", "7.1-preview")], &body)
            .await
    }

    pub async fn list_pull_request_iterations(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<GitIteration>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/iterations"
        );
        let response: ListResponse<GitIteration> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    /// `$compareTo=0` returns the cumulative changes against the PR base.
    pub async fn get_pull_request_iteration_changes(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        iteration_id: i64,
    ) -> Result<Vec<GitChangeEntry>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/iterations/{iteration_id}/changes"
        );
        let response: GitIterationChanges = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$compareTo", "0")],
            )
            .await?;
        Ok(response.change_entries)
    }

    pub async fn list_pull_request_commits(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<GitCommitRef>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/commits"
        );
        let response: ListResponse<GitCommitRef> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    /// Fetches the (text) content of a file at a specific commit.
    pub async fn get_item_content(
        &self,
        project_id: &str,
        repository_id: &str,
        item_path: &str,
        commit_id: &str,
    ) -> Result<GitItemContent> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/items");
        self.get_json(
            &path,
            &[
                ("api-version", "7.1-preview"),
                ("path", item_path),
                ("versionDescriptor.versionType", "commit"),
                ("versionDescriptor.version", commit_id),
                ("includeContent", "true"),
                ("$format", "json"),
            ],
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

    #[tokio::test]
    async fn submit_pull_request_vote_puts_vote_for_reviewer() {
        let server = MockServer::start().await;
        Mock::given(method("PUT"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullRequests/42/reviewers/user-42",
            ))
            .and(body_partial_json(serde_json::json!({ "vote": 10 })))
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
}
