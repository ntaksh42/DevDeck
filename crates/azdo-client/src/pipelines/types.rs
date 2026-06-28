use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDefinitionRef {
    pub id: i64,
    pub name: String,
}

/// A build definition's trigger and variable configuration, as parsed from
/// `GET .../_apis/build/definitions/{id}`. Variables arrive as an unordered
/// map in the API; we flatten them into a sorted `Vec` for stable display.
#[derive(Debug, Clone)]
pub struct BuildDefinitionDetail {
    pub id: i64,
    pub name: String,
    pub triggers: Vec<DefinitionTrigger>,
    pub variables: Vec<DefinitionVariable>,
}

#[derive(Debug, Clone)]
pub struct DefinitionTrigger {
    pub trigger_type: Option<String>,
    pub branch_filters: Vec<String>,
    pub path_filters: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DefinitionVariable {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
    pub allow_override: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawBuildDefinition {
    id: i64,
    name: String,
    #[serde(default)]
    triggers: Vec<RawTrigger>,
    #[serde(default)]
    variables: HashMap<String, RawVariable>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTrigger {
    trigger_type: Option<String>,
    #[serde(default)]
    branch_filters: Vec<String>,
    #[serde(default)]
    path_filters: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVariable {
    value: Option<String>,
    #[serde(default)]
    is_secret: bool,
    #[serde(default)]
    allow_override: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildIdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub id: i64,
    pub build_number: Option<String>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub source_branch: Option<String>,
    pub reason: Option<String>,
    pub queue_time: Option<DateTime<Utc>>,
    pub start_time: Option<DateTime<Utc>>,
    pub finish_time: Option<DateTime<Utc>>,
    pub definition: Option<BuildDefinitionRef>,
    pub requested_for: Option<BuildIdentityRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildArtifactResource {
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildArtifact {
    pub name: String,
    pub resource: Option<BuildArtifactResource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLogRef {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRecord {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub record_type: Option<String>,
    pub name: Option<String>,
    pub state: Option<String>,
    pub result: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub finish_time: Option<DateTime<Utc>>,
    pub log: Option<TimelineLogRef>,
    #[serde(default)]
    pub error_count: i64,
    #[serde(default)]
    pub warning_count: i64,
    pub order: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    #[serde(default)]
    pub records: Vec<TimelineRecord>,
}

/// A pipeline approval (manual approval check gating a stage/environment).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub status: Option<String>,
    pub instructions: Option<String>,
    #[serde(default)]
    pub min_required_approvers: i64,
    pub execution_order: Option<String>,
    #[serde(default)]
    pub steps: Vec<ApprovalStep>,
    pub created_on: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalStep {
    pub status: Option<String>,
    pub comment: Option<String>,
    pub order: Option<i64>,
    pub assigned_approver: Option<BuildIdentityRef>,
    pub actual_approver: Option<BuildIdentityRef>,
}

#[derive(Debug, Clone, Default)]
pub struct BuildListCriteria {
    pub definition_id: Option<i64>,
    pub branch: Option<String>,
    pub result_filter: Option<String>,
    pub status_filter: Option<String>,
    pub requested_for: Option<String>,
    pub top: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct BuildLogTail {
    pub lines: Vec<String>,
    pub truncated: bool,
}

pub(super) fn build_definition_detail(raw: RawBuildDefinition) -> BuildDefinitionDetail {
    let triggers = raw
        .triggers
        .into_iter()
        .map(|trigger| DefinitionTrigger {
            trigger_type: trigger.trigger_type,
            branch_filters: trigger.branch_filters,
            path_filters: trigger.path_filters,
        })
        .collect();
    let mut variables: Vec<DefinitionVariable> = raw
        .variables
        .into_iter()
        .map(|(name, variable)| DefinitionVariable {
            name,
            value: variable.value,
            is_secret: variable.is_secret,
            allow_override: variable.allow_override,
        })
        .collect();
    variables.sort_by(|a, b| a.name.cmp(&b.name));
    BuildDefinitionDetail {
        id: raw.id,
        name: raw.name,
        triggers,
        variables,
    }
}
