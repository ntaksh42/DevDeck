use crate::client::AdoClient;
use crate::error::Result;

use super::types::*;

impl AdoClient {
    pub async fn add_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        self.post_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
        .await
    }

    pub async fn delete_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
    ) -> Result<()> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.delete(&path, &[("api-version", "7.1-preview.4")])
            .await
    }

    pub async fn update_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            "application/json",
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
        .await
    }

    pub async fn list_work_item_comments(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemComment>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        let top_str = top.to_string();
        // `$expand=all` returns both reactions and `renderedText`. Without
        // `renderedText`, Azure DevOps does not resolve `@<guid>` mention tokens
        // into display names, so the preview falls back to raw ids (and the
        // sanitizer can even drop the token entirely). `all` lets the service
        // resolve mentions the same way the web UI does.
        let response: WorkItemCommentsList = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview.4"),
                    ("$top", &top_str),
                    ("order", "desc"),
                    ("$expand", "all"),
                ],
            )
            .await?;
        Ok(response.comments)
    }

    /// Adds (`engaged = true`) or removes (`engaged = false`) the current user's
    /// reaction of `reaction_type` on a work item comment. `reaction_type` is one
    /// of `like`, `dislike`, `heart`, `hooray`, `smile`, `confused`.
    pub async fn set_work_item_comment_reaction(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
        reaction_type: &str,
        engaged: bool,
    ) -> Result<()> {
        let path = format!(
            "{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}/reactions/{reaction_type}"
        );
        let query = [("api-version", "7.1-preview.1")];
        if engaged {
            let _: CommentReaction = self.put_json(&path, &query, &serde_json::json!({})).await?;
        } else {
            self.delete(&path, &query).await?;
        }
        Ok(())
    }

    pub async fn list_work_item_updates(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemUpdate>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/updates");
        let top_str = top.to_string();
        let response: WorkItemUpdatesList = self
            .get_json(&path, &[("api-version", "7.1-preview"), ("$top", &top_str)])
            .await?;
        Ok(response.value)
    }
}
