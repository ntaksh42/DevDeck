use std::collections::HashMap;

use azdo_client::{
    Approval, Build, BuildDefinitionDetail, BuildListCriteria, DefinitionTrigger,
    DefinitionVariable, Timeline,
};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::projects::ProjectDirectory;
use crate::secrets::SecretStore;

const RUN_LIST_TOP: u32 = 50;
const DEFINITION_LIST_TOP: u32 = 200;
const DEFAULT_LOG_TAIL_LINES: usize = 200;

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
}

#[derive(Debug, Clone)]
pub struct PipelineService {
    db: AppDatabase,
    secrets: SecretStore,
    projects: ProjectDirectory,
}

impl PipelineService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self {
            db,
            secrets,
            projects: ProjectDirectory::new(),
        }
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }

    pub async fn list_runs(&self, input: ListPipelineRunsInput) -> Result<Vec<PipelineRunSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let requested_for = resolve_requested_for(
            input.requested_for_me.unwrap_or(false),
            organization.authenticated_user_id.as_deref(),
        )?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let builds = client
            .list_builds(
                &project.id,
                BuildListCriteria {
                    definition_id: input.definition_id,
                    branch: input.branch,
                    result_filter: normalize_optional(input.result),
                    status_filter: normalize_optional(input.status),
                    requested_for,
                    top: Some(RUN_LIST_TOP),
                },
            )
            .await?;

        Ok(builds
            .into_iter()
            .map(|build| build_to_summary(&organization, &project.id, &project.name, build))
            .collect())
    }

    pub async fn list_projects(
        &self,
        input: ListPipelineProjectsInput,
    ) -> Result<Vec<PipelineProjectOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let projects = self.projects.list(&client, &organization.id).await?;
        let mut options: Vec<PipelineProjectOption> = projects
            .into_iter()
            .map(|p| PipelineProjectOption {
                id: p.id,
                name: p.name,
            })
            .collect();
        options.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(options)
    }

    pub async fn list_definitions(
        &self,
        input: ListPipelineDefinitionsInput,
    ) -> Result<Vec<PipelineDefinitionOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let defs = client
            .list_build_definitions(
                &input.project_id,
                input.name_filter.as_deref(),
                DEFINITION_LIST_TOP,
            )
            .await?;
        let mut options: Vec<PipelineDefinitionOption> = defs
            .into_iter()
            .map(|d| PipelineDefinitionOption {
                id: d.id,
                name: d.name,
            })
            .collect();
        options.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(options)
    }

    pub async fn get_run(&self, input: GetPipelineRunInput) -> Result<PipelineRunDetail> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client.get_build(&project.id, input.build_id).await?;
        let (timeline, timeline_unavailable) =
            match client.get_build_timeline(&project.id, input.build_id).await {
                Ok(timeline) => (timeline, false),
                Err(error) => {
                    tracing::warn!(
                        project = %project.id,
                        build_id = input.build_id,
                        %error,
                        "failed to fetch pipeline timeline"
                    );
                    (Timeline { records: vec![] }, true)
                }
            };
        Ok(PipelineRunDetail {
            run: build_to_summary(&organization, &project.id, &project.name, build),
            timeline: timeline_to_nodes(timeline),
            timeline_unavailable,
        })
    }

    pub async fn get_definition(
        &self,
        input: GetPipelineDefinitionInput,
    ) -> Result<PipelineDefinitionDetail> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let definition = client
            .get_build_definition(&project.id, input.definition_id)
            .await?;
        Ok(definition_to_detail(definition))
    }

    pub async fn get_run_log_tail(
        &self,
        input: GetPipelineRunLogTailInput,
    ) -> Result<PipelineLogTail> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let max_lines = input
            .max_lines
            .unwrap_or(DEFAULT_LOG_TAIL_LINES)
            .clamp(1, 2000);
        let tail = client
            .get_build_log_tail(&input.project_id, input.build_id, input.log_id, max_lines)
            .await?;
        Ok(PipelineLogTail {
            lines: tail.lines,
            truncated: tail.truncated,
        })
    }

    pub async fn rerun_run(&self, input: RerunPipelineRunInput) -> Result<PipelineRunSummary> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client
            .queue_build(&project.id, input.definition_id, &input.source_branch, None)
            .await?;
        Ok(build_to_summary(
            &organization,
            &project.id,
            &project.name,
            build,
        ))
    }

    /// Queues a new run of a pipeline definition on a branch, optionally passing
    /// runtime parameter values (issue #397).
    pub async fn queue_run(&self, input: QueuePipelineRunInput) -> Result<PipelineRunSummary> {
        let branch = input.source_branch.trim();
        if branch.is_empty() {
            return Err(AppError::InvalidInput("a branch is required".to_string()));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let parameters = input
            .parameters
            .filter(|map| !map.is_empty())
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| AppError::InvalidInput(format!("invalid parameters: {error}")))?;
        let build = client
            .queue_build(
                &project.id,
                input.definition_id,
                branch,
                parameters.as_ref(),
            )
            .await?;
        Ok(build_to_summary(
            &organization,
            &project.id,
            &project.name,
            build,
        ))
    }

    pub async fn cancel_run(&self, input: CancelPipelineRunInput) -> Result<PipelineRunSummary> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let build = client.cancel_build(&project.id, input.build_id).await?;
        Ok(build_to_summary(
            &organization,
            &project.id,
            &project.name,
            build,
        ))
    }

    /// Lists the pending pipeline approvals assigned to the authenticated user
    /// in a project.
    pub async fn list_approvals(
        &self,
        input: ListPipelineApprovalsInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let user_ids: Vec<String> = organization
            .authenticated_user_id
            .as_deref()
            .map(|id| vec![id.to_string()])
            .unwrap_or_default();
        let approvals = client
            .list_pipeline_approvals(&project.id, &user_ids, "pending")
            .await?;
        Ok(approvals.into_iter().map(approval_to_summary).collect())
    }

    /// Approves or rejects a single pipeline approval.
    pub async fn update_approval(
        &self,
        input: UpdatePipelineApprovalInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        let status = match input.status.trim().to_ascii_lowercase().as_str() {
            "approved" | "approve" => "approved",
            "rejected" | "reject" => "rejected",
            other => {
                return Err(AppError::InvalidInput(format!(
                    "invalid approval status: {other}"
                )))
            }
        };
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let comment = input.comment.unwrap_or_default();
        let updated = client
            .update_pipeline_approval(&project.id, &input.approval_id, status, &comment)
            .await?;
        Ok(updated.into_iter().map(approval_to_summary).collect())
    }
}

fn approval_to_summary(approval: Approval) -> PipelineApprovalSummary {
    let assigned_approvers = approval
        .steps
        .iter()
        .filter_map(|step| step.assigned_approver.as_ref())
        .filter_map(|approver| {
            approver
                .display_name
                .clone()
                .or_else(|| approver.unique_name.clone())
        })
        .collect();
    PipelineApprovalSummary {
        id: approval.id,
        status: approval.status.unwrap_or_default(),
        instructions: approval.instructions,
        min_required_approvers: approval.min_required_approvers,
        execution_order: approval.execution_order,
        created_on: approval.created_on.map(|date| date.to_rfc3339()),
        assigned_approvers,
    }
}

/// Resolves the `requestedFor` filter for a run listing.
///
/// When `requested_for_me` is set the caller wants to see only their own runs,
/// so an absent authenticated user id is an error: silently dropping the filter
/// would return every user's runs instead of none.
fn resolve_requested_for(
    requested_for_me: bool,
    authenticated_user_id: Option<&str>,
) -> Result<Option<String>> {
    if !requested_for_me {
        return Ok(None);
    }
    authenticated_user_id
        .map(|id| Some(id.to_string()))
        .ok_or_else(|| {
            AppError::InvalidInput(
                "organization has no authenticated user id; re-add the organization".to_string(),
            )
        })
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_web_url(organization: &Organization, project_name: &str, build_id: i64) -> String {
    format!(
        "{}/{}/_build/results?buildId={}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        build_id
    )
}

fn build_to_summary(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    build: Build,
) -> PipelineRunSummary {
    let web_url = build_web_url(organization, project_name, build.id);
    let (definition_id, definition_name) = match build.definition {
        Some(def) => (Some(def.id), Some(def.name)),
        None => (None, None),
    };
    PipelineRunSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        build_id: build.id,
        build_number: build.build_number,
        definition_id,
        definition_name,
        status: build.status,
        result: build.result,
        source_branch: build.source_branch,
        reason: build.reason,
        requested_for: build.requested_for.and_then(|r| r.display_name),
        queue_time: build.queue_time.map(|t| t.to_rfc3339()),
        start_time: build.start_time.map(|t| t.to_rfc3339()),
        finish_time: build.finish_time.map(|t| t.to_rfc3339()),
        web_url,
    }
}

fn definition_to_detail(definition: BuildDefinitionDetail) -> PipelineDefinitionDetail {
    PipelineDefinitionDetail {
        definition_id: definition.id,
        name: definition.name,
        triggers: definition
            .triggers
            .into_iter()
            .map(trigger_to_ipc)
            .collect(),
        variables: definition
            .variables
            .into_iter()
            .map(variable_to_ipc)
            .collect(),
    }
}

fn trigger_to_ipc(trigger: DefinitionTrigger) -> PipelineTrigger {
    PipelineTrigger {
        trigger_type: trigger.trigger_type,
        branch_filters: trigger.branch_filters,
        path_filters: trigger.path_filters,
    }
}

fn variable_to_ipc(variable: DefinitionVariable) -> PipelineVariable {
    PipelineVariable {
        name: variable.name,
        value: variable.value,
        is_secret: variable.is_secret,
        allow_override: variable.allow_override,
    }
}

fn timeline_to_nodes(timeline: Timeline) -> Vec<TimelineNode> {
    timeline
        .records
        .into_iter()
        .map(|record| TimelineNode {
            id: record.id,
            parent_id: record.parent_id,
            node_type: record.record_type,
            name: record.name,
            state: record.state,
            result: record.result,
            start_time: record.start_time.map(|t| t.to_rfc3339()),
            finish_time: record.finish_time.map(|t| t.to_rfc3339()),
            log_id: record.log.map(|l| l.id),
            error_count: record.error_count,
            warning_count: record.warning_count,
            order: record.order,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Organization {
        Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso/".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            created_at: "2026-06-13T00:00:00Z".to_string(),
            updated_at: "2026-06-13T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn build_web_url_encodes_project_and_trims_slash() {
        assert_eq!(
            build_web_url(&org(), "Platform Team", 101),
            "https://dev.azure.com/contoso/Platform%20Team/_build/results?buildId=101"
        );
    }

    #[test]
    fn normalize_optional_drops_blank() {
        assert_eq!(normalize_optional(Some("  ".to_string())), None);
        assert_eq!(
            normalize_optional(Some(" failed ".to_string())),
            Some("failed".to_string())
        );
    }

    #[test]
    fn definition_to_detail_maps_triggers_and_variables() {
        let detail = definition_to_detail(BuildDefinitionDetail {
            id: 12,
            name: "CI".to_string(),
            triggers: vec![DefinitionTrigger {
                trigger_type: Some("continuousIntegration".to_string()),
                branch_filters: vec!["+refs/heads/main".to_string()],
                path_filters: vec![],
            }],
            variables: vec![
                DefinitionVariable {
                    name: "Alpha".to_string(),
                    value: Some("first".to_string()),
                    is_secret: false,
                    allow_override: true,
                },
                DefinitionVariable {
                    name: "ApiKey".to_string(),
                    value: None,
                    is_secret: true,
                    allow_override: false,
                },
            ],
        });

        assert_eq!(detail.definition_id, 12);
        assert_eq!(detail.triggers.len(), 1);
        assert_eq!(
            detail.triggers[0].trigger_type.as_deref(),
            Some("continuousIntegration")
        );
        // Secret variables carry no value through the mapping.
        let secret = detail
            .variables
            .iter()
            .find(|v| v.name == "ApiKey")
            .unwrap();
        assert!(secret.is_secret);
        assert_eq!(secret.value, None);
    }

    #[test]
    fn resolve_requested_for_without_flag_is_none() {
        assert_eq!(resolve_requested_for(false, None).unwrap(), None);
        assert_eq!(resolve_requested_for(false, Some("user-1")).unwrap(), None);
    }

    #[test]
    fn resolve_requested_for_uses_authenticated_user_id() {
        assert_eq!(
            resolve_requested_for(true, Some("user-1")).unwrap(),
            Some("user-1".to_string())
        );
    }

    #[test]
    fn resolve_requested_for_errors_when_user_id_missing() {
        let err = resolve_requested_for(true, None).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }
}
