//! Write operations over the work item IPC surface: adding/deleting comments,
//! patching fields on a single item, and the bulk state/assignee/priority
//! changes. Each keeps the local cache in sync after a successful write, and the
//! bulk operations re-check read-only mode between iterations. When read-only
//! mode stops a run partway, the remaining items are reported as failures rather
//! than being silently dropped, so the frontend can notify the user.

use std::collections::HashMap;

use serde_json::Value;

use crate::auth::client_for_organization;
use crate::db::{CachedWorkItem, Organization};
use crate::error::{AppError, Result};
use crate::settings::SettingsService;

use super::conversions::{link_type_to_rel, related_work_item_id};
use super::{
    summarize_work_item_comment, summarize_work_item_preview, validate_update_field_reference_name,
    work_item_to_cached, AddWorkItemCommentInput, AddWorkItemLinkInput, AssignWorkItemsInput,
    BulkWorkItemResult, DeleteWorkItemCommentInput, RemoveWorkItemLinkInput,
    SetWorkItemCommentReactionInput, SetWorkItemsPriorityInput, SetWorkItemsStateInput,
    SetWorkItemsTagsInput, UpdateWorkItemCommentInput, UpdateWorkItemFieldsInput, WorkItemComment,
    WorkItemPreview, WorkItemService, WORK_ITEM_PREVIEW_COMMENT_LIMIT,
};

impl WorkItemService {
    pub async fn set_items_state(
        &self,
        input: SetWorkItemsStateInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        let state = input.state.trim().to_string();
        if state.is_empty() {
            return Err(AppError::InvalidInput("state is required".to_string()));
        }
        if input.work_item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let mut results = Vec::new();
        let mut updated = Vec::new();
        let mut ids = input.work_item_ids.into_iter();
        for id in ids.by_ref() {
            if let Err(e) = self.ensure_write_enabled() {
                let message = e.to_string();
                results.push(BulkWorkItemResult {
                    id,
                    error: Some(message.clone()),
                });
                for skipped in ids.by_ref() {
                    results.push(BulkWorkItemResult {
                        id: skipped,
                        error: Some(message.clone()),
                    });
                }
                break;
            }
            match client.update_work_item_state(&project.id, id, &state).await {
                Ok(wi) => {
                    updated.push(work_item_to_cached(
                        &organization,
                        &project.id,
                        &project.name,
                        &wi,
                    ));
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
        self.apply_bulk_cache_updates(&updated, &organization, "set_items_state");
        Ok(results)
    }

    /// Reflects the successful subset of a bulk operation into the local cache
    /// in one connection/transaction so large batches do not pay the per-item
    /// connection and implicit-transaction overhead.
    fn apply_bulk_cache_updates(
        &self,
        items: &[CachedWorkItem],
        organization: &Organization,
        context: &str,
    ) {
        if let Err(e) = self.db.apply_work_item_updates(
            items,
            organization.authenticated_user_unique_name.as_deref(),
        ) {
            tracing::warn!(error = %e, context, "failed to update work item cache after bulk update");
        }
    }

    /// Re-checks read-only mode between bulk iterations so toggling it mid-run
    /// stops further writes instead of letting the loop finish.
    fn ensure_write_enabled(&self) -> Result<()> {
        if SettingsService::new(self.db.clone())
            .get()?
            .read_only_validation_mode_enabled
        {
            return Err(AppError::InvalidInput(
                "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps."
                    .to_string(),
            ));
        }
        Ok(())
    }

    pub async fn assign_items(
        &self,
        input: AssignWorkItemsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        let assigned_to = input.assigned_to.trim().to_string();
        if assigned_to.is_empty() {
            return Err(AppError::InvalidInput("assignee is required".to_string()));
        }
        if input.work_item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let mut results = Vec::new();
        let mut updated = Vec::new();
        let mut ids = input.work_item_ids.into_iter();
        for id in ids.by_ref() {
            if let Err(e) = self.ensure_write_enabled() {
                let message = e.to_string();
                results.push(BulkWorkItemResult {
                    id,
                    error: Some(message.clone()),
                });
                for skipped in ids.by_ref() {
                    results.push(BulkWorkItemResult {
                        id: skipped,
                        error: Some(message.clone()),
                    });
                }
                break;
            }
            match client
                .update_work_item_assigned_to(&project.id, id, &assigned_to)
                .await
            {
                Ok(wi) => {
                    updated.push(work_item_to_cached(
                        &organization,
                        &project.id,
                        &project.name,
                        &wi,
                    ));
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
        self.apply_bulk_cache_updates(&updated, &organization, "assign_items");
        Ok(results)
    }

    pub async fn set_items_priority(
        &self,
        input: SetWorkItemsPriorityInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        if input.priority <= 0 {
            return Err(AppError::InvalidInput(
                "priority must be positive".to_string(),
            ));
        }
        if input.work_item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let mut results = Vec::new();
        let mut updated = Vec::new();
        let mut ids = input.work_item_ids.into_iter();
        for id in ids.by_ref() {
            if let Err(e) = self.ensure_write_enabled() {
                let message = e.to_string();
                results.push(BulkWorkItemResult {
                    id,
                    error: Some(message.clone()),
                });
                for skipped in ids.by_ref() {
                    results.push(BulkWorkItemResult {
                        id: skipped,
                        error: Some(message.clone()),
                    });
                }
                break;
            }
            match client
                .update_work_item_priority(&project.id, id, input.priority)
                .await
            {
                Ok(wi) => {
                    updated.push(work_item_to_cached(
                        &organization,
                        &project.id,
                        &project.name,
                        &wi,
                    ));
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
        self.apply_bulk_cache_updates(&updated, &organization, "set_items_priority");
        Ok(results)
    }

    /// Adds and/or removes `System.Tags` across many work items. Tags are a
    /// single ';'-joined field, so the current tags are read first and merged
    /// (case-insensitive add/remove) rather than overwritten (issue #448).
    pub async fn set_items_tags(
        &self,
        input: SetWorkItemsTagsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        let add = normalize_tags(&input.add_tags);
        let remove = normalize_tags(&input.remove_tags);
        if add.is_empty() && remove.is_empty() {
            return Err(AppError::InvalidInput(
                "at least one tag to add or remove is required".to_string(),
            ));
        }
        if input.work_item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let existing = client
            .get_work_items_batch(
                &project.id,
                input.work_item_ids.clone(),
                vec!["System.Tags".to_string()],
            )
            .await?;
        let mut current_tags: HashMap<i64, Vec<String>> = HashMap::new();
        for wi in existing {
            let tags = wi
                .fields
                .get("System.Tags")
                .and_then(|value| value.as_str())
                .map(split_tags)
                .unwrap_or_default();
            current_tags.insert(wi.id, tags);
        }
        let remove_lower: std::collections::HashSet<String> =
            remove.iter().map(|tag| tag.to_lowercase()).collect();

        let mut results = Vec::new();
        let mut updated = Vec::new();
        let mut ids = input.work_item_ids.into_iter();
        for id in ids.by_ref() {
            if let Err(e) = self.ensure_write_enabled() {
                let message = e.to_string();
                results.push(BulkWorkItemResult {
                    id,
                    error: Some(message.clone()),
                });
                for skipped in ids.by_ref() {
                    results.push(BulkWorkItemResult {
                        id: skipped,
                        error: Some(message.clone()),
                    });
                }
                break;
            }
            let mut tags = current_tags.remove(&id).unwrap_or_default();
            tags.retain(|tag| !remove_lower.contains(&tag.to_lowercase()));
            for tag in &add {
                if !tags
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(tag))
                {
                    tags.push(tag.clone());
                }
            }
            let value = Value::from(tags.join("; "));
            match client
                .update_work_item_fields(&project.id, id, &[("System.Tags".to_string(), value)])
                .await
            {
                Ok(wi) => {
                    updated.push(work_item_to_cached(
                        &organization,
                        &project.id,
                        &project.name,
                        &wi,
                    ));
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
        self.apply_bulk_cache_updates(&updated, &organization, "set_items_tags");
        Ok(results)
    }

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

/// Splits a `System.Tags` field value ("a; b; c") into trimmed, non-empty tags.
fn split_tags(raw: &str) -> Vec<String> {
    raw.split(';')
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect()
}

/// Trims, drops empties, and de-duplicates (case-insensitively) a tag list.
fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_lowercase()) {
            result.push(trimmed.to_string());
        }
    }
    result
}
