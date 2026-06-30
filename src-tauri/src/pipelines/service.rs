use azdo_client::{BuildListCriteria, Timeline};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::projects::ProjectDirectory;
use crate::secrets::SecretStore;

use super::convert::{
    approval_to_summary, build_to_summary, definition_to_detail, failed_test_from,
    normalize_optional, resolve_requested_for, run_has_failures, timeline_to_nodes,
};
use super::types::*;

const RUN_LIST_TOP: u32 = 50;
const DEFINITION_LIST_TOP: u32 = 200;
const DEFAULT_LOG_TAIL_LINES: usize = 200;
// Failed test results to pull per run and to surface overall in the summary.
const FAILED_RESULTS_PER_RUN: u32 = 100;
const FAILED_RESULTS_TOTAL_CAP: usize = 200;

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

    pub async fn list_artifacts(
        &self,
        input: ListPipelineArtifactsInput,
    ) -> Result<Vec<PipelineArtifact>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let artifacts = client
            .list_build_artifacts(&project.id, input.build_id)
            .await?;
        Ok(artifacts
            .into_iter()
            .map(|artifact| PipelineArtifact {
                name: artifact.name,
                download_url: artifact.resource.and_then(|resource| resource.download_url),
            })
            .collect())
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

    /// Aggregates the test runs published against a build into pass/fail counts
    /// and a list of failed tests.
    pub async fn get_test_summary(
        &self,
        input: GetPipelineTestSummaryInput,
    ) -> Result<PipelineTestSummary> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let runs = client
            .list_test_runs_for_build(&project.id, input.build_id)
            .await?;

        let mut total_tests = 0;
        let mut passed_tests = 0;
        let mut failed: Vec<FailedTest> = Vec::new();
        let mut truncated = false;
        for run in &runs {
            total_tests += run.total_tests;
            passed_tests += run.passed_tests;
            // Only query results for runs that report failures, to avoid an
            // extra request per fully-passing run.
            if !run_has_failures(run) {
                continue;
            }
            let results = client
                .list_failed_test_results(&project.id, run.id, FAILED_RESULTS_PER_RUN)
                .await?;
            if results.len() as u32 >= FAILED_RESULTS_PER_RUN {
                truncated = true;
            }
            for result in results {
                if failed.len() >= FAILED_RESULTS_TOTAL_CAP {
                    truncated = true;
                    break;
                }
                failed.push(failed_test_from(run, result));
            }
        }

        Ok(PipelineTestSummary {
            run_count: runs.len(),
            total_tests,
            passed_tests,
            failed_tests: failed.len(),
            failed,
            truncated,
        })
    }

    /// Retries a stage of a run (re-runs its failed jobs by default).
    pub async fn retry_stage(&self, input: RetryPipelineStageInput) -> Result<()> {
        let stage_ref_name = input.stage_ref_name.trim();
        if stage_ref_name.is_empty() {
            return Err(AppError::InvalidInput(
                "stage reference name is required".to_string(),
            ));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        client
            .retry_build_stage(
                &project.id,
                input.build_id,
                stage_ref_name,
                input.force_retry_all_jobs,
            )
            .await?;
        Ok(())
    }
}
