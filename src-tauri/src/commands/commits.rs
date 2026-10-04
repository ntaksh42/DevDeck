use tauri::State;

use crate::app_state::AppState;
use crate::commits::{
    CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitContainingRefs, CommitFileDiff,
    CommitPullRequest, CommitRepositoryOption, CommitSearchResult, GetCommitChangesInput,
    GetCommitContainingRefsInput, GetCommitFileDiffInput, GetCommitPullRequestsBatchInput,
    GetCommitPullRequestsInput, ListCommitRepositoriesInput, ListCommitWorkItemsInput,
    SearchCommitsInput,
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
pub async fn get_commit_containing_refs(
    input: GetCommitContainingRefsInput,
    state: State<'_, AppState>,
) -> Result<CommitContainingRefs> {
    state
        .provider()
        .await?
        .get_commit_containing_refs(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_commit_work_items(
    input: ListCommitWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<i64>> {
    state.provider().await?.list_commit_work_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_pull_requests_batch(
    input: GetCommitPullRequestsBatchInput,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Vec<CommitPullRequest>>> {
    state
        .provider()
        .await?
        .get_commit_pull_requests_batch(input)
        .await
}
