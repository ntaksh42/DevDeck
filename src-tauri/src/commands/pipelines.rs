use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::error::Result;
use crate::pipelines::{
    CancelPipelineRunInput, GetPipelineDefinitionInput, GetPipelineRunInput,
    GetPipelineRunLogTailInput, ListPipelineApprovalsInput, ListPipelineArtifactsInput,
    ListPipelineDefinitionsInput, ListPipelineProjectsInput, ListPipelineRunsInput,
    PipelineApprovalSummary, PipelineArtifact, PipelineDefinitionDetail, PipelineDefinitionOption,
    PipelineLogTail, PipelineProjectOption, PipelineRunDetail, PipelineRunSummary,
    QueuePipelineRunInput, RerunPipelineRunInput, UpdatePipelineApprovalInput,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pipeline_projects(
    input: ListPipelineProjectsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineProjectOption>> {
    state.provider().await?.list_pipeline_projects(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pipeline_runs(
    input: ListPipelineRunsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineRunSummary>> {
    state.provider().await?.list_pipeline_runs(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pipeline_definitions(
    input: ListPipelineDefinitionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineDefinitionOption>> {
    state
        .provider()
        .await?
        .list_pipeline_definitions(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pipeline_run(
    input: GetPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunDetail> {
    state.provider().await?.get_pipeline_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pipeline_artifacts(
    input: ListPipelineArtifactsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineArtifact>> {
    state.provider().await?.list_pipeline_artifacts(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pipeline_definition(
    input: GetPipelineDefinitionInput,
    state: State<'_, AppState>,
) -> Result<PipelineDefinitionDetail> {
    state.provider().await?.get_pipeline_definition(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pipeline_run_log_tail(
    input: GetPipelineRunLogTailInput,
    state: State<'_, AppState>,
) -> Result<PipelineLogTail> {
    state
        .provider()
        .await?
        .get_pipeline_run_log_tail(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rerun_pipeline_run(
    input: RerunPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunSummary> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.rerun_pipeline_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn queue_pipeline_run(
    input: QueuePipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunSummary> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.queue_pipeline_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn cancel_pipeline_run(
    input: CancelPipelineRunInput,
    state: State<'_, AppState>,
) -> Result<PipelineRunSummary> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.cancel_pipeline_run(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pipeline_approvals(
    input: ListPipelineApprovalsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineApprovalSummary>> {
    state.provider().await?.list_pipeline_approvals(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_pipeline_approval(
    input: UpdatePipelineApprovalInput,
    state: State<'_, AppState>,
) -> Result<Vec<PipelineApprovalSummary>> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .update_pipeline_approval(input)
        .await
}
