use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::cancellation::run_cancellable;
use crate::code_browse::{
    BranchOverviewItem, CompareRevisionsInput, CreateBranchInput, CreateTagInput,
    DeleteBranchInput, DeleteTagInput, GetFileInput, ListBranchesInput, ListHistoryInput,
    ListPathsInput, ListTreeInput, RepoBranch, RepoCommitInfo, RepoFile, RepoPathList,
    RepoTreeItem, RevisionComparison, TagOverviewItem,
};
use crate::code_search::{
    CodeContextResult, CodeSearchResults, GetCodeContextInput, SearchCodeInput,
};
use crate::error::Result;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_code(
    input: SearchCodeInput,
    state: State<'_, AppState>,
) -> Result<CodeSearchResults> {
    let operation_id = input.operation_id.clone();
    let provider = state.provider().await?;
    run_cancellable(
        &state.cancellation,
        operation_id,
        provider.search_code(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_code_search_context(
    input: GetCodeContextInput,
    state: State<'_, AppState>,
) -> Result<CodeContextResult> {
    state.provider().await?.get_code_search_context(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_branches(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoBranch>> {
    state.provider().await?.list_repo_branches(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_branch_overview(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<BranchOverviewItem>> {
    state
        .provider()
        .await?
        .list_repo_branch_overview(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn create_repo_branch(
    input: CreateBranchInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.create_repo_branch(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_repo_branch(
    input: DeleteBranchInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.delete_repo_branch(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_tags(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    state.provider().await?.list_repo_tags(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_tag_overview(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<TagOverviewItem>> {
    state.provider().await?.list_repo_tag_overview(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn create_repo_tag(input: CreateTagInput, state: State<'_, AppState>) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.create_repo_tag(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_repo_tag(input: DeleteTagInput, state: State<'_, AppState>) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.delete_repo_tag(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn compare_repo_revisions(
    input: CompareRevisionsInput,
    state: State<'_, AppState>,
) -> Result<RevisionComparison> {
    state.provider().await?.compare_repo_revisions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_tree(
    input: ListTreeInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoTreeItem>> {
    let operation_id = input.operation_id.clone();
    let provider = state.provider().await?;
    run_cancellable(
        &state.cancellation,
        operation_id,
        provider.list_repo_tree(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_repo_file(input: GetFileInput, state: State<'_, AppState>) -> Result<RepoFile> {
    let operation_id = input.operation_id.clone();
    let provider = state.provider().await?;
    run_cancellable(
        &state.cancellation,
        operation_id,
        provider.get_repo_file(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_history(
    input: ListHistoryInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoCommitInfo>> {
    let operation_id = input.operation_id.clone();
    let provider = state.provider().await?;
    run_cancellable(
        &state.cancellation,
        operation_id,
        provider.list_repo_history(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_paths(
    input: ListPathsInput,
    state: State<'_, AppState>,
) -> Result<RepoPathList> {
    let operation_id = input.operation_id.clone();
    let provider = state.provider().await?;
    run_cancellable(
        &state.cancellation,
        operation_id,
        provider.list_repo_paths(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn cancel_operation(operation_id: String, state: State<'_, AppState>) -> Result<()> {
    state.cancellation.cancel(&operation_id);
    Ok(())
}
