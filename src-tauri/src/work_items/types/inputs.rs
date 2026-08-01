//! Command input DTOs deserialized from the frontend for work item IPC calls.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    /// States to include. Empty/omitted means all states.
    pub states: Option<Vec<String>>,
    /// Work item types to include. Empty/omitted means any type.
    pub work_item_types: Option<Vec<String>>,
    /// Projects to include. Empty/omitted means all projects.
    pub project_ids: Option<Vec<String>>,
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

/// Work items whose extra fields should be fetched, grouped by project because
/// the batch endpoint is scoped to one project per call.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchWorkItemExtraFieldsInput {
    pub organization_id: Option<String>,
    pub items: Vec<WorkItemExtraFieldsTarget>,
    pub extra_fields: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemExtraFieldsTarget {
    pub project_id: String,
    pub id: i64,
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
pub struct AddWorkItemLinkInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub target_id: i64,
    /// Friendly link type: Parent | Child | Related | Predecessor | Successor.
    pub link_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorkItemLinkInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub target_id: i64,
    pub link_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkItemCommentInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub comment_id: i64,
    pub markdown: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListClassificationNodesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkItemInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    /// Work item type display name, e.g. "Bug" or "User Story".
    pub work_item_type: String,
    pub title: String,
    /// Plain-text description; sent as `System.Description`.
    pub description: Option<String>,
    pub assigned_to: Option<String>,
    pub area_path: Option<String>,
    pub iteration_path: Option<String>,
    pub priority: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemTypesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemsTagsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_ids: Vec<i64>,
    #[serde(default)]
    pub add_tags: Vec<String>,
    #[serde(default)]
    pub remove_tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWorkItemCommentReactionInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub comment_id: i64,
    /// One of `like`, `dislike`, `heart`, `hooray`, `smile`, `confused`.
    pub reaction_type: String,
    pub engaged: bool,
}
