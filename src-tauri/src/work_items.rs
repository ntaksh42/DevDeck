use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use azdo_client::{
    AdoClient, AdoError, Identity, IdentityPickerIdentity, WorkItem,
    WorkItemComment as AzdoWorkItemComment, WorkItemRelation, WorkItemUpdate,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, CachedWorkItem, Organization};
use crate::error::{AppError, Result};
use crate::projects::ProjectDirectory;
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
    pub extra_fields: Option<Vec<String>>,
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
    pub custom_fields: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemUpdatesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemMentionsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordMentionInteractionInput {
    pub organization_id: Option<String>,
    pub user_id: Option<String>,
    pub display_name: String,
    pub unique_name: String,
}

/// Same payload as a mention interaction; only the history table differs.
pub type RecordAssigneeInteractionInput = RecordMentionInteractionInput;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemAssigneesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
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
pub struct UpdateWorkItemFieldsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub fields: Vec<WorkItemFieldValueInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldValueInput {
    pub reference_name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemFieldAllowedValuesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_type: String,
    pub field_reference_name: String,
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
pub struct ListWorkItemFieldsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
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
    pub extra_fields: Vec<WorkItemCustomField>,
    /// Tree depth for `FROM WorkItemLinks` query results; `None` for flat queries.
    pub depth: Option<u32>,
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
    pub custom_fields: Vec<WorkItemCustomField>,
    pub web_url: Option<String>,
    pub comments: Vec<WorkItemComment>,
    pub relations: Vec<WorkItemRelationSummary>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRelationSummary {
    pub relation_type: String,
    pub id: i64,
    pub title: Option<String>,
    pub state: Option<String>,
    pub work_item_type: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemUpdateSummary {
    pub id: i64,
    pub revised_by: Option<String>,
    pub revised_date: Option<String>,
    pub changes: Vec<WorkItemFieldChange>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldChange {
    pub reference_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemCustomField {
    pub reference_name: String,
    pub value: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldOption {
    pub name: String,
    pub reference_name: String,
    pub field_type: String,
    pub custom: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentionCandidate {
    pub id: String,
    pub display_name: String,
    pub unique_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemAssigneeCandidate {
    pub id: String,
    pub display_name: String,
    pub unique_name: Option<String>,
    pub assign_value: String,
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

const UPDATE_CANDIDATES_TTL: Duration = Duration::from_secs(60);
const UPDATE_CANDIDATES_CACHE_CAP: usize = 200;

// People recently involved in a work item, derived from its update history.
// Mention and assignee search both need them for every (debounced) keystroke,
// while the underlying updates change rarely — cache them briefly per item.
type UpdateCandidatesCache =
    Arc<Mutex<HashMap<(String, String, i64), (Instant, Vec<WorkItemAssigneeCandidate>)>>>;

#[derive(Debug, Clone)]
pub struct WorkItemService {
    db: AppDatabase,
    secrets: SecretStore,
    projects: ProjectDirectory,
    update_candidates: UpdateCandidatesCache,
}

impl WorkItemService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self {
            db,
            secrets,
            projects: ProjectDirectory::new(),
            update_candidates: UpdateCandidatesCache::default(),
        }
    }

    async fn update_candidates(
        &self,
        client: &AdoClient,
        org_id: &str,
        project_id: &str,
        work_item_id: i64,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        let key = (org_id.to_string(), project_id.to_string(), work_item_id);
        let mut cache = self.update_candidates.lock().await;
        if let Some((fetched_at, candidates)) = cache.get(&key) {
            if fetched_at.elapsed() < UPDATE_CANDIDATES_TTL {
                return Ok(candidates.clone());
            }
        }
        let updates = client
            .list_work_item_updates(project_id, work_item_id, 50)
            .await?;
        let candidates = assignee_candidates_from_updates(updates);
        if cache.len() >= UPDATE_CANDIDATES_CACHE_CAP {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), candidates.clone()));
        Ok(candidates)
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
        let mut projects = self
            .projects
            .list(&client, &organization.id)
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
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let limit = work_item_query_limit(input.limit);
        let (ids, depths) = if is_link_wiql(wiql) {
            let links = client
                .query_work_item_links(&project.id, wiql, Some(limit + 1))
                .await?;
            let (ids, depth_by_id) = flatten_work_item_links(links, limit);
            (ids, Some(depth_by_id))
        } else {
            let ids = client
                .query_work_item_ids(&project.id, wiql, Some(limit))
                .await?
                .into_iter()
                .take(limit)
                .collect::<Vec<_>>();
            (ids, None)
        };
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let extra_fields = sanitize_extra_query_fields(input.extra_fields.as_deref());
        let mut fields = WORK_ITEM_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect::<Vec<_>>();
        fields.extend(extra_fields.iter().cloned());
        let work_items = client
            .get_work_items_batch(&project.id, ids.clone(), fields)
            .await?;

        // Preserve the query's row order (tree order for link queries).
        let mut items_by_id: HashMap<i64, WorkItem> = work_items
            .into_iter()
            .map(|work_item| (work_item.id, work_item))
            .collect();
        Ok(ids
            .into_iter()
            .filter_map(|id| items_by_id.remove(&id))
            .map(|work_item| {
                let extra = extra_work_item_fields(&work_item, &extra_fields);
                let depth = depths
                    .as_ref()
                    .and_then(|depth_by_id| depth_by_id.get(&work_item.id).copied());
                let mut summary =
                    summarize_work_item(&organization, &project.id, &project.name, work_item);
                summary.extra_fields = extra;
                summary.depth = depth;
                summary
            })
            .collect())
    }

    pub async fn count_query(&self, input: RunWorkItemQueryInput) -> Result<usize> {
        let wiql = validate_work_item_wiql(&input.wiql)?;
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let limit = work_item_query_limit(input.limit);
        // Fetch one extra id so the frontend can render "limit+" when results overflow.
        let count = if is_link_wiql(wiql) {
            let links = client
                .query_work_item_links(&input.project_id, wiql, Some(limit + 1))
                .await?;
            flatten_work_item_links(links, limit + 1).0.len()
        } else {
            client
                .query_work_item_ids(&input.project_id, wiql, Some(limit + 1))
                .await?
                .into_iter()
                .take(limit + 1)
                .count()
        };
        Ok(count)
    }

    pub async fn preview(&self, input: GetWorkItemPreviewInput) -> Result<WorkItemPreview> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let fields = preview_fields(input.custom_fields.as_deref())
            .iter()
            .map(ToString::to_string)
            .collect();
        let (work_items_result, comments_result, relations_result) = tokio::join!(
            client.get_work_items_batch(&project.id, vec![input.work_item_id], fields),
            client.list_work_item_comments(
                &project.id,
                input.work_item_id,
                WORK_ITEM_PREVIEW_COMMENT_LIMIT,
            ),
            client.get_work_item_relations(&project.id, input.work_item_id),
        );
        let work_item = work_items_result?.into_iter().next().ok_or_else(|| {
            AppError::InvalidInput(format!("work item not found: {}", input.work_item_id))
        })?;
        let comments = comments_result.unwrap_or_default();
        // Relations are a progressive enhancement; ignore failures.
        let raw_relations = relations_result.unwrap_or_default();

        let mut preview = summarize_work_item_preview(
            &organization,
            &project.id,
            &project.name,
            work_item,
            comments,
        );
        preview.relations = self
            .resolve_preview_relations(
                &client,
                &organization,
                &project.id,
                &project.name,
                raw_relations,
            )
            .await;
        Ok(preview)
    }

    async fn resolve_preview_relations(
        &self,
        client: &AdoClient,
        organization: &Organization,
        project_id: &str,
        fallback_project_name: &str,
        raw_relations: Vec<WorkItemRelation>,
    ) -> Vec<WorkItemRelationSummary> {
        let mut links: Vec<(String, u8, i64)> = raw_relations
            .iter()
            .filter_map(|relation| {
                let id = related_work_item_id(&relation.url)?;
                let (label, rank) = relation_type_label(&relation.rel);
                Some((label, rank, id))
            })
            .take(MAX_PREVIEW_RELATIONS)
            .collect();
        if links.is_empty() {
            return Vec::new();
        }
        links.sort_by_key(|link| (link.1, link.2));

        let ids = links.iter().map(|(_, _, id)| *id).collect::<Vec<_>>();
        let fields = vec![
            "System.Title".to_string(),
            "System.State".to_string(),
            "System.WorkItemType".to_string(),
            "System.TeamProject".to_string(),
        ];
        let related_items = client
            .get_work_items_batch(project_id, ids, fields)
            .await
            .unwrap_or_default();

        links
            .into_iter()
            .map(|(relation_type, _, id)| {
                let item = related_items.iter().find(|item| item.id == id);
                let project_name = item
                    .and_then(|item| string_field(item, "System.TeamProject"))
                    .unwrap_or_else(|| fallback_project_name.to_string());
                WorkItemRelationSummary {
                    relation_type,
                    id,
                    title: item.and_then(|item| string_field(item, "System.Title")),
                    state: item.and_then(|item| string_field(item, "System.State")),
                    work_item_type: item.and_then(|item| string_field(item, "System.WorkItemType")),
                    web_url: Some(format!(
                        "https://dev.azure.com/{}/{}/_workitems/edit/{}",
                        organization.name,
                        encode_path_segment(&project_name),
                        id
                    )),
                }
            })
            .collect()
    }

    pub async fn list_updates(
        &self,
        input: ListWorkItemUpdatesInput,
    ) -> Result<Vec<WorkItemUpdateSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let updates = client
            .list_work_item_updates(&input.project_id, input.work_item_id, 100)
            .await?;
        let mut summaries: Vec<WorkItemUpdateSummary> = updates
            .into_iter()
            .filter_map(summarize_work_item_update)
            .collect();
        summaries.sort_by_key(|summary| std::cmp::Reverse(summary.id));
        Ok(summaries)
    }

    pub fn record_mention_interaction(&self, input: RecordMentionInteractionInput) -> Result<()> {
        let unique_name = input.unique_name.trim();
        let display_name = input.display_name.trim();
        if unique_name.is_empty() || display_name.is_empty() {
            return Ok(());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let now = Utc::now().to_rfc3339();
        self.db.record_mention_interaction(
            &organization.id,
            unique_name,
            display_name,
            input.user_id.as_deref(),
            &now,
        )
    }

    pub fn record_assignee_interaction(&self, input: RecordAssigneeInteractionInput) -> Result<()> {
        let unique_name = input.unique_name.trim();
        let display_name = input.display_name.trim();
        if unique_name.is_empty() || display_name.is_empty() {
            return Ok(());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let now = Utc::now().to_rfc3339();
        self.db.record_assignee_interaction(
            &organization.id,
            unique_name,
            display_name,
            input.user_id.as_deref(),
            &now,
        )
    }

    pub async fn search_mentions(
        &self,
        input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        let query = input.query.trim();
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut candidates = Vec::new();

        match self
            .update_candidates(
                &client,
                &organization.id,
                &input.project_id,
                input.work_item_id,
            )
            .await
        {
            Ok(update_candidates) => {
                for candidate in update_candidates
                    .into_iter()
                    .map(mention_candidate_from_assignee)
                {
                    push_unique_mention_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load work item updates for mention candidates");
            }
        }

        match self.db.list_mention_history(&organization.id, 20) {
            Ok(entries) => {
                for candidate in entries
                    .into_iter()
                    .filter_map(mention_candidate_from_history)
                {
                    push_unique_mention_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load mention history for mention candidates");
            }
        }

        if !query.is_empty() {
            let picker_candidates = match client.search_identity_picker(query, 40).await {
                Ok(identities) => identities
                    .into_iter()
                    .filter_map(mention_candidate_from_identity_picker)
                    .collect::<Vec<_>>(),
                Err(error) => {
                    tracing::warn!(%error, "identity picker search failed; falling back to identities API");
                    client
                        .search_identities(query, 40)
                        .await?
                        .into_iter()
                        .filter_map(summarize_mention_candidate)
                        .collect()
                }
            };
            for candidate in picker_candidates {
                push_unique_mention_candidate(&mut candidates, candidate);
            }
        }

        // The signed-in user goes last instead of being removed: in a
        // single-member organization removing self would leave the picker
        // permanently empty, and mentioning yourself is legitimate.
        let mut results: Vec<MentionCandidate> = candidates
            .into_iter()
            .filter(|c| {
                mention_candidate_matches_query(&c.display_name, c.unique_name.as_deref(), query)
            })
            .collect();
        results.sort_by_key(|c| {
            is_authenticated_user(
                &c.id,
                &c.display_name,
                c.unique_name.as_deref(),
                &organization,
            )
        });
        results.truncate(8);
        Ok(results)
    }

    pub async fn search_assignees(
        &self,
        input: SearchWorkItemAssigneesInput,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        let query = input.query.trim();
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut candidates = Vec::new();

        match self
            .update_candidates(
                &client,
                &organization.id,
                &input.project_id,
                input.work_item_id,
            )
            .await
        {
            Ok(update_candidates) => {
                for candidate in update_candidates {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load work item updates for assignee candidates");
            }
        }

        match self.db.list_assignee_history(&organization.id, 20) {
            Ok(entries) => {
                for candidate in entries.into_iter().map(assignee_candidate_from_history) {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load assignee history for assignee candidates");
            }
        }

        if !query.is_empty() {
            let picker_candidates = match client.search_identity_picker(query, 40).await {
                Ok(identities) => identities
                    .into_iter()
                    .filter_map(assignee_candidate_from_identity_picker)
                    .collect::<Vec<_>>(),
                Err(error) => {
                    tracing::warn!(%error, "identity picker search failed; falling back to identities API");
                    client
                        .search_identities(query, 40)
                        .await?
                        .into_iter()
                        .filter_map(summarize_mention_candidate)
                        .map(assignee_candidate_from_mention)
                        .collect()
                }
            };
            for candidate in picker_candidates {
                push_unique_assignee_candidate(&mut candidates, candidate);
            }
        }

        // Keep self in the list (last) so assigning to yourself stays
        // possible; see search_mentions for the rationale.
        let mut results: Vec<WorkItemAssigneeCandidate> = candidates
            .into_iter()
            .filter(|candidate| candidate.unique_name.is_some())
            .filter(|candidate| assignee_candidate_matches_query(candidate, query))
            .collect();
        results.sort_by_key(|c| {
            is_authenticated_user(
                &c.id,
                &c.display_name,
                c.unique_name.as_deref(),
                &organization,
            )
        });
        results.truncate(8);
        Ok(results)
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
        if let Err(e) = self.db.update_my_work_item_if_present(&cached) {
            tracing::warn!(error = %e, "failed to update my_work_items cache after update_fields");
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

    pub async fn list_field_allowed_values(
        &self,
        input: ListWorkItemFieldAllowedValuesInput,
    ) -> Result<Vec<String>> {
        let field = validate_editable_field_reference_name(&input.field_reference_name)?;
        let work_item_type = input.work_item_type.trim();
        if work_item_type.is_empty() {
            return Err(AppError::InvalidInput(
                "work item type is required".to_string(),
            ));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        Ok(client
            .list_work_item_type_field_allowed_values(&input.project_id, work_item_type, field)
            .await?)
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

    pub async fn list_fields(
        &self,
        input: ListWorkItemFieldsInput,
    ) -> Result<Vec<WorkItemFieldOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut fields = client
            .list_work_item_fields(&input.project_id)
            .await?
            .into_iter()
            .filter(|field| is_valid_field_reference_name(&field.reference_name))
            .map(|field| WorkItemFieldOption {
                custom: field.reference_name.starts_with("Custom."),
                name: field.name,
                reference_name: field.reference_name,
                field_type: field.field_type,
            })
            .collect::<Vec<_>>();
        fields.sort_by(|left, right| {
            right
                .custom
                .cmp(&left.custom)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(fields)
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
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let mut results = Vec::new();
        for id in input.work_item_ids {
            match client.update_work_item_state(&project.id, id, &state).await {
                Ok(wi) => {
                    let cached =
                        work_item_to_cached(&organization, &project.id, &project.name, &wi);
                    if let Err(e) = self.db.upsert_work_items(std::slice::from_ref(&cached)) {
                        tracing::warn!(error = %e, "failed to update work item cache after set_items_state");
                    }
                    if let Err(e) = self.db.update_my_work_item_if_present(&cached) {
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
        for id in input.work_item_ids {
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
                    if let Err(e) = self.db.update_my_work_item_if_present(&cached) {
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
        for id in input.work_item_ids {
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
                    if let Err(e) = self.db.update_my_work_item_if_present(&cached) {
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

fn mention_candidate_from_identity_picker(
    identity: IdentityPickerIdentity,
) -> Option<MentionCandidate> {
    if identity.active == Some(false) {
        return None;
    }
    if identity
        .entity_type
        .as_deref()
        .is_some_and(|value| !value.eq_ignore_ascii_case("User"))
    {
        return None;
    }
    let display_name = identity
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = identity
        .mail_address
        .or(identity.sign_in_address)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    // Markdown mentions are only resolved by Azure DevOps when the token is
    // the identity's storage-key GUID (localId); descriptors like "aad.xxx"
    // are silently dropped from the posted comment. Prefer GUID-shaped ids.
    let id = identity
        .local_id
        .or(identity.entity_id)
        .or(identity.origin_id)
        .or(identity.subject_descriptor)
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(MentionCandidate {
        id,
        display_name,
        unique_name,
    })
}

fn assignee_candidate_from_identity_picker(
    identity: IdentityPickerIdentity,
) -> Option<WorkItemAssigneeCandidate> {
    mention_candidate_from_identity_picker(identity).map(assignee_candidate_from_mention)
}

fn assignee_candidates_from_updates(
    updates: Vec<WorkItemUpdate>,
) -> Vec<WorkItemAssigneeCandidate> {
    let mut candidates = Vec::new();
    for update in updates.into_iter().rev() {
        if let Some(identity) = update.revised_by {
            if let Some(candidate) = assignee_candidate_from_comment_identity(identity) {
                push_unique_assignee_candidate(&mut candidates, candidate);
            }
        }
        if let Some(field) = update.fields.get("System.AssignedTo") {
            for value in [&field.new_value, &field.old_value].into_iter().flatten() {
                if let Some(candidate) = assignee_candidate_from_value(value) {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
        }
    }
    candidates
}

fn assignee_candidate_from_comment_identity(
    identity: azdo_client::work_items::CommentIdentityRef,
) -> Option<WorkItemAssigneeCandidate> {
    let display_name = identity
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = identity
        .unique_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    let id = identity
        .id
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(assignee_candidate_from_parts(id, display_name, unique_name))
}

fn assignee_candidate_from_value(value: &Value) -> Option<WorkItemAssigneeCandidate> {
    if let Some(value) = value.as_str() {
        return assignee_candidate_from_identity_string(value);
    }
    let display_name = value
        .get("displayName")
        .or_else(|| value.get("DisplayName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = value
        .get("uniqueName")
        .or_else(|| value.get("UniqueName"))
        .or_else(|| value.get("mailAddress"))
        .or_else(|| value.get("Mail"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    let id = value
        .get("id")
        .or_else(|| value.get("Id"))
        .or_else(|| value.get("descriptor"))
        .or_else(|| value.get("subjectDescriptor"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(assignee_candidate_from_parts(id, display_name, unique_name))
}

fn assignee_candidate_from_identity_string(value: &str) -> Option<WorkItemAssigneeCandidate> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let (display_name, unique_name) = if let Some((display_name, rest)) = value.rsplit_once('<') {
        let unique_name = rest.strip_suffix('>').map(str::trim);
        (
            display_name.trim().to_string(),
            unique_name
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        )
    } else {
        (value.to_string(), None)
    };
    if display_name.is_empty() {
        return None;
    }
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    Some(assignee_candidate_from_parts(
        unique_name.clone().unwrap_or_else(|| display_name.clone()),
        display_name,
        unique_name,
    ))
}

fn assignee_candidate_from_mention(candidate: MentionCandidate) -> WorkItemAssigneeCandidate {
    assignee_candidate_from_parts(candidate.id, candidate.display_name, candidate.unique_name)
}

fn mention_candidate_from_assignee(candidate: WorkItemAssigneeCandidate) -> MentionCandidate {
    MentionCandidate {
        id: candidate.id,
        display_name: candidate.display_name,
        unique_name: candidate.unique_name,
    }
}

// Unlike mentions, assignment works with "Display <unique_name>" values, so
// entries without a storage-key GUID are still usable.
fn assignee_candidate_from_history(
    entry: crate::db::MentionHistoryEntry,
) -> WorkItemAssigneeCandidate {
    let id = entry.user_id.unwrap_or_else(|| entry.unique_name.clone());
    assignee_candidate_from_parts(id, entry.display_name, Some(entry.unique_name))
}

fn mention_candidate_from_history(
    entry: crate::db::MentionHistoryEntry,
) -> Option<MentionCandidate> {
    // Only entries with a storage-key GUID produce working @<id> mentions;
    // legacy rows recorded with descriptors or e-mails must not shadow
    // identity-picker results that carry a usable id.
    let id = entry.user_id.filter(|id| is_mention_resolvable_id(id))?;
    Some(MentionCandidate {
        id,
        display_name: entry.display_name,
        unique_name: Some(entry.unique_name),
    })
}

/// Azure DevOps resolves markdown mentions only for storage-key GUIDs.
fn is_mention_resolvable_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn is_authenticated_user(
    id: &str,
    display_name: &str,
    unique_name: Option<&str>,
    organization: &Organization,
) -> bool {
    let uid = organization.authenticated_user_id.as_deref().unwrap_or("");
    let self_unique = organization
        .authenticated_user_unique_name
        .as_deref()
        .unwrap_or("");
    let dn = organization
        .authenticated_user_display_name
        .as_deref()
        .unwrap_or("");
    if !uid.is_empty()
        && (id.eq_ignore_ascii_case(uid)
            || unique_name.is_some_and(|un| un.eq_ignore_ascii_case(uid)))
    {
        return true;
    }
    if !self_unique.is_empty() && unique_name.is_some_and(|un| un.eq_ignore_ascii_case(self_unique))
    {
        return true;
    }
    if !dn.is_empty() && display_name.eq_ignore_ascii_case(dn) {
        // Same display name, but a unique name that provably belongs to
        // someone else: do not treat a namesake as the authenticated user.
        let provably_different = !self_unique.is_empty()
            && unique_name.is_some_and(|un| !un.eq_ignore_ascii_case(self_unique));
        return !provably_different;
    }
    false
}

fn assignee_candidate_from_parts(
    id: String,
    display_name: String,
    unique_name: Option<String>,
) -> WorkItemAssigneeCandidate {
    let assign_value = unique_name
        .as_deref()
        .map(|unique_name| format!("{display_name} <{unique_name}>"))
        .unwrap_or_else(|| display_name.clone());
    WorkItemAssigneeCandidate {
        id,
        display_name,
        unique_name,
        assign_value,
    }
}

fn assignee_candidate_matches_query(candidate: &WorkItemAssigneeCandidate, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    candidate.display_name.to_lowercase().contains(&query)
        || candidate
            .unique_name
            .as_deref()
            .is_some_and(|value| value.to_lowercase().contains(&query))
}

fn push_unique_assignee_candidate(
    candidates: &mut Vec<WorkItemAssigneeCandidate>,
    candidate: WorkItemAssigneeCandidate,
) {
    let duplicate = candidates.iter().any(|existing| {
        existing.id.eq_ignore_ascii_case(&candidate.id)
            || same_optional_mention_value(
                existing.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || existing
                .assign_value
                .eq_ignore_ascii_case(&candidate.assign_value)
    });
    if !duplicate {
        candidates.push(candidate);
    }
}

fn is_user_like_identity(identity: &Identity) -> bool {
    let schema = identity.property_value("SchemaClassName");
    let special_type = identity.property_value("SpecialType");
    let meta_type = identity.property_value("MetaType");
    let active = identity.property_value("Active");
    let domain = identity.property_value("Domain");
    let account = identity.property_value("Account");
    let has_mail_or_account = identity.property_value("Mail").is_some()
        || account.is_some()
        || identity
            .unique_name
            .as_deref()
            .is_some_and(|value| value.contains('@'));

    if is_azure_devops_service_identity(identity, domain, account) {
        return false;
    }
    if active.is_some_and(|value| value.eq_ignore_ascii_case("false")) {
        return false;
    }
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

fn is_azure_devops_service_identity(
    identity: &Identity,
    domain: Option<&str>,
    account: Option<&str>,
) -> bool {
    let service_domain = domain.is_some_and(|value| {
        value.eq_ignore_ascii_case("Build") || value.eq_ignore_ascii_case("AgentPool")
    });
    let service_account = account.is_some_and(|value| {
        let value = value.to_lowercase();
        value.starts_with("build\\")
            || value.starts_with("agentpool\\")
            || value == "project collection build service"
    });
    let service_display = [
        identity.provider_display_name.as_deref(),
        identity.custom_display_name.as_deref(),
        identity.display_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| is_azure_devops_service_identity_name(value, None));

    service_domain || service_account || service_display
}

fn is_azure_devops_service_identity_name(display_name: &str, unique_name: Option<&str>) -> bool {
    let display_name = display_name.to_lowercase();
    display_name.contains(" build service (")
        || display_name.starts_with("agent pool service")
        || unique_name.is_some_and(|value| {
            let value = value.to_lowercase();
            value.starts_with("build\\")
                || value.starts_with("agentpool\\")
                || value.eq_ignore_ascii_case("Project Collection Build Service")
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
            || (existing
                .display_name
                .eq_ignore_ascii_case(&candidate.display_name)
                && !both_unique_names_differ(
                    existing.unique_name.as_deref(),
                    candidate.unique_name.as_deref(),
                ))
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

/// Returns true only when both sides have a unique_name and they differ — the only
/// case where same display_name candidates are definitively distinct people.
fn both_unique_names_differ(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(l), Some(r)) => !l.eq_ignore_ascii_case(r),
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
        extra_fields: Vec::new(),
        depth: None,
    }
}

const MAX_EXTRA_QUERY_FIELDS: usize = 20;

fn sanitize_extra_query_fields(extra_fields: Option<&[String]>) -> Vec<String> {
    let mut fields: Vec<String> = Vec::new();
    for field in extra_fields.unwrap_or_default() {
        let field = field.trim();
        if !is_valid_field_reference_name(field) {
            continue;
        }
        if WORK_ITEM_FIELDS
            .iter()
            .any(|standard| standard.eq_ignore_ascii_case(field))
            || fields
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(field))
        {
            continue;
        }
        fields.push(field.to_string());
        if fields.len() >= MAX_EXTRA_QUERY_FIELDS {
            break;
        }
    }
    fields
}

fn extra_work_item_fields(
    work_item: &WorkItem,
    extra_fields: &[String],
) -> Vec<WorkItemCustomField> {
    extra_fields
        .iter()
        .map(|reference_name| WorkItemCustomField {
            reference_name: reference_name.clone(),
            value: string_field(work_item, reference_name)
                .or_else(|| identity_field(work_item, reference_name)),
        })
        .collect()
}

/// Bookkeeping fields that change on every revision and add no review value.
const WORK_ITEM_HISTORY_HIDDEN_FIELDS: &[&str] = &[
    "System.Rev",
    "System.AuthorizedDate",
    "System.RevisedDate",
    "System.Watermark",
    "System.AuthorizedAs",
    "System.PersonId",
    "System.ChangedDate",
    "System.ChangedBy",
    "System.CommentCount",
    "System.IterationId",
    "System.AreaId",
    "System.NodeName",
];

fn update_value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        Value::Object(map) => map
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| map.get("uniqueName").and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

fn summarize_work_item_update(update: WorkItemUpdate) -> Option<WorkItemUpdateSummary> {
    let mut changes: Vec<WorkItemFieldChange> = update
        .fields
        .iter()
        .filter(|(reference_name, _)| {
            !WORK_ITEM_HISTORY_HIDDEN_FIELDS
                .iter()
                .any(|hidden| hidden.eq_ignore_ascii_case(reference_name))
        })
        .map(|(reference_name, change)| WorkItemFieldChange {
            reference_name: reference_name.clone(),
            old_value: change.old_value.as_ref().and_then(update_value_string),
            new_value: change.new_value.as_ref().and_then(update_value_string),
        })
        .filter(|change| {
            change.old_value != change.new_value
                && (change.old_value.is_some() || change.new_value.is_some())
        })
        .collect();
    if changes.is_empty() {
        return None;
    }
    changes.sort_by(|a, b| a.reference_name.cmp(&b.reference_name));

    // revisedDate is a 9999-01-01 sentinel on the latest revision; prefer the
    // System.ChangedDate value recorded by the update itself.
    let revised_date = update
        .fields
        .get("System.ChangedDate")
        .and_then(|change| change.new_value.as_ref())
        .and_then(update_value_string)
        .or_else(|| update.revised_date.filter(|date| !date.starts_with("9999")));

    Some(WorkItemUpdateSummary {
        id: update.id,
        revised_by: update
            .revised_by
            .and_then(|identity| identity.display_name.or(identity.unique_name)),
        revised_date,
        changes,
    })
}

fn summarize_work_item_preview(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
    comments: Vec<AzdoWorkItemComment>,
) -> WorkItemPreview {
    let web_url = work_item_web_url(organization, project_name, work_item.id, &work_item);

    let custom_fields = custom_work_item_fields(&work_item);

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
        custom_fields,
        web_url,
        comments: comments
            .into_iter()
            .map(summarize_work_item_comment)
            .collect(),
        relations: Vec::new(),
    }
}

const MAX_PREVIEW_RELATIONS: usize = 50;

/// Maps an Azure DevOps link relation to (display label, sort rank).
fn relation_type_label(rel: &str) -> (String, u8) {
    match rel {
        "System.LinkTypes.Hierarchy-Reverse" => ("Parent".to_string(), 0),
        "System.LinkTypes.Hierarchy-Forward" => ("Child".to_string(), 1),
        "System.LinkTypes.Related" => ("Related".to_string(), 2),
        "System.LinkTypes.Dependency-Forward" => ("Successor".to_string(), 3),
        "System.LinkTypes.Dependency-Reverse" => ("Predecessor".to_string(), 3),
        other => (other.rsplit('.').next().unwrap_or(other).to_string(), 4),
    }
}

fn related_work_item_id(url: &str) -> Option<i64> {
    let lowered = url.to_ascii_lowercase();
    if !lowered.contains("/_apis/wit/workitems/") {
        return None;
    }
    url.rsplit('/').next()?.parse::<i64>().ok()
}

fn preview_fields(custom_fields: Option<&[String]>) -> Vec<String> {
    let mut fields: Vec<String> = WORK_ITEM_PREVIEW_FIELDS
        .iter()
        .map(ToString::to_string)
        .collect();
    if let Some(custom_fields) = custom_fields {
        for field in custom_fields {
            let field = field.trim();
            if !is_valid_field_reference_name(field) {
                continue;
            }
            if fields
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(field))
            {
                continue;
            }
            fields.push(field.to_string());
            if fields.len() >= WORK_ITEM_PREVIEW_FIELDS.len() + 20 {
                break;
            }
        }
    }
    fields
}

fn custom_work_item_fields(work_item: &WorkItem) -> Vec<WorkItemCustomField> {
    let mut fields = work_item
        .fields
        .keys()
        .filter(|field| {
            !WORK_ITEM_PREVIEW_FIELDS
                .iter()
                .any(|standard| standard.eq_ignore_ascii_case(field))
        })
        .filter(|field| is_valid_field_reference_name(field))
        .map(|reference_name| WorkItemCustomField {
            reference_name: reference_name.clone(),
            value: string_field(work_item, reference_name),
        })
        .collect::<Vec<_>>();
    fields.sort_by(|left, right| left.reference_name.cmp(&right.reference_name));
    fields
}

/// Generic field updates are restricted to non-System fields; System.* edits
/// go through the dedicated state/assignee/reason commands.
// The combined update accepts the System fields the staging UI edits plus
// anything `validate_editable_field_reference_name` allows for custom fields.
fn validate_update_field_reference_name(value: &str) -> Result<&str> {
    const ALLOWED_SYSTEM_FIELDS: &[&str] = &[
        "System.State",
        "System.Reason",
        "System.AssignedTo",
        "System.Tags",
    ];
    let field = value.trim();
    if let Some(allowed) = ALLOWED_SYSTEM_FIELDS
        .iter()
        .copied()
        .find(|allowed| allowed.eq_ignore_ascii_case(field))
    {
        return Ok(allowed);
    }
    validate_editable_field_reference_name(field)
}

fn validate_editable_field_reference_name(value: &str) -> Result<&str> {
    let field = value.trim();
    if !is_valid_field_reference_name(field) {
        return Err(AppError::InvalidInput(format!(
            "invalid field reference name: {value}"
        )));
    }
    if field.to_ascii_lowercase().starts_with("system.") {
        return Err(AppError::InvalidInput(
            "System fields cannot be edited as custom fields".to_string(),
        ));
    }
    Ok(field)
}

fn is_valid_field_reference_name(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || !value.contains('.') {
        return false;
    }
    value.split('.').all(|part| {
        let mut chars = part.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
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
        extra_fields: Vec::new(),
        depth: None,
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
const SYNC_WORK_ITEM_BATCH_SIZE: usize = 200;
// Between full syncs, only items whose ChangedDate moved past the last sync
// are fetched. Deletions are reconciled by the next full sync.
const FULL_WI_SYNC_INTERVAL_HOURS: i64 = 24;
// WIQL fails with VS402337 when a query would return more than 20,000 items.
// Cap sync queries well below that; ORDER BY ChangedDate DESC keeps the most
// recently changed items.
const SYNC_WORK_ITEM_QUERY_TOP: usize = 2000;

struct SyncWorkItemsResult {
    warning: Option<String>,
    was_full_sync: bool,
}

fn full_sync_scope(org_id: &str) -> String {
    format!("internal:wi_full_sync:{org_id}")
}

fn wiql_with_changed_date_filter(base: &str, since_date: &str) -> String {
    base.replace(
        " ORDER BY",
        &format!(" AND [System.ChangedDate] >= '{since_date}' ORDER BY"),
    )
}

// Returns the day-precision date for a delta sync, or None when a full sync
// is due (no prior full sync, parse failure, or the interval has elapsed).
fn delta_sync_since(db: &AppDatabase, org: &Organization) -> Option<String> {
    let full_at = db
        .get_sync_state(&full_sync_scope(&org.id))
        .ok()??
        .last_synced_at?;
    let last_at = db
        .get_sync_state(&format!("work_items:{}", org.id))
        .ok()??
        .last_synced_at?;
    let full_time = DateTime::parse_from_rfc3339(&full_at)
        .ok()?
        .with_timezone(&Utc);
    let last_time = DateTime::parse_from_rfc3339(&last_at)
        .ok()?
        .with_timezone(&Utc);
    if Utc::now() - full_time >= chrono::Duration::hours(FULL_WI_SYNC_INTERVAL_HOURS) {
        return None;
    }
    // WIQL date literals are day-precision; back off one extra day for safety.
    Some(
        (last_time - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string(),
    )
}

struct SyncWorkItemFetchResult {
    items: Vec<CachedWorkItem>,
    queried_count: usize,
}

pub async fn sync_work_items_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("work_items:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_work_items(db, client, org).await {
        Ok(result) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(
                &scope,
                &org.id,
                Some(&now),
                0,
                None,
                result.warning.as_deref(),
            )?;
            if result.was_full_sync {
                db.update_sync_state(
                    &full_sync_scope(&org.id),
                    &org.id,
                    Some(&now),
                    0,
                    None,
                    None,
                )?;
            }
            tracing::info!(org = %org.name, full = result.was_full_sync, "work item sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) = db.update_sync_state(
                &scope,
                &org.id,
                None,
                error_count + 1,
                Some(&e.to_string()),
                None,
            ) {
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
) -> Result<SyncWorkItemsResult> {
    let projects = client.list_projects().await?;
    let fields: Vec<String> = WORK_ITEM_FIELDS.iter().map(ToString::to_string).collect();
    let delta_since = delta_sync_since(db, org);
    let all_wiql = match delta_since.as_deref() {
        Some(since) => wiql_with_changed_date_filter(SYNC_WI_WIQL, since),
        None => SYNC_WI_WIQL.to_string(),
    };
    let mut all_cached: Vec<CachedWorkItem> = Vec::new();
    let mut my_cached: Vec<CachedWorkItem> = Vec::new();
    let mut synced_project_ids: Vec<String> = Vec::new();
    let mut skipped_projects: Vec<String> = Vec::new();
    let mut last_skip_error: Option<AppError> = None;
    let mut large_query_count = 0usize;
    let mut largest_query_result = 0usize;

    for project in &projects {
        let (all_result, my_result) = tokio::join!(
            fetch_sync_work_items(
                client,
                org,
                &project.id,
                &project.name,
                &all_wiql,
                fields.clone(),
                "work item",
            ),
            fetch_sync_work_items(
                client,
                org,
                &project.id,
                &project.name,
                SYNC_MY_WI_WIQL,
                fields.clone(),
                "my work item",
            ),
        );

        let project_all = match all_result {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "work item sync failed for project, preserving cached data"
                );
                skipped_projects.push(project.name.clone());
                last_skip_error = Some(e);
                continue;
            }
        };

        let project_my = match my_result {
            Ok(Some(r)) => r,
            // The "my" query 404ing means the project itself is unreachable;
            // skip it entirely so its cached my_work_items rows survive.
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "my work item sync failed for project, preserving cached data"
                );
                skipped_projects.push(project.name.clone());
                last_skip_error = Some(e);
                continue;
            }
        };

        synced_project_ids.push(project.id.clone());

        if project_all.queried_count > SYNC_WORK_ITEM_BATCH_SIZE {
            large_query_count += 1;
            largest_query_result = largest_query_result.max(project_all.queried_count);
        }
        all_cached.extend(project_all.items);
        if project_my.queried_count > SYNC_WORK_ITEM_BATCH_SIZE {
            large_query_count += 1;
            largest_query_result = largest_query_result.max(project_my.queried_count);
        }
        my_cached.extend(project_my.items);
    }

    // If every project failed with a real error (not 404), surface it rather than
    // recording a spurious success with no cache update.
    if synced_project_ids.is_empty() {
        if let Some(e) = last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = synced_project_ids.iter().map(String::as_str).collect();
    let was_full_sync = delta_since.is_none();
    if was_full_sync {
        db.replace_work_items(&org.id, &synced_ids, &all_cached, &my_cached)?;
    } else {
        db.apply_work_items_delta(&org.id, &synced_ids, &all_cached, &my_cached)?;
    }

    let mut warning_parts: Vec<String> = Vec::new();
    if !skipped_projects.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to sync errors: {}.",
            skipped_projects.len(),
            skipped_projects.join(", ")
        ));
    }
    if large_query_count > 0 {
        warning_parts.push(format!(
            "Work item sync fetched more than {SYNC_WORK_ITEM_BATCH_SIZE} IDs in {large_query_count} query result(s); largest result had {largest_query_result} IDs and was loaded in batches."
        ));
    }
    let warning = if warning_parts.is_empty() {
        None
    } else {
        Some(warning_parts.join(" "))
    };

    Ok(SyncWorkItemsResult {
        warning,
        was_full_sync,
    })
}

async fn fetch_sync_work_items(
    client: &AdoClient,
    org: &Organization,
    project_id: &str,
    project_name: &str,
    wiql: &str,
    fields: Vec<String>,
    label: &str,
) -> Result<Option<SyncWorkItemFetchResult>> {
    let ids = match client
        .query_work_item_ids(project_id, wiql, Some(SYNC_WORK_ITEM_QUERY_TOP))
        .await
    {
        Ok(ids) => ids,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "{} query returned 404, skipping project",
                label
            );
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    };
    let queried_count = ids.len();
    if ids.is_empty() {
        return Ok(Some(SyncWorkItemFetchResult {
            items: Vec::new(),
            queried_count,
        }));
    }

    let mut work_items = Vec::new();
    for chunk in ids.chunks(SYNC_WORK_ITEM_BATCH_SIZE) {
        let chunk_work_items = match client
            .get_work_items_batch(project_id, chunk.to_vec(), fields.clone())
            .await
        {
            Ok(work_items) => work_items,
            Err(e) if is_ado_not_found(&e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project_name,
                    error = %e,
                    "{} batch returned 404, skipping project",
                    label
                );
                return Ok(None);
            }
            Err(e) => return Err(e.into()),
        };
        work_items.extend(chunk_work_items);
    }

    Ok(Some(SyncWorkItemFetchResult {
        items: work_items
            .into_iter()
            .map(|wi| work_item_to_cached(org, project_id, project_name, &wi))
            .collect(),
        queried_count,
    }))
}

fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}

fn validate_work_item_wiql(wiql: &str) -> Result<&str> {
    let wiql = wiql.trim();
    if wiql.is_empty() {
        return Err(AppError::InvalidInput("WIQL query is required".to_string()));
    }
    if !wiql_queries_source(wiql, "workitems") && !is_link_wiql(wiql) {
        return Err(AppError::InvalidInput(
            "WIQL must query FROM WorkItems or FROM WorkItemLinks".to_string(),
        ));
    }
    Ok(wiql)
}

fn wiql_queries_source(wiql: &str, source: &str) -> bool {
    let normalized = wiql.to_ascii_lowercase();
    let words: Vec<&str> = normalized.split_whitespace().collect();
    words
        .windows(2)
        .any(|pair| pair[0] == "from" && pair[1] == source)
}

fn is_link_wiql(wiql: &str) -> bool {
    wiql_queries_source(wiql, "workitemlinks")
}

fn work_item_query_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(200).clamp(1, 500)
}

/// Flattens `FROM WorkItemLinks` edges into a deduplicated id list in tree
/// order plus the depth of each id (roots have depth 0).
fn flatten_work_item_links(
    links: Vec<azdo_client::WorkItemLink>,
    limit: usize,
) -> (Vec<i64>, HashMap<i64, u32>) {
    let mut ids: Vec<i64> = Vec::new();
    let mut depth_by_id: HashMap<i64, u32> = HashMap::new();
    for link in links {
        if depth_by_id.contains_key(&link.target_id) {
            continue;
        }
        let depth = link
            .source_id
            .and_then(|source_id| depth_by_id.get(&source_id).copied())
            .map(|parent_depth| parent_depth + 1)
            .unwrap_or(0);
        depth_by_id.insert(link.target_id, depth);
        ids.push(link.target_id);
        if ids.len() >= limit {
            break;
        }
    }
    (ids, depth_by_id)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use url::Url;
    use wiremock::matchers::{body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::db::OrganizationDraft;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn update_candidates_are_cached_per_work_item() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p1/_apis/wit/workItems/42/updates"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "revisedBy": {
                        "id": "alice-id",
                        "displayName": "Alice",
                        "uniqueName": "alice@corp.com"
                    },
                    "fields": {}
                }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let service = WorkItemService::new(db, SecretStore);
        let client = test_client(&server).await;

        let first = service
            .update_candidates(&client, "contoso", "p1", 42)
            .await
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].display_name, "Alice");

        // Second lookup within the TTL is served from cache (expect(1) above).
        let second = service
            .update_candidates(&client, "contoso", "p1", 42)
            .await
            .unwrap();
        assert_eq!(first, second);
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
            authenticated_user_unique_name: None,
        }
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
            authenticated_user_unique_name: None,
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
            authenticated_user_unique_name: None,
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
            authenticated_user_unique_name: None,
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
    fn mention_candidate_from_identity_picker_prefers_local_id_guid() {
        let candidate = mention_candidate_from_identity_picker(IdentityPickerIdentity {
            entity_id: Some("entity-1".to_string()),
            origin_id: Some("origin-1".to_string()),
            local_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
            subject_descriptor: Some("aad.subject-1".to_string()),
            display_name: Some("naoto akashi".to_string()),
            mail_address: Some("aksh0402@outlook.jp".to_string()),
            sign_in_address: None,
            entity_type: Some("User".to_string()),
            active: Some(true),
        })
        .unwrap();

        // The id is embedded into @<id> markdown mentions; only the
        // storage-key GUID (localId) is resolved by Azure DevOps.
        assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
        assert_eq!(candidate.display_name, "naoto akashi");
        assert_eq!(
            candidate.unique_name.as_deref(),
            Some("aksh0402@outlook.jp")
        );
    }

    #[test]
    fn mention_candidate_from_identity_picker_falls_back_to_descriptor() {
        let candidate = mention_candidate_from_identity_picker(IdentityPickerIdentity {
            entity_id: None,
            origin_id: None,
            local_id: None,
            subject_descriptor: Some("aad.subject-1".to_string()),
            display_name: Some("naoto akashi".to_string()),
            mail_address: None,
            sign_in_address: None,
            entity_type: Some("User".to_string()),
            active: Some(true),
        })
        .unwrap();

        assert_eq!(candidate.id, "aad.subject-1");
    }

    #[test]
    fn mention_candidate_from_history_requires_guid_user_id() {
        let guid_entry = crate::db::MentionHistoryEntry {
            unique_name: "alice@corp.com".to_string(),
            display_name: "Alice".to_string(),
            user_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
        };
        let candidate = mention_candidate_from_history(guid_entry).unwrap();
        assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
        assert_eq!(candidate.unique_name.as_deref(), Some("alice@corp.com"));

        // Descriptor or missing ids would post @<id> tokens that Azure DevOps
        // silently drops; such history rows must be skipped.
        let descriptor_entry = crate::db::MentionHistoryEntry {
            unique_name: "bob@corp.com".to_string(),
            display_name: "Bob".to_string(),
            user_id: Some("aad.subject-2".to_string()),
        };
        assert!(mention_candidate_from_history(descriptor_entry).is_none());

        let missing_entry = crate::db::MentionHistoryEntry {
            unique_name: "carol@corp.com".to_string(),
            display_name: "Carol".to_string(),
            user_id: None,
        };
        assert!(mention_candidate_from_history(missing_entry).is_none());
    }

    #[test]
    fn assignee_candidate_from_history_works_without_guid_user_id() {
        let entry = crate::db::MentionHistoryEntry {
            unique_name: "alice@corp.com".to_string(),
            display_name: "Alice".to_string(),
            user_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
        };
        let candidate = assignee_candidate_from_history(entry);
        assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
        assert_eq!(candidate.unique_name.as_deref(), Some("alice@corp.com"));
        assert_eq!(candidate.assign_value, "Alice <alice@corp.com>");

        // Assignment posts "Display <unique>" instead of @<id> tokens, so a
        // history row without a GUID id is still usable.
        let missing_entry = crate::db::MentionHistoryEntry {
            unique_name: "carol@corp.com".to_string(),
            display_name: "Carol".to_string(),
            user_id: None,
        };
        let candidate = assignee_candidate_from_history(missing_entry);
        assert_eq!(candidate.id, "carol@corp.com");
        assert_eq!(candidate.assign_value, "Carol <carol@corp.com>");
    }

    #[test]
    fn assignee_candidates_from_updates_skip_service_identity_history() {
        let mut fields = HashMap::new();
        fields.insert(
            "System.AssignedTo".to_string(),
            azdo_client::work_items::WorkItemFieldUpdate {
                old_value: Some(json!({
                    "displayName": "Agent Pool Service (1)",
                    "id": "0e8fc31f-c0d7-4b14-b430-76dfb6cf7b0f",
                    "uniqueName": "AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c"
                })),
                new_value: Some(json!({
                    "displayName": "naoto akashi",
                    "id": "eb38825c-2181-6ba9-85c2-3d28e9e68978",
                    "uniqueName": "aksh0402@outlook.jp"
                })),
            },
        );

        let candidates = assignee_candidates_from_updates(vec![WorkItemUpdate {
            id: 1,
            revised_by: Some(azdo_client::work_items::CommentIdentityRef {
                id: Some("0e8fc31f-c0d7-4b14-b430-76dfb6cf7b0f".to_string()),
                display_name: Some("Agent Pool Service (1)".to_string()),
                unique_name: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
            }),
            revised_date: None,
            fields,
        }]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].display_name, "naoto akashi");
        assert_eq!(
            candidates[0].unique_name.as_deref(),
            Some("aksh0402@outlook.jp")
        );
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
    fn summarize_mention_candidate_skips_inactive_identity() {
        let mut properties = HashMap::new();
        properties.insert(
            "Active".to_string(),
            azdo_client::identity::IdentityProperty {
                value: Some("false".to_string()),
            },
        );

        let candidate = summarize_mention_candidate(Identity {
            id: Some("inactive-user".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Inactive User".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: Some("inactive@example.com".to_string()),
            properties: Some(properties),
        });

        assert!(candidate.is_none());
    }

    #[test]
    fn summarize_mention_candidate_skips_azure_devops_service_identity() {
        let mut properties = HashMap::new();
        properties.insert(
            "Domain".to_string(),
            azdo_client::identity::IdentityProperty {
                value: Some("AgentPool".to_string()),
            },
        );
        properties.insert(
            "Account".to_string(),
            azdo_client::identity::IdentityProperty {
                value: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
            },
        );

        let candidate = summarize_mention_candidate(Identity {
            id: Some("agent-pool-service".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Agent Pool Service (1)".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
            properties: Some(properties),
        });

        assert!(candidate.is_none());
    }

    fn test_org(
        authenticated_user_id: Option<&str>,
        authenticated_user_display_name: Option<&str>,
    ) -> Organization {
        test_org_with_unique_name(authenticated_user_id, authenticated_user_display_name, None)
    }

    fn test_org_with_unique_name(
        authenticated_user_id: Option<&str>,
        authenticated_user_display_name: Option<&str>,
        authenticated_user_unique_name: Option<&str>,
    ) -> Organization {
        Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: authenticated_user_id.map(ToString::to_string),
            authenticated_user_display_name: authenticated_user_display_name
                .map(ToString::to_string),
            authenticated_user_unique_name: authenticated_user_unique_name.map(ToString::to_string),
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn is_authenticated_user_matches_by_id() {
        let org = test_org(Some("user-1"), Some("naoto akashi"));
        assert!(is_authenticated_user("user-1", "someone else", None, &org));
        assert!(is_authenticated_user("USER-1", "someone else", None, &org));
    }

    #[test]
    fn is_authenticated_user_matches_by_display_name() {
        let org = test_org(Some("user-1"), Some("naoto akashi"));
        assert!(is_authenticated_user(
            "descriptor-xyz",
            "naoto akashi",
            None,
            &org
        ));
        assert!(is_authenticated_user(
            "descriptor-xyz",
            "Naoto Akashi",
            None,
            &org
        ));
    }

    #[test]
    fn is_authenticated_user_matches_by_unique_name() {
        let org = test_org(Some("user-1"), Some("naoto akashi"));
        assert!(is_authenticated_user(
            "descriptor-xyz",
            "someone else",
            Some("user-1"),
            &org
        ));
    }

    #[test]
    fn is_authenticated_user_does_not_match_different_person() {
        let org = test_org(Some("user-1"), Some("naoto akashi"));
        assert!(!is_authenticated_user(
            "user-2",
            "other person",
            Some("other@example.com"),
            &org
        ));
    }

    #[test]
    fn is_authenticated_user_no_stored_user_never_matches() {
        let org = test_org(None, None);
        assert!(!is_authenticated_user("user-1", "naoto akashi", None, &org));
    }

    #[test]
    fn is_authenticated_user_matches_by_stored_unique_name() {
        let org = test_org_with_unique_name(
            Some("user-1"),
            Some("naoto akashi"),
            Some("naoto@example.com"),
        );
        assert!(is_authenticated_user(
            "descriptor-xyz",
            "someone else",
            Some("Naoto@Example.com"),
            &org
        ));
    }

    #[test]
    fn is_authenticated_user_keeps_namesake_with_different_unique_name() {
        let org = test_org_with_unique_name(
            Some("user-1"),
            Some("naoto akashi"),
            Some("naoto@example.com"),
        );
        // Same display name but a different e-mail: this is another person.
        assert!(!is_authenticated_user(
            "descriptor-other",
            "naoto akashi",
            Some("other.naoto@example.com"),
            &org
        ));
        // Without a unique name we cannot prove it's someone else; keep filtering.
        assert!(is_authenticated_user(
            "descriptor-other",
            "naoto akashi",
            None,
            &org
        ));
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

    #[test]
    fn wiql_with_changed_date_filter_inserts_condition_before_order_by() {
        let filtered = wiql_with_changed_date_filter(SYNC_WI_WIQL, "2026-06-10");
        assert_eq!(
            filtered,
            "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
             AND [System.ChangedDate] >= '2026-06-10' ORDER BY [System.ChangedDate] DESC"
        );
    }

    #[tokio::test]
    async fn sync_work_items_delta_preserves_items_missing_from_window() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "id": "project-ok", "name": "Platform" }]
            })))
            .mount(&server)
            .await;
        // The "all items" query must carry the ChangedDate delta filter; the
        // "my items" query stays unfiltered. Without the filter no mock
        // matches and the sync fails.
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/wiql"))
            .and(body_string_contains("[System.ChangedDate] >="))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "workItems": [{ "id": 10 }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/wiql"))
            .and(body_string_contains("@Me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "workItems": []
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/workitemsbatch"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "id": 10,
                    "fields": {
                        "System.Title": "Fresh change",
                        "System.WorkItemType": "Task",
                        "System.State": "Active",
                        "System.ChangedDate": "2026-06-11T00:00:00Z"
                    }
                }]
            })))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db.upsert_organization(make_org_draft()).unwrap();

        // Cached item outside the delta window: a full sync would delete it.
        db.upsert_work_items(&[CachedWorkItem {
            org_id: org.id.clone(),
            project_id: "project-ok".to_string(),
            project_name: "Platform".to_string(),
            id: 99,
            title: "Old but alive".to_string(),
            work_item_type: Some("Task".to_string()),
            state: Some("Active".to_string()),
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: Some("2026-01-01T00:00:00Z".to_string()),
            web_url: None,
        }])
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db.update_sync_state(
            &format!("work_items:{}", org.id),
            &org.id,
            Some(&now),
            0,
            None,
            None,
        )
        .unwrap();
        db.update_sync_state(
            &full_sync_scope(&org.id),
            &org.id,
            Some(&now),
            0,
            None,
            None,
        )
        .unwrap();

        let client = test_client(&server).await;
        let result = do_sync_work_items(&db, &client, &org).await.unwrap();
        assert!(!result.was_full_sync);

        let cached = db
            .search_work_items(&org.id, None, None, None, None)
            .unwrap();
        let mut ids: Vec<i64> = cached.iter().map(|item| item.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![10, 99]);
    }

    #[tokio::test]
    async fn sync_work_items_runs_full_sync_when_interval_elapsed() {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db.upsert_organization(make_org_draft()).unwrap();

        let now = Utc::now().to_rfc3339();
        let stale_full = (Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
        db.update_sync_state(
            &format!("work_items:{}", org.id),
            &org.id,
            Some(&now),
            0,
            None,
            None,
        )
        .unwrap();
        db.update_sync_state(
            &full_sync_scope(&org.id),
            &org.id,
            Some(&stale_full),
            0,
            None,
            None,
        )
        .unwrap();

        assert!(delta_sync_since(&db, &org).is_none());
    }

    #[tokio::test]
    async fn sync_work_items_batches_more_than_two_hundred_ids() {
        let server = MockServer::start().await;
        let refs: Vec<_> = (1..=201).map(|id| json!({ "id": id })).collect();

        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "id": "project-ok", "name": "Platform" }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/wiql"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "workItems": refs
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/workitemsbatch"))
            .and(query_param("api-version", "7.1-preview"))
            .and(body_string_contains("\"ids\":[1,2,3"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "id": 1,
                    "fields": {
                        "System.Title": "First batch item",
                        "System.WorkItemType": "Task",
                        "System.State": "Active",
                        "System.ChangedDate": "2026-05-24T00:00:00Z"
                    }
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/project-ok/_apis/wit/workitemsbatch"))
            .and(query_param("api-version", "7.1-preview"))
            .and(body_string_contains("\"ids\":[201]"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "id": 201,
                    "fields": {
                        "System.Title": "Second batch item",
                        "System.WorkItemType": "Task",
                        "System.State": "Active",
                        "System.ChangedDate": "2026-05-23T00:00:00Z"
                    }
                }]
            })))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db.upsert_organization(make_org_draft()).unwrap();
        let client = test_client(&server).await;

        sync_work_items_for_org(&db, &client, &org).await.unwrap();

        let cached = db
            .search_work_items(&org.id, None, None, None, None)
            .unwrap();
        assert_eq!(cached.len(), 2);
        assert!(cached.iter().any(|item| item.id == 1));
        assert!(cached.iter().any(|item| item.id == 201));
        let state = db
            .get_sync_state(&format!("work_items:{}", org.id))
            .unwrap()
            .unwrap();
        assert_eq!(state.error_count, 0);
        assert!(state
            .last_warning
            .as_deref()
            .is_some_and(|warning| warning.contains("more than 200 IDs")));
    }

    #[test]
    fn flatten_work_item_links_computes_depths_in_tree_order() {
        use azdo_client::WorkItemLink;
        let links = vec![
            WorkItemLink {
                source_id: None,
                target_id: 1,
            },
            WorkItemLink {
                source_id: Some(1),
                target_id: 2,
            },
            WorkItemLink {
                source_id: Some(2),
                target_id: 3,
            },
            WorkItemLink {
                source_id: None,
                target_id: 4,
            },
            WorkItemLink {
                source_id: Some(1),
                target_id: 2,
            },
        ];
        let (ids, depths) = flatten_work_item_links(links, 10);
        assert_eq!(ids, vec![1, 2, 3, 4]);
        assert_eq!(depths[&1], 0);
        assert_eq!(depths[&2], 1);
        assert_eq!(depths[&3], 2);
        assert_eq!(depths[&4], 0);
    }

    #[test]
    fn flatten_work_item_links_respects_limit() {
        use azdo_client::WorkItemLink;
        let links = vec![
            WorkItemLink {
                source_id: None,
                target_id: 1,
            },
            WorkItemLink {
                source_id: Some(1),
                target_id: 2,
            },
            WorkItemLink {
                source_id: Some(1),
                target_id: 3,
            },
        ];
        let (ids, _) = flatten_work_item_links(links, 2);
        assert_eq!(ids, vec![1, 2]);
    }

    #[test]
    fn validate_wiql_accepts_flat_and_link_sources() {
        assert!(validate_work_item_wiql("SELECT [System.Id] FROM WorkItems").is_ok());
        assert!(validate_work_item_wiql(
            "SELECT [System.Id] FROM WorkItemLinks WHERE [System.Links.LinkType] = 'Child' MODE (Recursive)"
        )
        .is_ok());
        assert!(validate_work_item_wiql("SELECT [System.Id]\nFROM\nWorkItems").is_ok());
        assert!(validate_work_item_wiql("SELECT [System.Id] FROM Bugs").is_err());
        assert!(validate_work_item_wiql("").is_err());
    }

    #[test]
    fn validate_editable_field_reference_name_rules() {
        assert_eq!(
            validate_editable_field_reference_name(" Custom.ReleaseTrain ").unwrap(),
            "Custom.ReleaseTrain"
        );
        assert_eq!(
            validate_editable_field_reference_name("Microsoft.VSTS.Common.Severity").unwrap(),
            "Microsoft.VSTS.Common.Severity"
        );
        assert!(validate_editable_field_reference_name("System.Title").is_err());
        assert!(validate_editable_field_reference_name("system.state").is_err());
        assert!(validate_editable_field_reference_name("no-dot").is_err());
        assert!(validate_editable_field_reference_name("Custom.bad name").is_err());
    }

    // ---- push_unique_mention_candidate dedup tests ----

    fn mc(id: &str, display_name: &str, unique_name: Option<&str>) -> MentionCandidate {
        MentionCandidate {
            id: id.to_string(),
            display_name: display_name.to_string(),
            unique_name: unique_name.map(|s| s.to_string()),
        }
    }

    #[test]
    fn test_dedup_same_id() {
        let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
        push_unique_mention_candidate(&mut candidates, mc("id-1", "Alice Duplicate", None));
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_dedup_same_unique_name() {
        let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
        push_unique_mention_candidate(
            &mut candidates,
            mc("id-2", "Alice Smith", Some("alice@corp.com")),
        );
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_dedup_same_display_name_no_unique_name() {
        // Can't tell apart two "Alice" candidates with no unique_name — treat as duplicate.
        let mut candidates = vec![mc("id-1", "Alice", None)];
        push_unique_mention_candidate(&mut candidates, mc("id-2", "Alice", None));
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_dedup_same_display_name_one_missing_unique_name() {
        // One side lacks unique_name — can't confirm they're distinct, so treat as duplicate.
        let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
        push_unique_mention_candidate(&mut candidates, mc("id-2", "Alice", None));
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_keep_same_display_name_different_unique_names() {
        // Both sides have distinct unique_names — these are provably different people.
        let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
        push_unique_mention_candidate(
            &mut candidates,
            mc("id-2", "Alice", Some("alice.other@corp.com")),
        );
        assert_eq!(candidates.len(), 2);
    }

    #[test]
    fn test_keep_entirely_different_candidate() {
        let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
        push_unique_mention_candidate(&mut candidates, mc("id-2", "Bob", Some("bob@corp.com")));
        assert_eq!(candidates.len(), 2);
    }
}
