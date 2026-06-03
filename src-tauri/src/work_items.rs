use azdo_client::{
    AdoClient, AdoError, AuthenticatedUser, Identity, WorkItem,
    WorkItemComment as AzdoWorkItemComment,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, CachedWorkItem, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const WORK_ITEM_FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "System.ChangedDate",
];

const WORK_ITEM_PREVIEW_FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "System.CreatedBy",
    "System.CreatedDate",
    "System.ChangedDate",
    "System.AreaPath",
    "System.IterationPath",
    "System.Reason",
    "System.Tags",
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "Microsoft.VSTS.CMMI.Symptom",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "Microsoft.VSTS.Scheduling.RemainingWork",
];

const WORK_ITEM_PREVIEW_COMMENT_LIMIT: u32 = 200;
const WORK_ITEM_IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub state: Option<String>,
    pub work_item_type: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkItemQueryInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub wiql: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemProjectsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyWorkItemsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkItemPreviewInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemMentionsInput {
    pub organization_id: Option<String>,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchWorkItemImageInput {
    pub organization_id: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemImage {
    pub data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWorkItemCommentInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub markdown: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkItemCommentInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub comment_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignWorkItemInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub assigned_to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemStateInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemReasonInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemPriorityInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub priority: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemTypeStatesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSavedQueryInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub query_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryResult {
    pub id: String,
    pub name: String,
    pub wiql: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkWorkItemResult {
    pub id: i64,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemsStateInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_ids: Vec<i64>,
    pub state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignWorkItemsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_ids: Vec<i64>,
    pub assigned_to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemsPriorityInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_ids: Vec<i64>,
    pub priority: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub changed_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemProjectOption {
    pub project_id: String,
    pub project_name: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemPreview {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub created_by: Option<String>,
    pub created_date: Option<String>,
    pub changed_date: Option<String>,
    pub area_path: Option<String>,
    pub iteration_path: Option<String>,
    pub reason: Option<String>,
    pub tags: Option<String>,
    pub priority: Option<String>,
    pub severity: Option<String>,
    pub story_points: Option<String>,
    pub remaining_work: Option<String>,
    pub description_html: Option<String>,
    pub acceptance_criteria_html: Option<String>,
    pub web_url: Option<String>,
    pub comments: Vec<WorkItemComment>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentionCandidate {
    pub id: String,
    pub display_name: String,
    pub unique_name: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemComment {
    pub id: i64,
    pub text: Option<String>,
    pub rendered_text: Option<String>,
    pub created_by: Option<String>,
    pub created_by_id: Option<String>,
    pub created_by_unique_name: Option<String>,
    pub created_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkItemService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl WorkItemService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn search(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let state = normalize_optional_filter(input.state);
        let work_item_type = normalize_optional_filter(input.work_item_type);
        let project_id = normalize_optional_filter(input.project_id);

        let cached = if query.is_empty() {
            self.db.search_work_items(
                &organization.id,
                project_id.as_deref(),
                state.as_deref(),
                work_item_type.as_deref(),
                None,
            )?
        } else {
            let mut results = self.db.search_work_items_fts(&organization.id, &query)?;
            results.retain(|item| {
                project_id.as_deref().is_none_or(|p| item.project_id == p)
                    && state
                        .as_deref()
                        .is_none_or(|s| item.state.as_deref() == Some(s))
                    && work_item_type
                        .as_deref()
                        .is_none_or(|t| item.work_item_type.as_deref() == Some(t))
            });
            results
        };

        Ok(cached.into_iter().map(cached_wi_to_summary).collect())
    }

    pub fn list_my(&self, input: ListMyWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let cached = self.db.list_my_work_items(&organization.id)?;
        Ok(cached.into_iter().map(cached_wi_to_summary).collect())
    }

    pub async fn list_projects(
        &self,
        input: ListWorkItemProjectsInput,
    ) -> Result<Vec<WorkItemProjectOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut projects = client
            .list_projects()
            .await?
            .into_iter()
            .map(|project| WorkItemProjectOption {
                project_id: project.id,
                project_name: project.name,
            })
            .collect::<Vec<_>>();
        projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));
        Ok(projects)
    }

    pub async fn run_query(&self, input: RunWorkItemQueryInput) -> Result<Vec<WorkItemSummary>> {
        let wiql = validate_work_item_wiql(&input.wiql)?;

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|project| project.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let limit = work_item_query_limit(input.limit);
        let ids = client
            .query_work_item_ids(&project.id, wiql)
            .await?
            .into_iter()
            .take(limit)
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let fields = WORK_ITEM_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect();
        let work_items = client
            .get_work_items_batch(&project.id, ids, fields)
            .await?;

        Ok(work_items
            .into_iter()
            .map(|work_item| {
                summarize_work_item(&organization, &project.id, &project.name, work_item)
            })
            .collect())
    }

    pub async fn count_query(&self, input: RunWorkItemQueryInput) -> Result<usize> {
        let wiql = validate_work_item_wiql(&input.wiql)?;
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let limit = work_item_query_limit(input.limit);
        let count = client
            .query_work_item_ids(&input.project_id, wiql)
            .await?
            .into_iter()
            .take(limit)
            .count();
        Ok(count)
    }

    pub async fn preview(&self, input: GetWorkItemPreviewInput) -> Result<WorkItemPreview> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|project| project.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;
        let fields = WORK_ITEM_PREVIEW_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect();
        let (work_items_result, comments_result) = tokio::join!(
            client.get_work_items_batch(&project.id, vec![input.work_item_id], fields),
            client.list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            ),
        );
        let work_item = work_items_result?.into_iter().next().ok_or_else(|| {
            AppError::InvalidInput(format!("work item not found: {}", input.work_item_id))
        })?;
        let comments = comments_result.unwrap_or_default();

        Ok(summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        ))
    }

    pub async fn search_mentions(
        &self,
        input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        let query = input.query.trim();
        let organization = self.resolve_organization(input.organization_id.as_deref())?;

        if query.is_empty() {
            return self.default_mention_candidates(&organization).await;
        }

        let client = client_for_organization(&organization, &self.secrets)?;
        let current_user = if let Some(candidate) =
            organization_authenticated_user_candidate(&organization, query)
        {
            Some(candidate)
        } else {
            client.connection_data().await.ok().and_then(|data| {
                authenticated_user_mention_candidate(data.authenticated_user, query)
            })
        };
        let identities = client.search_identities(query, 8).await?;
        let mut candidates = Vec::new();
        if let Some(candidate) = current_user {
            push_unique_mention_candidate(&mut candidates, candidate);
        }
        for candidate in identities
            .into_iter()
            .filter_map(summarize_mention_candidate)
        {
            push_unique_mention_candidate(&mut candidates, candidate);
            if candidates.len() >= 8 {
                break;
            }
        }
        Ok(candidates)
    }

    async fn default_mention_candidates(
        &self,
        organization: &Organization,
    ) -> Result<Vec<MentionCandidate>> {
        let mut candidates = Vec::new();

        // 認証済みユーザーを先頭に（DBキャッシュ優先、なければ connection_data）
        if let Some(candidate) = organization_authenticated_user_candidate(organization, "") {
            push_unique_mention_candidate(&mut candidates, candidate);
        } else {
            let client = client_for_organization(organization, &self.secrets)?;
            if let Some(candidate) =
                client.connection_data().await.ok().and_then(|data| {
                    authenticated_user_mention_candidate(data.authenticated_user, "")
                })
            {
                push_unique_mention_candidate(&mut candidates, candidate);
            }
        }

        // DBキャッシュから頻度の高いアサイン済みユーザーを補完
        let recent_assignees = self
            .db
            .get_recent_assignees(&organization.id)
            .unwrap_or_default();
        for (display_name, unique_name) in recent_assignees {
            let display_name = display_name.trim().to_string();
            if display_name.is_empty() {
                continue;
            }
            push_unique_mention_candidate(
                &mut candidates,
                MentionCandidate {
                    id: unique_name
                        .as_deref()
                        .unwrap_or(&display_name)
                        .to_string(),
                    display_name,
                    unique_name,
                },
            );
            if candidates.len() >= 8 {
                break;
            }
        }

        Ok(candidates)
    }

    pub async fn fetch_image(&self, input: FetchWorkItemImageInput) -> Result<WorkItemImage> {
        let url = input.url.trim();
        if url.is_empty() {
            return Err(AppError::InvalidInput("image URL is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let response = client.get_attachment_bytes(url).await?;
        if response.bytes.len() > WORK_ITEM_IMAGE_MAX_BYTES {
            return Err(AppError::InvalidInput(
                "image is too large to preview".to_string(),
            ));
        }

        let content_type = response
            .content_type
            .as_deref()
            .and_then(normalize_image_content_type)
            .or_else(|| image_content_type_from_url(url))
            .ok_or_else(|| {
                AppError::InvalidInput("attachment is not a supported preview image".to_string())
            })?;
        let encoded = BASE64_STANDARD.encode(response.bytes);
        Ok(WorkItemImage {
            data_url: format!("data:{content_type};base64,{encoded}"),
        })
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

    pub async fn assign(&self, input: AssignWorkItemInput) -> Result<WorkItemPreview> {
        let assigned_to = input.assigned_to.trim();
        if assigned_to.is_empty() {
            return Err(AppError::InvalidInput("assignee is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|project| project.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let work_item = client
            .update_work_item_assigned_to(&project.id, input.work_item_id, assigned_to)
            .await?;
        let cached = work_item_to_cached(&organization, &project.id, &project.name, &work_item);
        if let Err(e) = self.db.upsert_work_items(&[cached]) {
            tracing::warn!(error = %e, "failed to update work item cache after assign");
        }
        let comments = client
            .list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            )
            .await
            .unwrap_or_default();

        Ok(summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        ))
    }

    pub async fn set_state(&self, input: SetWorkItemStateInput) -> Result<WorkItemPreview> {
        let state = input.state.trim().to_string();
        if state.is_empty() {
            return Err(AppError::InvalidInput("state is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let work_item = client
            .update_work_item_state(&project.id, input.work_item_id, &state)
            .await?;
        let cached = work_item_to_cached(&organization, &project.id, &project.name, &work_item);
        if let Err(e) = self.db.upsert_work_items(&[cached]) {
            tracing::warn!(error = %e, "failed to update work item cache after set_state");
        }
        let comments = client
            .list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            )
            .await
            .unwrap_or_default();

        Ok(summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        ))
    }

    pub async fn set_reason(&self, input: SetWorkItemReasonInput) -> Result<WorkItemPreview> {
        let reason = input.reason.trim().to_string();
        if reason.is_empty() {
            return Err(AppError::InvalidInput("reason is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let work_item = client
            .update_work_item_reason(&project.id, input.work_item_id, &reason)
            .await?;
        let cached = work_item_to_cached(&organization, &project.id, &project.name, &work_item);
        if let Err(e) = self.db.upsert_work_items(&[cached]) {
            tracing::warn!(error = %e, "failed to update work item cache after set_reason");
        }
        let comments = client
            .list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            )
            .await
            .unwrap_or_default();

        Ok(summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        ))
    }

    pub async fn set_priority(&self, input: SetWorkItemPriorityInput) -> Result<WorkItemPreview> {
        if input.priority <= 0 {
            return Err(AppError::InvalidInput(
                "priority must be positive".to_string(),
            ));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let work_item = client
            .update_work_item_priority(&project.id, input.work_item_id, input.priority)
            .await?;
        let cached = work_item_to_cached(&organization, &project.id, &project.name, &work_item);
        if let Err(e) = self.db.upsert_work_items(&[cached]) {
            tracing::warn!(error = %e, "failed to update work item cache after set_priority");
        }
        let comments = client
            .list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            )
            .await
            .unwrap_or_default();

        Ok(summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        ))
    }

    pub async fn list_type_states(
        &self,
        input: ListWorkItemTypeStatesInput,
    ) -> Result<Vec<String>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        Ok(client
            .list_work_item_type_states(&input.project_id, &input.work_item_type)
            .await?)
    }

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
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let mut results = Vec::new();
        for id in input.work_item_ids {
            match client.update_work_item_state(&project.id, id, &state).await {
                Ok(wi) => {
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(&[cached]) {
                        tracing::warn!(error = %e, "failed to update work item cache after set_items_state");
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
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let mut results = Vec::new();
        for id in input.work_item_ids {
            match client
                .update_work_item_assigned_to(&project.id, id, &assigned_to)
                .await
            {
                Ok(wi) => {
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(&[cached]) {
                        tracing::warn!(error = %e, "failed to update work item cache after assign_items");
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
        let project = client
            .list_projects()
            .await?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| {
                AppError::InvalidInput(format!("project not found: {}", input.project_id))
            })?;

        let mut results = Vec::new();
        for id in input.work_item_ids {
            match client
                .update_work_item_priority(&project.id, id, input.priority)
                .await
            {
                Ok(wi) => {
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(&[cached]) {
                        tracing::warn!(error = %e, "failed to update work item cache after set_items_priority");
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

    pub async fn get_saved_query(&self, input: GetSavedQueryInput) -> Result<SavedQueryResult> {
        let query_id = input.query_id.trim().to_string();
        if query_id.is_empty() {
            return Err(AppError::InvalidInput("query ID is required".to_string()));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let query = client.get_saved_query(&input.project_id, &query_id).await?;
        Ok(SavedQueryResult {
            id: query.id,
            name: query.name,
            wiql: query.wiql,
        })
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .db
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }

        self.db
            .list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }
}

fn summarize_mention_candidate(identity: Identity) -> Option<MentionCandidate> {
    if !is_user_like_identity(&identity) {
        return None;
    }
    let id = identity
        .id
        .clone()
        .or_else(|| identity.subject_descriptor.clone())
        .or_else(|| identity.descriptor.clone())?;
    let unique_name = identity
        .unique_name
        .clone()
        .or_else(|| identity.property_value("Mail").map(ToString::to_string))
        .or_else(|| identity.property_value("Account").map(ToString::to_string));
    let display_name = identity
        .provider_display_name
        .or(identity.custom_display_name)
        .or(identity.display_name)
        .or_else(|| unique_name.clone())?;
    Some(MentionCandidate {
        id,
        display_name,
        unique_name,
    })
}

fn is_user_like_identity(identity: &Identity) -> bool {
    let schema = identity.property_value("SchemaClassName");
    let special_type = identity.property_value("SpecialType");
    let meta_type = identity.property_value("MetaType");
    let has_mail_or_account = identity.property_value("Mail").is_some()
        || identity.property_value("Account").is_some()
        || identity
            .unique_name
            .as_deref()
            .is_some_and(|value| value.contains('@'));

    if schema.is_some_and(|value| !value.eq_ignore_ascii_case("User")) {
        return false;
    }
    if special_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }
    if meta_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }

    schema.is_some() || has_mail_or_account || identity.id.is_some()
}

fn authenticated_user_mention_candidate(
    user: AuthenticatedUser,
    query: &str,
) -> Option<MentionCandidate> {
    let id = user
        .id
        .trim()
        .is_empty()
        .then_some(user.descriptor)
        .flatten()
        .unwrap_or(user.id);
    mention_candidate_from_parts(id, user.provider_display_name, None, query)
}

fn organization_authenticated_user_candidate(
    organization: &Organization,
    query: &str,
) -> Option<MentionCandidate> {
    mention_candidate_from_parts(
        organization.authenticated_user_id.clone()?,
        organization.authenticated_user_display_name.clone(),
        None,
        query,
    )
}

fn mention_candidate_from_parts(
    id: String,
    display_name: Option<String>,
    unique_name: Option<String>,
    query: &str,
) -> Option<MentionCandidate> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return None;
    }
    let display_name = display_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.clone());
    let unique_name = unique_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if !mention_candidate_matches_query(&display_name, unique_name.as_deref(), query) {
        return None;
    }
    Some(MentionCandidate {
        id,
        display_name,
        unique_name,
    })
}

fn mention_candidate_matches_query(
    display_name: &str,
    unique_name: Option<&str>,
    query: &str,
) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    display_name.to_lowercase().contains(&query)
        || unique_name
            .map(|value| value.to_lowercase().contains(&query))
            .unwrap_or(false)
}

fn push_unique_mention_candidate(
    candidates: &mut Vec<MentionCandidate>,
    candidate: MentionCandidate,
) {
    let duplicate = candidates.iter().any(|existing| {
        existing.id.eq_ignore_ascii_case(&candidate.id)
            || same_optional_mention_value(
                existing.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || existing
                .display_name
                .eq_ignore_ascii_case(&candidate.display_name)
    });
    if !duplicate {
        candidates.push(candidate);
    }
}

fn same_optional_mention_value(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}

fn summarize_work_item_comment(comment: AzdoWorkItemComment) -> WorkItemComment {
    let (created_by, created_by_id, created_by_unique_name) = comment
        .created_by
        .map(|identity| {
            let created_by = identity
                .display_name
                .clone()
                .or_else(|| identity.unique_name.clone());
            (created_by, identity.id, identity.unique_name)
        })
        .unwrap_or((None, None, None));

    WorkItemComment {
        id: comment.id,
        text: comment.text,
        rendered_text: comment.rendered_text,
        created_by,
        created_by_id,
        created_by_unique_name,
        created_date: comment.created_date,
    }
}

fn normalize_optional_filter(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

fn matches_optional_filter(value: &str, filter: Option<&str>) -> bool {
    filter.is_none_or(|filter| filter == value)
}

fn build_wiql(query: &str, state: Option<&str>, work_item_type: Option<&str>) -> String {
    let mut clauses = Vec::from(["[System.TeamProject] = @project".to_string()]);
    let query = query.trim();
    if !query.is_empty() {
        clauses.push(format!(
            "[System.Title] CONTAINS '{}'",
            escape_wiql_string(query)
        ));
    }
    if let Some(state) = state {
        clauses.push(format!(
            "[System.State] = '{}'",
            escape_wiql_string(state.trim())
        ));
    }
    if let Some(work_item_type) = work_item_type {
        clauses.push(format!(
            "[System.WorkItemType] = '{}'",
            escape_wiql_string(work_item_type.trim())
        ));
    }

    format!(
        "SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY [System.ChangedDate] DESC",
        clauses.join(" AND ")
    )
}

fn escape_wiql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn summarize_work_item(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
) -> WorkItemSummary {
    WorkItemSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: work_item.id,
        title: string_field(&work_item, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(&work_item, "System.WorkItemType"),
        state: string_field(&work_item, "System.State"),
        assigned_to: identity_field(&work_item, "System.AssignedTo"),
        changed_date: string_field(&work_item, "System.ChangedDate"),
        web_url: work_item_web_url(organization, project_name, work_item.id, &work_item),
    }
}

fn summarize_work_item_preview(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
    comments: Vec<AzdoWorkItemComment>,
) -> WorkItemPreview {
    let web_url = work_item_web_url(organization, project_name, work_item.id, &work_item);

    WorkItemPreview {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: work_item.id,
        title: string_field(&work_item, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(&work_item, "System.WorkItemType"),
        state: string_field(&work_item, "System.State"),
        assigned_to: identity_field(&work_item, "System.AssignedTo"),
        created_by: identity_field(&work_item, "System.CreatedBy"),
        created_date: string_field(&work_item, "System.CreatedDate"),
        changed_date: string_field(&work_item, "System.ChangedDate"),
        area_path: string_field(&work_item, "System.AreaPath"),
        iteration_path: string_field(&work_item, "System.IterationPath"),
        reason: string_field(&work_item, "System.Reason"),
        tags: string_field(&work_item, "System.Tags"),
        priority: string_field(&work_item, "Microsoft.VSTS.Common.Priority"),
        severity: string_field(&work_item, "Microsoft.VSTS.Common.Severity"),
        story_points: string_field(&work_item, "Microsoft.VSTS.Scheduling.StoryPoints"),
        remaining_work: string_field(&work_item, "Microsoft.VSTS.Scheduling.RemainingWork"),
        description_html: first_string_field(
            &work_item,
            &[
                "System.Description",
                "Microsoft.VSTS.TCM.ReproSteps",
                "Microsoft.VSTS.CMMI.Symptom",
            ],
        ),
        acceptance_criteria_html: string_field(
            &work_item,
            "Microsoft.VSTS.Common.AcceptanceCriteria",
        ),
        web_url,
        comments: comments
            .into_iter()
            .map(summarize_work_item_comment)
            .collect(),
    }
}

fn work_item_web_url(
    organization: &Organization,
    project_name: &str,
    work_item_id: i64,
    work_item: &WorkItem,
) -> Option<String> {
    work_item
        .links
        .as_ref()
        .and_then(|links| links.html.as_ref().map(|html| html.href.clone()))
        .or_else(|| {
            Some(format!(
                "https://dev.azure.com/{}/{}/_workitems/edit/{}",
                organization.name,
                encode_path_segment(project_name),
                work_item_id
            ))
        })
}

fn string_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        _ => None,
    }
}

fn first_string_field(work_item: &WorkItem, fields: &[&str]) -> Option<String> {
    fields
        .iter()
        .filter_map(|field| string_field(work_item, field))
        .find(|value| !value.trim().is_empty())
}

fn identity_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        Value::Object(map) => map
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| map.get("uniqueName").and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

fn identity_unique_name_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::Object(map) => map
            .get("uniqueName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
}

fn normalize_image_content_type(content_type: &str) -> Option<&'static str> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match media_type.as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/svg+xml" => Some("image/svg+xml"),
        "image/bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn image_content_type_from_url(url: &str) -> Option<&'static str> {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".png") {
        Some("image/png")
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if path.ends_with(".gif") {
        Some("image/gif")
    } else if path.ends_with(".webp") {
        Some("image/webp")
    } else if path.ends_with(".svg") {
        Some("image/svg+xml")
    } else if path.ends_with(".bmp") {
        Some("image/bmp")
    } else {
        None
    }
}

fn encode_path_segment(value: &str) -> String {
    value.replace(' ', "%20")
}

fn cached_wi_to_summary(wi: CachedWorkItem) -> WorkItemSummary {
    WorkItemSummary {
        organization_id: wi.org_id,
        project_id: wi.project_id,
        project_name: wi.project_name,
        id: wi.id,
        title: wi.title,
        work_item_type: wi.work_item_type,
        state: wi.state,
        assigned_to: wi.assigned_to,
        changed_date: wi.changed_date,
        web_url: wi.web_url,
    }
}

fn work_item_to_cached(
    org: &Organization,
    project_id: &str,
    project_name: &str,
    wi: &WorkItem,
) -> CachedWorkItem {
    let web_url = format!(
        "{}/{}/_workitems/edit/{}",
        org.base_url,
        encode_path_segment(project_name),
        wi.id
    );
    CachedWorkItem {
        org_id: org.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: wi.id,
        title: string_field(wi, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(wi, "System.WorkItemType"),
        state: string_field(wi, "System.State"),
        assigned_to: identity_field(wi, "System.AssignedTo"),
        assigned_to_unique_name: identity_unique_name_field(wi, "System.AssignedTo"),
        changed_date: string_field(wi, "System.ChangedDate"),
        web_url: Some(web_url),
    }
}

// ── Cache sync ────────────────────────────────────────────────────────────────

const SYNC_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     ORDER BY [System.ChangedDate] DESC";

const SYNC_MY_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     AND [System.AssignedTo] = @Me \
     ORDER BY [System.ChangedDate] DESC";

pub async fn sync_work_items_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("work_items:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_work_items(db, client, org).await {
        Ok(()) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(&scope, &org.id, Some(&now), 0, None)?;
            tracing::info!(org = %org.name, "work item sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) =
                db.update_sync_state(&scope, &org.id, None, error_count + 1, Some(&e.to_string()))
            {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            Err(e)
        }
    }
}

async fn do_sync_work_items(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let projects = client.list_projects().await?;
    let fields: Vec<String> = WORK_ITEM_FIELDS.iter().map(ToString::to_string).collect();
    let mut all_cached: Vec<CachedWorkItem> = Vec::new();
    let mut my_cached: Vec<CachedWorkItem> = Vec::new();

    for project in &projects {
        let ids = match client.query_work_item_ids(&project.id, SYNC_WI_WIQL).await {
            Ok(ids) => ids,
            Err(e) if is_ado_not_found(&e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "work item query returned 404, skipping project"
                );
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        let ids: Vec<i64> = ids.into_iter().take(200).collect();
        if !ids.is_empty() {
            let work_items = match client
                .get_work_items_batch(&project.id, ids, fields.clone())
                .await
            {
                Ok(work_items) => work_items,
                Err(e) if is_ado_not_found(&e) => {
                    tracing::warn!(
                        org = %org.name,
                        project = %project.name,
                        error = %e,
                        "work item batch returned 404, skipping project"
                    );
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            for wi in work_items {
                all_cached.push(work_item_to_cached(org, &project.id, &project.name, &wi));
            }
        }

        let my_ids = match client
            .query_work_item_ids(&project.id, SYNC_MY_WI_WIQL)
            .await
        {
            Ok(ids) => ids,
            Err(e) if is_ado_not_found(&e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "my work item query returned 404, skipping project"
                );
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        let my_ids: Vec<i64> = my_ids.into_iter().take(200).collect();
        if !my_ids.is_empty() {
            let work_items = match client
                .get_work_items_batch(&project.id, my_ids, fields.clone())
                .await
            {
                Ok(work_items) => work_items,
                Err(e) if is_ado_not_found(&e) => {
                    tracing::warn!(
                        org = %org.name,
                        project = %project.name,
                        error = %e,
                        "my work item batch returned 404, skipping project"
                    );
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            for wi in work_items {
                my_cached.push(work_item_to_cached(org, &project.id, &project.name, &wi));
            }
        }
    }

    db.replace_work_items(&org.id, &all_cached, &my_cached)?;

    Ok(())
}

fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}

fn validate_work_item_wiql(wiql: &str) -> Result<&str> {
    let wiql = wiql.trim();
    if wiql.is_empty() {
        return Err(AppError::InvalidInput("WIQL query is required".to_string()));
    }
    if !wiql.to_ascii_lowercase().contains("from workitems") {
        return Err(AppError::InvalidInput(
            "WIQL must query FROM WorkItems".to_string(),
        ));
    }
    Ok(wiql)
}

fn work_item_query_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(200).clamp(1, 500)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::db::OrganizationDraft;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    fn make_org_draft() -> OrganizationDraft {
        OrganizationDraft {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
        }
    }

    #[test]
    fn matches_optional_filter_allows_none_and_matching_value() {
        assert!(matches_optional_filter("platform", None));
        assert!(matches_optional_filter("platform", Some("platform")));
        assert!(!matches_optional_filter("platform", Some("mobile")));
    }

    #[test]
    fn build_wiql_escapes_filters() {
        let wiql = build_wiql("can't save", Some("Active"), Some("Bug"));

        assert!(wiql.contains("[System.Title] CONTAINS 'can''t save'"));
        assert!(wiql.contains("[System.State] = 'Active'"));
        assert!(wiql.contains("[System.WorkItemType] = 'Bug'"));
    }

    #[test]
    fn summarize_maps_identity_object() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        let mut fields = HashMap::new();
        fields.insert("System.Title".to_string(), json!("Fix save"));
        fields.insert("System.WorkItemType".to_string(), json!("Bug"));
        fields.insert("System.State".to_string(), json!("Active"));
        fields.insert(
            "System.AssignedTo".to_string(),
            json!({ "displayName": "Test User" }),
        );

        let summary = summarize_work_item(
            &organization,
            "project-1",
            "Platform Team",
            WorkItem {
                id: 123,
                fields,
                links: None,
            },
        );

        assert_eq!(summary.title, "Fix save");
        assert_eq!(summary.assigned_to.as_deref(), Some("Test User"));
        assert_eq!(
            summary.web_url.as_deref(),
            Some("https://dev.azure.com/contoso/Platform%20Team/_workitems/edit/123")
        );
    }

    #[test]
    fn summarize_preview_maps_rich_fields() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        let mut fields = HashMap::new();
        fields.insert("System.Title".to_string(), json!("Preview WIT"));
        fields.insert("System.WorkItemType".to_string(), json!("User Story"));
        fields.insert("System.State".to_string(), json!("Active"));
        fields.insert(
            "System.CreatedBy".to_string(),
            json!({ "displayName": "Creator" }),
        );
        fields.insert("System.Description".to_string(), json!("<p>Body</p>"));
        fields.insert("Microsoft.VSTS.Common.Priority".to_string(), json!(2));

        let preview = summarize_work_item_preview(
            &organization,
            "project-1",
            "Platform",
            WorkItem {
                id: 456,
                fields,
                links: None,
            },
            vec![],
        );

        assert_eq!(preview.title, "Preview WIT");
        assert_eq!(preview.created_by.as_deref(), Some("Creator"));
        assert_eq!(preview.description_html.as_deref(), Some("<p>Body</p>"));
        assert_eq!(preview.priority.as_deref(), Some("2"));
    }

    #[test]
    fn summarize_preview_uses_repro_steps_as_description_fallback() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        let mut fields = HashMap::new();
        fields.insert("System.Title".to_string(), json!("Bug preview"));
        fields.insert("System.Description".to_string(), json!(" "));
        fields.insert(
            "Microsoft.VSTS.TCM.ReproSteps".to_string(),
            json!("<div>Steps from bug field</div>"),
        );

        let preview = summarize_work_item_preview(
            &organization,
            "project-1",
            "Platform",
            WorkItem {
                id: 457,
                fields,
                links: None,
            },
            vec![],
        );

        assert_eq!(
            preview.description_html.as_deref(),
            Some("<div>Steps from bug field</div>")
        );
    }

    #[test]
    fn summarize_mention_candidate_prefers_provider_display_name() {
        let mut properties = HashMap::new();
        properties.insert(
            "Mail".to_string(),
            azdo_client::identity::IdentityProperty {
                value: Some("alice@example.com".to_string()),
            },
        );
        let candidate = summarize_mention_candidate(Identity {
            id: Some("user-1".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Alice Johnson".to_string()),
            custom_display_name: None,
            display_name: Some("Alice".to_string()),
            unique_name: None,
            properties: Some(properties),
        })
        .unwrap();

        assert_eq!(candidate.id, "user-1");
        assert_eq!(candidate.display_name, "Alice Johnson");
        assert_eq!(candidate.unique_name.as_deref(), Some("alice@example.com"));
    }

    #[test]
    fn summarize_mention_candidate_accepts_descriptor_without_id() {
        let candidate = summarize_mention_candidate(Identity {
            id: None,
            descriptor: Some("aad.descriptor-1".to_string()),
            subject_descriptor: None,
            provider_display_name: Some("Naoto Akashi".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: Some("naoto@example.com".to_string()),
            properties: None,
        })
        .unwrap();

        assert_eq!(candidate.id, "aad.descriptor-1");
        assert_eq!(candidate.display_name, "Naoto Akashi");
        assert_eq!(candidate.unique_name.as_deref(), Some("naoto@example.com"));
    }

    #[test]
    fn summarize_mention_candidate_skips_group_identity() {
        let mut properties = HashMap::new();
        properties.insert(
            "SchemaClassName".to_string(),
            azdo_client::identity::IdentityProperty {
                value: Some("Group".to_string()),
            },
        );

        let candidate = summarize_mention_candidate(Identity {
            id: Some("group-1".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Project Collection Valid Users".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: None,
            properties: Some(properties),
        });

        assert!(candidate.is_none());
    }

    #[test]
    fn authenticated_user_mention_candidate_matches_display_name() {
        let candidate = authenticated_user_mention_candidate(
            AuthenticatedUser {
                id: "user-1".to_string(),
                provider_display_name: Some("naoto akashi".to_string()),
                descriptor: Some("aad.user-1".to_string()),
            },
            "n",
        )
        .unwrap();

        assert_eq!(candidate.id, "user-1");
        assert_eq!(candidate.display_name, "naoto akashi");
    }

    #[test]
    fn organization_authenticated_user_candidate_matches_saved_user() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: Some("user-1".to_string()),
            authenticated_user_display_name: Some("naoto akashi".to_string()),
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };

        let candidate = organization_authenticated_user_candidate(&organization, "n").unwrap();

        assert_eq!(candidate.id, "user-1");
        assert_eq!(candidate.display_name, "naoto akashi");
    }

    #[tokio::test]
    async fn sync_work_items_skips_not_found_project_and_keeps_other_results() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 2,
                "value": [
                    { "id": "project-ok", "name": "Platform" },
                    { "id": "project-missing", "name": "Archived" }
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/wiql"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "workItems": [{ "id": 10 }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/workitemsbatch"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "id": 10,
                    "fields": {
                        "System.Title": "Keep synced item",
                        "System.WorkItemType": "Task",
                        "System.State": "Active",
                        "System.ChangedDate": "2026-05-24T00:00:00Z"
                    }
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-missing/_apis/wit/wiql"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db.upsert_organization(make_org_draft()).unwrap();
        let client = test_client(&server).await;

        do_sync_work_items(&db, &client, &org).await.unwrap();

        let cached = db
            .search_work_items(&org.id, None, None, None, None)
            .unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].title, "Keep synced item");
        let my_cached = db.list_my_work_items(&org.id).unwrap();
        assert_eq!(my_cached.len(), 1);
        assert_eq!(my_cached[0].title, "Keep synced item");
    }
}
