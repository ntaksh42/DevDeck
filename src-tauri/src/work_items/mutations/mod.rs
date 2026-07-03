//! Write operations over the work item IPC surface: adding/deleting comments,
//! patching fields on a single item, and the bulk state/assignee/priority
//! changes. Each keeps the local cache in sync after a successful write, and the
//! bulk operations re-check read-only mode between iterations. When read-only
//! mode stops a run partway, the remaining items are reported as failures rather
//! than being silently dropped, so the frontend can notify the user.

mod comments;
mod create;

use std::collections::HashMap;

use serde_json::Value;

use crate::auth::client_for_organization;
use crate::db::{CachedWorkItem, Organization};
use crate::error::{AppError, Result};
use crate::settings::SettingsService;

use super::{
    work_item_to_cached, AssignWorkItemsInput, BulkWorkItemResult, SetWorkItemsPriorityInput,
    SetWorkItemsStateInput, SetWorkItemsTagsInput, WorkItemService,
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
