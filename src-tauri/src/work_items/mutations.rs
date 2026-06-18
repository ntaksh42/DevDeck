//! Write operations over the work item IPC surface: adding/deleting comments,
//! patching fields on a single item, and the bulk state/assignee/priority
//! changes. Each keeps the local cache in sync after a successful write, and the
//! bulk operations re-check read-only mode between iterations. When read-only
//! mode stops a run partway, the remaining items are reported as failures rather
//! than being silently dropped, so the frontend can notify the user.

use serde_json::Value;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};
use crate::settings::SettingsService;

use super::{
    summarize_work_item_comment, summarize_work_item_preview, validate_update_field_reference_name,
    work_item_to_cached, AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult,
    DeleteWorkItemCommentInput, SetWorkItemsPriorityInput, SetWorkItemsStateInput,
    UpdateWorkItemFieldsInput, WorkItemComment, WorkItemPreview, WorkItemService,
    WORK_ITEM_PREVIEW_COMMENT_LIMIT,
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
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(std::slice::from_ref(&cached)) {
                        tracing::warn!(error = %e, "failed to update work item cache after set_items_state");
                    }
                    if let Err(e) = self.db.update_my_work_item_if_present(
                        &cached,
                        organization.authenticated_user_unique_name.as_deref(),
                    ) {
                        tracing::warn!(error = %e, "failed to update my_work_items cache after set_items_state");
                    }
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
        Ok(results)
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
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(std::slice::from_ref(&cached)) {
                        tracing::warn!(error = %e, "failed to update work item cache after assign_items");
                    }
                    if let Err(e) = self.db.update_my_work_item_if_present(
                        &cached,
                        organization.authenticated_user_unique_name.as_deref(),
                    ) {
                        tracing::warn!(error = %e, "failed to update my_work_items cache after assign_items");
                    }
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
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
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(std::slice::from_ref(&cached)) {
                        tracing::warn!(error = %e, "failed to update work item cache after set_items_priority");
                    }
                    if let Err(e) = self.db.update_my_work_item_if_present(
                        &cached,
                        organization.authenticated_user_unique_name.as_deref(),
                    ) {
                        tracing::warn!(error = %e, "failed to update my_work_items cache after set_items_priority");
                    }
                    results.push(BulkWorkItemResult { id, error: None });
                }
                Err(e) => results.push(BulkWorkItemResult {
                    id,
                    error: Some(e.to_string()),
                }),
            }
        }
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
