use chrono::{DateTime, Utc};
use serde::Deserialize;

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
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
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
}
