//! Response DTOs serialized back to the frontend: summaries, previews, and
//! candidate lists for the work item IPC surface.

use serde::Serialize;

/// The extra field values for one work item, keyed back to the row by id.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemExtraFields {
    pub id: i64,
    pub extra_fields: Vec<WorkItemCustomField>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemImage {
    pub data_url: String,
}

/// A flattened classification (area/iteration) node. `path` is the field-ready
/// value for `System.AreaPath` / `System.IterationPath` (backslash-joined node
/// names, e.g. `Project\Team\Sprint 1`); `depth` is its distance from the root.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationNodeOption {
    pub name: String,
    pub path: String,
    pub depth: usize,
    pub has_children: bool,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationNodesResult {
    pub areas: Vec<ClassificationNodeOption>,
    pub iterations: Vec<ClassificationNodeOption>,
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
    /// Raw `System.Tags` value ("tag1; tag2"); `None` when the item has no tags.
    pub tags: Option<String>,
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
    /// Unique name (e.g. email) of the assignee, when available. Lets the UI
    /// build an unambiguous `Display <unique>` value for undo so a duplicate
    /// display name does not resolve to the wrong person.
    pub assigned_to_unique_name: Option<String>,
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
    /// True when the comment fetch failed, so the UI can distinguish "no
    /// comments" from "comments could not be loaded".
    pub comments_unavailable: bool,
    pub relations: Vec<WorkItemRelationSummary>,
    /// Pull requests linked to this work item via `ArtifactLink` relations.
    pub pull_requests: Vec<WorkItemPullRequestLink>,
    /// Files attached to the work item (`AttachedFile` relations).
    pub attachments: Vec<WorkItemAttachment>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemAttachment {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemPullRequestLink {
    pub pull_request_id: i64,
    /// Present when the PR is locally synced (My Reviews); otherwise the PR is
    /// shown with only its id and a web link.
    pub repository_id: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub my_vote_label: Option<String>,
    pub web_url: Option<String>,
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
    #[serde(default)]
    pub reactions: Vec<CommentReactionSummary>,
}

/// A reaction aggregate on a comment: its type, total count, and whether the
/// authenticated user has reacted with it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentReactionSummary {
    pub reaction_type: String,
    pub count: i64,
    pub is_mine: bool,
}
