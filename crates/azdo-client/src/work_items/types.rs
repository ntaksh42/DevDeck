use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct WiqlRequest {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WiqlResponse {
    #[serde(default)]
    pub work_items: Vec<WorkItemReference>,
    #[serde(default)]
    pub work_item_relations: Vec<WiqlWorkItemRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemReference {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WiqlWorkItemRelation {
    pub source: Option<WorkItemReference>,
    pub target: Option<WorkItemReference>,
}

/// One edge of a `FROM WorkItemLinks` query result; `source_id` is `None` for roots.
#[derive(Debug, PartialEq, Eq)]
pub struct WorkItemLink {
    pub source_id: Option<i64>,
    pub target_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsBatchRequest {
    pub ids: Vec<i64>,
    pub fields: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    pub id: i64,
    #[serde(default)]
    pub fields: HashMap<String, Value>,
    #[serde(rename = "_links")]
    pub links: Option<WorkItemLinks>,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemLinks {
    pub html: Option<LinkRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemWithRelations {
    pub id: i64,
    #[serde(default)]
    pub relations: Vec<WorkItemRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRelation {
    pub rel: String,
    pub url: String,
    #[serde(default)]
    pub attributes: Option<WorkItemRelationAttributes>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRelationAttributes {
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LinkRef {
    pub href: String,
}

#[derive(Debug, Serialize)]
pub struct WorkItemCommentCreate {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct WorkItemPatchOperation {
    pub op: &'static str,
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemComment {
    pub id: i64,
    pub text: Option<String>,
    pub rendered_text: Option<String>,
    pub created_date: Option<String>,
    pub created_by: Option<CommentIdentityRef>,
    #[serde(default)]
    pub reactions: Vec<CommentReaction>,
}

/// A reaction aggregate on a work item comment for one reaction type.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentReaction {
    #[serde(rename = "type")]
    pub reaction_type: String,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub is_current_user_engaged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentIdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemCommentsList {
    #[serde(default)]
    pub comments: Vec<WorkItemComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemUpdatesList {
    #[serde(default)]
    pub value: Vec<WorkItemUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemUpdate {
    #[serde(default)]
    pub id: i64,
    pub revised_by: Option<CommentIdentityRef>,
    pub revised_date: Option<String>,
    #[serde(default)]
    pub fields: HashMap<String, WorkItemFieldUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldUpdate {
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeState {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeStatesList {
    pub value: Vec<WorkItemTypeState>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldDefinition {
    pub name: String,
    pub reference_name: String,
    #[serde(rename = "type")]
    pub field_type: String,
}

#[derive(Debug, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub wiql: Option<String>,
}

/// A node in an area or iteration classification tree. The field-ready path
/// (e.g. `Project\Team\Sprint 1`) is built by callers from the chain of node
/// names, which matches the `System.AreaPath` / `System.IterationPath` format.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationNode {
    pub name: String,
    #[serde(default)]
    pub structure_type: Option<String>,
    #[serde(default)]
    pub has_children: bool,
    #[serde(default)]
    pub children: Vec<ClassificationNode>,
    #[serde(default)]
    pub attributes: Option<ClassificationNodeAttributes>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationNodeAttributes {
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub finish_date: Option<String>,
}
