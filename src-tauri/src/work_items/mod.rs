use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use azdo_client::{
    AdoClient, AdoError, WorkItem, WorkItemComment as AzdoWorkItemComment, WorkItemRelation,
    WorkItemUpdate,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, CachedWorkItem, Organization};
use crate::error::{AppError, Result};
use crate::projects::ProjectDirectory;
use crate::secrets::SecretStore;

mod candidates;
pub(crate) mod conversions;
mod metadata;
mod mutations;
mod query;
mod sync;
mod types;
pub(crate) use candidates::*;
use conversions::*;
pub(crate) use query::*;
pub(crate) use sync::*;
pub use types::*;

#[cfg(test)]
mod tests;

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

    pub fn search(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let states = normalize_filter_set(input.states);
        let work_item_types = normalize_filter_set(input.work_item_types);
        let project_ids = normalize_filter_set(input.project_ids);

        let cached = if query.is_empty() {
            self.db.search_work_items(
                &organization.id,
                project_ids.as_deref(),
                states.as_deref(),
                work_item_types.as_deref(),
                None,
            )?
        } else {
            let mut results = self.db.search_work_items_fts(&organization.id, &query)?;
            results.retain(|item| {
                filter_matches(&project_ids, Some(item.project_id.as_str()))
                    && filter_matches(&states, item.state.as_deref())
                    && filter_matches(&work_item_types, item.work_item_type.as_deref())
            });
            results
        };

        Ok(cached.into_iter().map(cached_wi_to_summary).collect())
    }

    pub fn list_my(&self, input: ListMyWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let cached = self.db.list_my_work_items(&organization.id)?;
        // Hide only items whose snooze is still in effect; an expired deadline
        // returns the work item to the list immediately instead of waiting for
        // the sync-driven reconcile to delete the row.
        let now = Utc::now();
        let snoozed: std::collections::HashSet<String> = self
            .db
            .list_snoozed_items(&organization.id, crate::snooze::ITEM_TYPE_WORK_ITEM)?
            .into_iter()
            .filter(|row| crate::snooze::snooze_is_active(now, &row.snooze_until))
            .map(|row| row.item_key)
            .collect();
        Ok(cached
            .into_iter()
            .filter(|item| !snoozed.contains(&item.id.to_string()))
            .map(cached_wi_to_summary)
            .collect())
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
        let comments_unavailable = comments_result.is_err();
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
        preview.comments_unavailable = comments_unavailable;
        preview.pull_requests = self.resolve_pull_request_links(&organization, &raw_relations);
        preview.attachments = extract_attachments(&raw_relations);
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

    /// Extracts pull request `ArtifactLink` relations and enriches them with
    /// locally synced My Reviews data (title, vote, draft status) when present.
    fn resolve_pull_request_links(
        &self,
        organization: &Organization,
        raw_relations: &[WorkItemRelation],
    ) -> Vec<WorkItemPullRequestLink> {
        let mut pr_ids: Vec<i64> = raw_relations
            .iter()
            .filter(|relation| relation.rel == "ArtifactLink")
            .filter(|relation| {
                relation
                    .attributes
                    .as_ref()
                    .and_then(|attributes| attributes.name.as_deref())
                    .is_some_and(|name| name.eq_ignore_ascii_case("Pull Request"))
            })
            .filter_map(|relation| pull_request_id_from_artifact(&relation.url))
            .collect();
        pr_ids.sort_unstable();
        pr_ids.dedup();
        if pr_ids.is_empty() {
            return Vec::new();
        }

        // Reviews are a progressive enhancement; missing local data still yields
        // a clickable PR id, so ignore lookup failures.
        let reviews = self
            .db
            .list_review_pull_requests(&organization.id)
            .unwrap_or_default();

        pr_ids
            .into_iter()
            .map(|pull_request_id| {
                let review = reviews
                    .iter()
                    .find(|pr| pr.pull_request_id == pull_request_id);
                WorkItemPullRequestLink {
                    pull_request_id,
                    repository_id: review.map(|pr| pr.repository_id.clone()),
                    title: review.map(|pr| pr.title.clone()),
                    status: review.map(|pr| {
                        if pr.is_draft {
                            "Draft".to_string()
                        } else {
                            "Active".to_string()
                        }
                    }),
                    my_vote_label: review.map(|pr| pr.my_vote_label.clone()),
                    web_url: review.and_then(|pr| pr.web_url.clone()),
                }
            })
            .collect()
    }

    async fn resolve_preview_relations(
        &self,
        client: &AdoClient,
        organization: &Organization,
        project_id: &str,
        fallback_project_name: &str,
        raw_relations: Vec<WorkItemRelation>,
    ) -> Vec<WorkItemRelationSummary> {
        let links = prioritized_relation_links(&raw_relations, MAX_PREVIEW_RELATIONS);
        if links.is_empty() {
            return Vec::new();
        }

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

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }
}
