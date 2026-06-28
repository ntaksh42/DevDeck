use tauri::State;

use crate::app_state::AppState;
use crate::cancellation::run_cancellable;
use crate::code_browse::{
    GetFileInput, ListBranchesInput, ListHistoryInput, ListTreeInput, RepoBranch, RepoCommitInfo,
    RepoFile, RepoTreeItem,
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
    run_cancellable(
        &state.cancellation,
        operation_id,
        state.code_search.search(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_code_search_context(
    input: GetCodeContextInput,
    state: State<'_, AppState>,
) -> Result<CodeContextResult> {
    state.code_search.get_context(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_branches(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoBranch>> {
    state.code_browse.list_branches(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_tree(
    input: ListTreeInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoTreeItem>> {
    let operation_id = input.operation_id.clone();
    run_cancellable(
        &state.cancellation,
        operation_id,
        state.code_browse.list_tree(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_repo_file(input: GetFileInput, state: State<'_, AppState>) -> Result<RepoFile> {
    let operation_id = input.operation_id.clone();
    run_cancellable(
        &state.cancellation,
        operation_id,
        state.code_browse.get_file(input),
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
    run_cancellable(
        &state.cancellation,
        operation_id,
        state.code_browse.list_history(input),
    )
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn cancel_operation(operation_id: String, state: State<'_, AppState>) -> Result<()> {
    state.cancellation.cancel(&operation_id);
    Ok(())
}
