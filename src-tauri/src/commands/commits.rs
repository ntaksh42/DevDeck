use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::commits::{
    CherryPickCommitInput, CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitFileDiff,
    CommitPullRequest, CommitRefOperationResult, CommitRepositoryOption, CommitSearchResult,
    GetCommitChangesInput, GetCommitFileDiffInput, GetCommitPullRequestsInput,
    ListCommitRepositoriesInput, RevertCommitInput, SearchCommitsInput,
};
use crate::error::Result;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<CommitSearchResult> {
    state.provider().await?.search_commits(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_commit_repositories(
    input: ListCommitRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitRepositoryOption>> {
    state
        .provider()
        .await?
        .list_commit_repositories(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn commit_activity(
    input: CommitActivityInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitActivityDay>> {
    state.provider().await?.commit_activity(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_changes(
    input: GetCommitChangesInput,
    state: State<'_, AppState>,
) -> Result<CommitChangeSet> {
    state.provider().await?.get_commit_changes(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_file_diff(
    input: GetCommitFileDiffInput,
    state: State<'_, AppState>,
) -> Result<CommitFileDiff> {
    state.provider().await?.get_commit_file_diff(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_pull_requests(
    input: GetCommitPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitPullRequest>> {
    state
        .provider()
        .await?
        .get_commit_pull_requests(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn cherry_pick_commit(
    input: CherryPickCommitInput,
    state: State<'_, AppState>,
) -> Result<CommitRefOperationResult> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.cherry_pick_commit(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn revert_commit(
    input: RevertCommitInput,
    state: State<'_, AppState>,
) -> Result<CommitRefOperationResult> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.revert_commit(input).await
}
