use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineRunsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: Option<i64>,
    pub branch: Option<String>,
    pub result: Option<String>,
    pub status: Option<String>,
    pub requested_for_me: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineProjectsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineDefinitionsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub name_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineArtifactsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineDefinitionInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPipelineRunLogTailInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
    pub log_id: i64,
    pub max_lines: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
    pub source_branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
    pub source_branch: String,
    /// Optional runtime/build parameter values (name -> value).
    pub parameters: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPipelineRunInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub build_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPipelineApprovalsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePipelineApprovalInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub approval_id: String,
    /// `"approved"` or `"rejected"`.
    pub status: String,
    pub comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePipelineDefinitionInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
    /// The complete desired set of non-secret variables (adds, changes, and
    /// removes are expressed by what is present/absent here). Secret
    /// variables are never included and cannot be changed through this
    /// command.
    pub variables: Vec<PipelineVariableUpdate>,
    /// `None` leaves the definition's triggers untouched.
    pub ci_trigger: Option<PipelineCiTriggerUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineVariableUpdate {
    pub name: String,
    pub value: Option<String>,
    pub allow_override: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineCiTriggerUpdate {
    pub enabled: bool,
    pub branch_filters: Vec<String>,
    pub path_filters: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineApprovalSummary {
    pub id: String,
    pub status: String,
    pub instructions: Option<String>,
    pub min_required_approvers: i64,
    pub execution_order: Option<String>,
    pub created_on: Option<String>,
    pub assigned_approvers: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProjectOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionOption {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub build_id: i64,
    pub build_number: Option<String>,
    pub definition_id: Option<i64>,
    pub definition_name: Option<String>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub source_branch: Option<String>,
    pub reason: Option<String>,
    pub requested_for: Option<String>,
    pub queue_time: Option<String>,
    pub start_time: Option<String>,
    pub finish_time: Option<String>,
    pub web_url: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub node_type: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
    pub result: Option<String>,
    pub start_time: Option<String>,
    pub finish_time: Option<String>,
    pub log_id: Option<i64>,
    pub error_count: i64,
    pub warning_count: i64,
    pub order: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunDetail {
    pub run: PipelineRunSummary,
    pub timeline: Vec<TimelineNode>,
    /// True when the timeline request itself failed (vs. a run that genuinely
    /// has no timeline yet), so the UI can distinguish a fetch error from empty.
    pub timeline_unavailable: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineArtifact {
    pub name: String,
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineLogTail {
    pub lines: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineTrigger {
    pub trigger_type: Option<String>,
    pub branch_filters: Vec<String>,
    pub path_filters: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineVariable {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
    pub allow_override: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionDetail {
    pub definition_id: i64,
    pub name: String,
    pub triggers: Vec<PipelineTrigger>,
    pub variables: Vec<PipelineVariable>,
    pub repository: Option<PipelineDefinitionRepository>,
}

/// The repository a pipeline definition builds from, when Azure DevOps
/// reports one. Only `"TfsGit"` repositories support the branch picker; other
/// types (e.g. `"GitHub"`) fall back to free-text branch entry.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineDefinitionRepository {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub repository_type: String,
}
