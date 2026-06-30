use serde_json::json;

use crate::client::{AdoClient, BinaryResponse};
use crate::error::Result;
use crate::git::{GitCommitRef, IdentityRefWithVote, ListResponse};

use super::types::{
    GitChangeEntry, GitItemContent, GitIteration, GitIterationChanges, GitPullRequestDetail,
    GitThread, GitThreadComment, NewThreadContext,
};

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

    pub async fn get_pull_request_thread(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        thread_id: i64,
    ) -> Result<GitThread> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads/{thread_id}"
        );
        self.get_json(&path, &[("api-version", "7.1-preview")])
            .await
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
            let mut thread_context = json!({ "filePath": context.file_path });
            if let Some(line) = context.right_line {
                thread_context["rightFileStart"] = json!({ "line": line, "offset": 1 });
                thread_context["rightFileEnd"] = json!({ "line": line, "offset": 1 });
            }
            if let Some(line) = context.left_line {
                thread_context["leftFileStart"] = json!({ "line": line, "offset": 1 });
                thread_context["leftFileEnd"] = json!({ "line": line, "offset": 1 });
            }
            body["threadContext"] = thread_context;
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

    pub async fn update_pull_request_comment(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        thread_id: i64,
        comment_id: i64,
        content: &str,
    ) -> Result<GitThreadComment> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads/{thread_id}/comments/{comment_id}"
        );
        let body = json!({ "content": content });
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json",
            &body,
        )
        .await
    }

    pub async fn delete_pull_request_comment(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        thread_id: i64,
        comment_id: i64,
    ) -> Result<()> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/threads/{thread_id}/comments/{comment_id}"
        );
        self.delete(&path, &[("api-version", "7.1-preview")]).await
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

    pub async fn update_pull_request(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        body: &serde_json::Value,
    ) -> Result<GitPullRequestDetail> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullrequests/{pull_request_id}"
        );
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json",
            body,
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

    /// Marks an existing reviewer as required or optional (PUT on the same
    /// reviewers endpoint as voting).
    pub async fn set_pull_request_reviewer_required(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        reviewer_id: &str,
        is_required: bool,
    ) -> Result<IdentityRefWithVote> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/reviewers/{reviewer_id}"
        );
        let body = json!({ "id": reviewer_id, "isRequired": is_required });
        self.put_json(&path, &[("api-version", "7.1-preview")], &body)
            .await
    }

    /// Removes a reviewer from a pull request.
    pub async fn remove_pull_request_reviewer(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        reviewer_id: &str,
    ) -> Result<()> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/pullRequests/{pull_request_id}/reviewers/{reviewer_id}"
        );
        self.delete(&path, &[("api-version", "7.1-preview")]).await
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
    /// Follows `nextSkip` so PRs with more changed files than one page fit are
    /// returned in full.
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
        let mut all = Vec::new();
        let mut skip: Option<i64> = None;
        loop {
            let skip_value = skip.map(|value| value.to_string());
            let mut query = vec![
                ("api-version", "7.1-preview"),
                ("$compareTo", "0"),
                ("$top", "1000"),
            ];
            if let Some(skip_value) = skip_value.as_deref() {
                query.push(("$skip", skip_value));
            }
            let response: GitIterationChanges = self.get_json(&path, &query).await?;
            all.extend(response.change_entries);
            match response.next_skip {
                Some(next) if next > 0 && next != skip.unwrap_or(0) => skip = Some(next),
                _ => break,
            }
        }
        Ok(all)
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

    /// Fetches the (text) content of a file at the tip of a branch.
    pub async fn get_item_content_at_branch(
        &self,
        project_id: &str,
        repository_id: &str,
        item_path: &str,
        branch: &str,
    ) -> Result<GitItemContent> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/items");
        self.get_json(
            &path,
            &[
                ("api-version", "7.1-preview"),
                ("path", item_path),
                ("versionDescriptor.versionType", "branch"),
                ("versionDescriptor.version", branch),
                ("includeContent", "true"),
                ("$format", "json"),
            ],
        )
        .await
    }

    /// Fetches the raw bytes of a file at the tip of a branch, e.g. for
    /// binary/image preview or download. Unlike [`get_item_content_at_branch`],
    /// which always decodes a JSON envelope, this requests the item's raw
    /// representation directly.
    pub async fn get_item_bytes_at_branch(
        &self,
        project_id: &str,
        repository_id: &str,
        item_path: &str,
        branch: &str,
    ) -> Result<BinaryResponse> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/items");
        self.get_bytes(
            &path,
            &[
                ("api-version", "7.1-preview"),
                ("path", item_path),
                ("versionDescriptor.versionType", "branch"),
                ("versionDescriptor.version", branch),
                ("download", "true"),
            ],
        )
        .await
    }
}
