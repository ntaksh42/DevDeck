use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Deserialize;
use serde_json::json;

use crate::client::GitHubClient;
use crate::error::{GitHubError, Result};
use crate::models::{
    IssueComment, PrCommitItem, PrFileItem, PullRequestDetail, ReviewComment, ReviewItem,
};

/// Percent-encodes a file path for use in a REST URL path, preserving `/`.
fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        match byte {
            b'/' => out.push('/'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[derive(Debug, Deserialize)]
struct ContentResponse {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    encoding: Option<String>,
}

impl GitHubClient {
    pub async fn get_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<PullRequestDetail> {
        self.get_json(&format!("repos/{owner}/{repo}/pulls/{number}"), &[])
            .await
    }

    pub async fn list_pull_request_reviews(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Vec<ReviewItem>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/reviews"),
            &[("per_page", "100")],
        )
        .await
    }

    pub async fn list_issue_comments(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Vec<IssueComment>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/issues/{number}/comments"),
            &[("per_page", "100")],
        )
        .await
    }

    pub async fn list_review_comments(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Vec<ReviewComment>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/comments"),
            &[("per_page", "100")],
        )
        .await
    }

    pub async fn list_pull_request_files(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Vec<PrFileItem>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/files"),
            &[("per_page", "100")],
        )
        .await
    }

    pub async fn list_pull_request_commits(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
    ) -> Result<Vec<PrCommitItem>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/commits"),
            &[("per_page", "100")],
        )
        .await
    }

    /// Fetches and base64-decodes a file's content at a given ref. Returns
    /// `Ok(None)` when the path does not exist at that ref (e.g. an added or
    /// deleted file's missing side), so diff callers can render one-sided diffs.
    pub async fn get_file_content(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        git_ref: &str,
    ) -> Result<Option<String>> {
        let encoded = encode_path(path);
        let result: Result<ContentResponse> = self
            .get_json(
                &format!("repos/{owner}/{repo}/contents/{encoded}"),
                &[("ref", git_ref)],
            )
            .await;
        match result {
            Ok(response) => {
                if response.encoding.as_deref() == Some("base64") {
                    if let Some(content) = response.content {
                        let cleaned: String =
                            content.chars().filter(|c| !c.is_whitespace()).collect();
                        let bytes = BASE64
                            .decode(cleaned.as_bytes())
                            .map_err(|e| GitHubError::Auth(format!("base64 decode: {e}")))?;
                        return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
                    }
                }
                Ok(None)
            }
            Err(GitHubError::Api { status: 404, .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn create_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        body: &str,
    ) -> Result<IssueComment> {
        self.post_json(
            &format!("repos/{owner}/{repo}/issues/{number}/comments"),
            &json!({ "body": body }),
        )
        .await
    }

    pub async fn update_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        comment_id: i64,
        body: &str,
    ) -> Result<IssueComment> {
        self.patch_json(
            &format!("repos/{owner}/{repo}/issues/comments/{comment_id}"),
            &json!({ "body": body }),
        )
        .await
    }

    pub async fn delete_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        comment_id: i64,
    ) -> Result<()> {
        self.delete(&format!(
            "repos/{owner}/{repo}/issues/comments/{comment_id}"
        ))
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        body: &str,
        commit_id: &str,
        path: &str,
        line: i64,
        side: &str,
    ) -> Result<ReviewComment> {
        self.post_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/comments"),
            &json!({
                "body": body,
                "commit_id": commit_id,
                "path": path,
                "line": line,
                "side": side,
            }),
        )
        .await
    }

    pub async fn reply_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        comment_id: i64,
        body: &str,
    ) -> Result<ReviewComment> {
        self.post_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies"),
            &json!({ "body": body }),
        )
        .await
    }

    pub async fn update_review_comment(
        &self,
        owner: &str,
        repo: &str,
        comment_id: i64,
        body: &str,
    ) -> Result<ReviewComment> {
        self.patch_json(
            &format!("repos/{owner}/{repo}/pulls/comments/{comment_id}"),
            &json!({ "body": body }),
        )
        .await
    }

    pub async fn delete_review_comment(
        &self,
        owner: &str,
        repo: &str,
        comment_id: i64,
    ) -> Result<()> {
        self.delete(&format!("repos/{owner}/{repo}/pulls/comments/{comment_id}"))
            .await
    }

    /// Submits a review with an event: APPROVE | REQUEST_CHANGES | COMMENT.
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        event: &str,
        body: &str,
    ) -> Result<ReviewItem> {
        self.post_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/reviews"),
            &json!({ "event": event, "body": body }),
        )
        .await
    }

    /// Patches a pull request (title, body, state: "open"|"closed").
    pub async fn update_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        patch: serde_json::Value,
    ) -> Result<PullRequestDetail> {
        self.patch_json(&format!("repos/{owner}/{repo}/pulls/{number}"), &patch)
            .await
    }

    /// Merges a pull request. `method` is merge | squash | rebase.
    pub async fn merge_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        method: &str,
    ) -> Result<serde_json::Value> {
        self.put_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/merge"),
            &json!({ "merge_method": method }),
        )
        .await
    }

    pub async fn request_reviewers(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        reviewers: &[String],
    ) -> Result<serde_json::Value> {
        self.post_json(
            &format!("repos/{owner}/{repo}/pulls/{number}/requested_reviewers"),
            &json!({ "reviewers": reviewers }),
        )
        .await
    }

    pub async fn remove_requested_reviewers(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        reviewers: &[String],
    ) -> Result<()> {
        // DELETE with a body is required by this endpoint.
        self.delete_with_body(
            &format!("repos/{owner}/{repo}/pulls/{number}/requested_reviewers"),
            &json!({ "reviewers": reviewers }),
        )
        .await
    }
}
