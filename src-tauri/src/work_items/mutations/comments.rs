//! Single-item write operations: comment add/update/delete and reactions, work
//! item links, and the atomic multi-field patch. Each keeps the local cache in
//! sync after a successful write where applicable.

use serde_json::Value;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::super::conversions::{link_type_to_rel, related_work_item_id};
use super::super::{
    summarize_work_item_comment, summarize_work_item_preview, validate_update_field_reference_name,
    work_item_to_cached, AddWorkItemCommentInput, AddWorkItemLinkInput, DeleteWorkItemCommentInput,
    RemoveWorkItemLinkInput, SetWorkItemCommentReactionInput, UpdateWorkItemCommentInput,
    UpdateWorkItemFieldsInput, WorkItemComment, WorkItemPreview, WorkItemService,
    WORK_ITEM_PREVIEW_COMMENT_LIMIT,
};

impl WorkItemService {
    pub async fn add_comment(&self, input: AddWorkItemCommentInput) -> Result<WorkItemComment> {
        let markdown = input.markdown.trim();
        if markdown.is_empty() {
            return Err(AppError::InvalidInput("comment is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let comment = client
            .add_work_item_comment(&input.project_id, input.work_item_id, markdown)
            .await?;
        Ok(summarize_work_item_comment(comment))
    }

    pub async fn delete_comment(&self, input: DeleteWorkItemCommentInput) -> Result<()> {
        if input.comment_id <= 0 {
            return Err(AppError::InvalidInput("comment ID is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .delete_work_item_comment(&input.project_id, input.work_item_id, input.comment_id)
            .await?;
        Ok(())
    }

    pub async fn update_comment(
        &self,
        input: UpdateWorkItemCommentInput,
    ) -> Result<WorkItemComment> {
        if input.comment_id <= 0 {
            return Err(AppError::InvalidInput("comment ID is required".to_string()));
        }
        let markdown = input.markdown.trim();
        if markdown.is_empty() {
            return Err(AppError::InvalidInput("comment is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let comment = client
            .update_work_item_comment(
                &input.project_id,
                input.work_item_id,
                input.comment_id,
                markdown,
            )
            .await?;
        Ok(summarize_work_item_comment(comment))
    }

    /// Adds a work item link (Parent/Child/Related/Predecessor/Successor) to
    /// another work item by id (issue #390).
    pub async fn add_link(&self, input: AddWorkItemLinkInput) -> Result<()> {
        let rel = link_type_to_rel(&input.link_type).ok_or_else(|| {
            AppError::InvalidInput(format!("unknown link type: {}", input.link_type))
        })?;
        if input.target_id <= 0 {
            return Err(AppError::InvalidInput(
                "target work item id is required".to_string(),
            ));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let url = format!(
            "{}/_apis/wit/workItems/{}",
            organization.base_url, input.target_id
        );
        client
            .add_work_item_relation(&input.project_id, input.work_item_id, rel, &url)
            .await?;
        Ok(())
    }

    /// Removes the work item link of the given type to the given target
    /// (issue #390). Looks up the relation's index just before removing so the
    /// JSON Patch targets the correct entry.
    pub async fn remove_link(&self, input: RemoveWorkItemLinkInput) -> Result<()> {
        let rel = link_type_to_rel(&input.link_type).ok_or_else(|| {
            AppError::InvalidInput(format!("unknown link type: {}", input.link_type))
        })?;
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let relations = client
            .get_work_item_relations(&input.project_id, input.work_item_id)
            .await?;
        let index = relations
            .iter()
            .position(|relation| {
                relation.rel == rel && related_work_item_id(&relation.url) == Some(input.target_id)
            })
            .ok_or_else(|| AppError::InvalidInput("link not found".to_string()))?;
        client
            .remove_work_item_relation(&input.project_id, input.work_item_id, index)
            .await?;
        Ok(())
    }

    /// Adds or removes the authenticated user's emoji reaction on a work item
    /// comment.
    pub async fn set_comment_reaction(&self, input: SetWorkItemCommentReactionInput) -> Result<()> {
        if input.comment_id <= 0 {
            return Err(AppError::InvalidInput("comment ID is required".to_string()));
        }
        let reaction_type = match input.reaction_type.trim().to_ascii_lowercase().as_str() {
            value @ ("like" | "dislike" | "heart" | "hooray" | "smile" | "confused") => {
                value.to_string()
            }
            other => {
                return Err(AppError::InvalidInput(format!(
                    "invalid reaction type: {other}"
                )))
            }
        };
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .set_work_item_comment_reaction(
                &input.project_id,
                input.work_item_id,
                input.comment_id,
                &reaction_type,
                input.engaged,
            )
            .await?;
        Ok(())
    }

    // Applies all staged property changes in one JSON Patch request so state
    // transition rules evaluate the full change set atomically.
    pub async fn update_fields(&self, input: UpdateWorkItemFieldsInput) -> Result<WorkItemPreview> {
        if input.fields.is_empty() {
            return Err(AppError::InvalidInput(
                "at least one field is required".to_string(),
            ));
        }
        let mut fields: Vec<(String, Value)> = Vec::with_capacity(input.fields.len());
        for field in &input.fields {
            let reference_name = validate_update_field_reference_name(&field.reference_name)?;
            let value = if reference_name.eq_ignore_ascii_case("Microsoft.VSTS.Common.Priority") {
                field
                    .value
                    .trim()
                    .parse::<i64>()
                    .map(Value::from)
                    .unwrap_or_else(|_| Value::from(field.value.clone()))
            } else {
                Value::from(field.value.clone())
            };
            fields.push((reference_name.to_string(), value));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let work_item = client
            .update_work_item_fields(&project.id, input.work_item_id, &fields)
            .await?;
        let cached = work_item_to_cached(&organization, &project.id, &project.name, &work_item);
        if let Err(e) = self.db.upsert_work_items(std::slice::from_ref(&cached)) {
            tracing::warn!(error = %e, "failed to update work item cache after update_fields");
        }
        if let Err(e) = self.db.update_my_work_item_if_present(
            &cached,
            organization.authenticated_user_unique_name.as_deref(),
        ) {
            tracing::warn!(error = %e, "failed to update my_work_items cache after update_fields");
        }
        let comments_result = client
            .list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            )
            .await;
        let comments_unavailable = comments_result.is_err();
        let comments = comments_result.unwrap_or_default();

        let mut preview = summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        );
        preview.comments_unavailable = comments_unavailable;
        Ok(preview)
    }
}
