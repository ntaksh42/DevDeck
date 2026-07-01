use azdo_client::NewThreadContext;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};
use crate::prs::vote_label;

use super::helpers::{
    map_threads, root_comment_id, validate_merge_strategy, validate_thread_status, validate_vote,
};
use super::types::*;

impl PrReviewService {
    pub async fn post_comment(&self, input: PostPullRequestCommentInput) -> Result<PrThread> {
        let content = input.content.trim();
        if content.is_empty() {
            return Err(AppError::InvalidInput("comment is empty".to_string()));
        }
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let thread = if let Some(thread_id) = input.thread_id {
            // Fetch just this thread to find its root comment (the reply parent)
            // instead of trusting a client-supplied id; the same single-thread
            // call doubles as the up-to-date response after posting.
            let existing = client
                .get_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                )
                .await?;
            let parent_comment_id = root_comment_id(&existing);
            client
                .add_pull_request_comment(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                    parent_comment_id,
                    content,
                )
                .await?;
            client
                .get_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                )
                .await?
        } else {
            let context = match &input.file_path {
                Some(file_path) if input.right_line.is_some() || input.left_line.is_some() => {
                    Some(NewThreadContext {
                        file_path: file_path.clone(),
                        right_line: input.right_line,
                        left_line: input.left_line,
                    })
                }
                _ => None,
            };
            client
                .create_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    content,
                    context,
                )
                .await?
        };
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("posted thread has no visible comments".to_string())
            })
    }

    pub async fn set_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread> {
        validate_thread_status(&input.status)?;
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let thread = client
            .update_pull_request_thread_status(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                &input.status,
            )
            .await?;
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("updated thread has no visible comments".to_string())
            })
    }

    pub async fn update_pull_request(
        &self,
        input: UpdatePullRequestInput,
    ) -> Result<PrStatusResult> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let body = match input.action.as_str() {
            "abandon" => serde_json::json!({ "status": "abandoned" }),
            "reactivate" => serde_json::json!({ "status": "active" }),
            "publish" => serde_json::json!({ "isDraft": false }),
            "complete" => {
                let merge_strategy = input
                    .merge_strategy
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "merge strategy is required to complete a pull request".to_string(),
                        )
                    })?;
                validate_merge_strategy(merge_strategy)?;
                let detail = client
                    .get_pull_request_detail(
                        &input.pr.project_id,
                        &input.pr.repository_id,
                        input.pr.pull_request_id,
                    )
                    .await?;
                let last_commit = detail
                    .last_merge_source_commit
                    .map(|c| c.commit_id)
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "pull request has no source commit to merge".to_string(),
                        )
                    })?;
                serde_json::json!({
                    "status": "completed",
                    "lastMergeSourceCommit": { "commitId": last_commit },
                    "completionOptions": {
                        "mergeStrategy": merge_strategy,
                        "deleteSourceBranch": input.delete_source_branch.unwrap_or(false),
                        "transitionWorkItems": input.transition_work_items.unwrap_or(false),
                    }
                })
            }
            "enableAutoComplete" => {
                let me = organization
                    .authenticated_user_id
                    .as_deref()
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "the signed-in user id is unknown; cannot set auto-complete"
                                .to_string(),
                        )
                    })?;
                let merge_strategy = input
                    .merge_strategy
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "merge strategy is required to enable auto-complete".to_string(),
                        )
                    })?;
                validate_merge_strategy(merge_strategy)?;
                serde_json::json!({
                    "autoCompleteSetBy": { "id": me },
                    "completionOptions": {
                        "mergeStrategy": merge_strategy,
                        "deleteSourceBranch": input.delete_source_branch.unwrap_or(false),
                    }
                })
            }
            "cancelAutoComplete" => serde_json::json!({ "autoCompleteSetBy": null }),
            other => {
                return Err(AppError::InvalidInput(format!(
                    "unknown pull request action: {other}"
                )))
            }
        };
        let updated = client
            .update_pull_request(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &body,
            )
            .await?;
        Ok(PrStatusResult {
            status: updated.status,
            is_draft: updated.is_draft.unwrap_or(false),
        })
    }

    /// Marks an existing reviewer as required or optional (issue #384).
    pub async fn set_reviewer_required(
        &self,
        input: SetPullRequestReviewerRequiredInput,
    ) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .set_pull_request_reviewer_required(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &input.reviewer_id,
                input.is_required,
            )
            .await?;
        Ok(())
    }

    /// Removes a reviewer from a pull request (issue #384).
    pub async fn remove_reviewer(&self, input: RemovePullRequestReviewerInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .remove_pull_request_reviewer(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &input.reviewer_id,
            )
            .await?;
        Ok(())
    }

    /// Edits a pull request's title and description (issue #388). Sends a PATCH
    /// with the new values and returns what Azure DevOps persisted.
    pub async fn update_pull_request_details(
        &self,
        input: UpdatePullRequestDetailsInput,
    ) -> Result<PrDetailsResult> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput(
                "pull request title cannot be empty".to_string(),
            ));
        }
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let body = serde_json::json!({
            "title": title,
            "description": input.description.as_deref().unwrap_or("").trim(),
        });
        let updated = client
            .update_pull_request(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &body,
            )
            .await?;
        Ok(PrDetailsResult {
            title: updated.title,
            description: updated.description,
        })
    }

    pub async fn edit_comment(&self, input: EditPullRequestCommentInput) -> Result<PrThread> {
        let content = input.content.trim();
        if content.is_empty() {
            return Err(AppError::InvalidInput("comment is empty".to_string()));
        }
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .update_pull_request_comment(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                input.comment_id,
                content,
            )
            .await?;
        let thread = client
            .get_pull_request_thread(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
            )
            .await?;
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("edited thread has no visible comments".to_string())
            })
    }

    pub async fn delete_comment(&self, input: DeletePullRequestCommentInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .delete_pull_request_comment(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                input.comment_id,
            )
            .await?;
        Ok(())
    }

    pub async fn submit_vote(&self, input: SubmitPullRequestVoteInput) -> Result<PrReviewer> {
        validate_vote(input.vote)?;
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let reviewer_id = organization.authenticated_user_id.clone().ok_or_else(|| {
            AppError::InvalidInput(
                "organization has no authenticated user id; re-add the organization".to_string(),
            )
        })?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let reviewer = client
            .submit_pull_request_vote(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &reviewer_id,
                input.vote,
            )
            .await?;
        // Keep the cached review row in sync so the grid's vote column updates
        // immediately instead of waiting for the next background sync.
        let label = vote_label(reviewer.vote).to_string();
        match self.db.update_review_pr_vote(
            &organization.id,
            &input.pr.repository_id,
            input.pr.pull_request_id,
            reviewer.vote,
            &label,
        ) {
            Ok(0) => {
                // The PR is not in the My Reviews cache (opened from search or a
                // direct URL), so there is no grid row to keep in sync. The
                // command return value below still reflects the new vote.
                tracing::debug!(
                    pull_request_id = input.pr.pull_request_id,
                    "vote cast on PR absent from My Reviews cache; no cached row updated"
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error = %error, "failed to update cached review vote");
            }
        }
        Ok(PrReviewer {
            id: reviewer.id.clone(),
            is_me: true,
            display_name: reviewer.display_name.unwrap_or_default(),
            vote: reviewer.vote,
            vote_label: label,
            is_required: reviewer.is_required,
        })
    }

    /// Adds a label to a pull request by name (issue #386).
    pub async fn add_label(&self, input: AddPullRequestLabelInput) -> Result<()> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput(
                "label name cannot be empty".to_string(),
            ));
        }
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .add_pull_request_label(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                name,
            )
            .await?;
        Ok(())
    }

    /// Removes a label from a pull request (issue #386).
    pub async fn remove_label(&self, input: RemovePullRequestLabelInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .remove_pull_request_label(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &input.label_id,
            )
            .await?;
        Ok(())
    }
}
