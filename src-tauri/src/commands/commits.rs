use tauri::State;

use crate::app_state::AppState;
use crate::commits::{
    CommitActivityDay, CommitActivityInput, CommitAvatarImage, CommitChangeSet, CommitFileDiff,
    CommitPullRequest, CommitRefsResult, CommitRepositoryOption, CommitSearchResult,
    FetchCommitAvatarInput, GetCommitChangesInput, GetCommitFileDiffInput,
    GetCommitPullRequestsInput, GetCommitRefsInput, ListCommitRepositoriesInput,
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

// `get_commit_refs` and `fetch_commit_avatar` are Azure DevOps-specific (no
// GitHub equivalent is wired up), so they call the commit service directly
// rather than going through the cross-provider `Provider` trait — the same
// pattern `fetch_work_item_image` uses for work item attachment images.

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_commit_refs(
    input: GetCommitRefsInput,
    state: State<'_, AppState>,
) -> Result<CommitRefsResult> {
    state.commits.get_commit_refs(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn fetch_commit_avatar(
    input: FetchCommitAvatarInput,
    state: State<'_, AppState>,
) -> Result<CommitAvatarImage> {
    state.commits.fetch_avatar(input).await
}
