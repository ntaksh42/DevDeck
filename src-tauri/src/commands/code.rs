use tauri::State;

use crate::app_state::AppState;
use crate::cancellation::run_cancellable;
use crate::code_browse::{
    ChangedFile, CompareRevisionsInput, GetFileInput, GetRevisionFileDiffInput, ListBranchesInput,
    ListHistoryInput, ListTagsInput, ListTreeInput, RepoBranch, RepoCommitInfo, RepoFile, RepoTag,
    RepoTreeItem, RevisionFileDiff,
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
pub async fn list_repo_tags(
    input: ListTagsInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoTag>> {
    state.provider().await?.list_repo_tags(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn compare_repo_revisions(
    input: CompareRevisionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ChangedFile>> {
    state.provider().await?.compare_repo_revisions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_repo_revision_file_diff(
    input: GetRevisionFileDiffInput,
    state: State<'_, AppState>,
) -> Result<RevisionFileDiff> {
    state
        .provider()
        .await?
        .get_repo_revision_file_diff(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn cancel_operation(operation_id: String, state: State<'_, AppState>) -> Result<()> {
    state.cancellation.cancel(&operation_id);
    Ok(())
}
