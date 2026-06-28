use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::commits::{
    CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitFileDiff, CommitPullRequest,
    CommitRepositoryOption, CommitSearchResult, GetCommitChangesInput, GetCommitFileDiffInput,
    GetCommitPullRequestsInput, ListCommitRepositoriesInput, SearchCommitsInput,
};
use crate::error::Result;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<CommitSearchResult> {
    let service = state.commits.clone();
    service.search(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_commit_repositories(
    input: ListCommitRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitRepositoryOption>> {
    let service = state.commits.clone();
    run_blocking(move || service.list_repositories(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn commit_activity(
    input: CommitActivityInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitActivityDay>> {
    let service = state.commits.clone();
    run_blocking(move || service.commit_activity(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_changes(
    input: GetCommitChangesInput,
    state: State<'_, AppState>,
) -> Result<CommitChangeSet> {
    state.commits.get_commit_changes(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_file_diff(
    input: GetCommitFileDiffInput,
    state: State<'_, AppState>,
) -> Result<CommitFileDiff> {
    state.commits.get_commit_file_diff(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_pull_requests(
    input: GetCommitPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitPullRequest>> {
    state.commits.get_commit_pull_requests(input).await
}
