use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::error::Result;
use crate::pr_review::{
    DeletePullRequestCommentInput, EditPullRequestCommentInput, GetPullRequestFileDiffInput,
    PostPullRequestCommentInput, PrCommit, PrDetailsResult, PrFileDiff, PrLocator, PrReviewer,
    PrStatusResult, PrThread, PullRequestChanges, PullRequestReview,
    RemovePullRequestReviewerInput, SearchPullRequestMentionsInput,
    SetPullRequestReviewerRequiredInput, SetPullRequestThreadStatusInput,
    SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput, UpdatePullRequestInput,
};
use crate::work_items::MentionCandidate;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pull_request_review(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestReview> {
    state.pr_review.get_review(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pull_request_changes(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestChanges> {
    state.pr_review.list_changes(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pull_request_file_diff(
    input: GetPullRequestFileDiffInput,
    state: State<'_, AppState>,
) -> Result<PrFileDiff> {
    state.pr_review.get_file_diff(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pull_request_commits(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<Vec<PrCommit>> {
    state.pr_review.list_commits(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn post_pull_request_comment(
    input: PostPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state.pr_review.post_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_pull_request_thread_status(
    input: SetPullRequestThreadStatusInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state.pr_review.set_thread_status(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn submit_pull_request_vote(
    input: SubmitPullRequestVoteInput,
    state: State<'_, AppState>,
) -> Result<PrReviewer> {
    ensure_write_enabled(&state).await?;
    state.pr_review.submit_vote(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_pull_request(
    input: UpdatePullRequestInput,
    state: State<'_, AppState>,
) -> Result<PrStatusResult> {
    ensure_write_enabled(&state).await?;
    state.pr_review.update_pull_request(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_pull_request_reviewer_required(
    input: SetPullRequestReviewerRequiredInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.pr_review.set_reviewer_required(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn remove_pull_request_reviewer(
    input: RemovePullRequestReviewerInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.pr_review.remove_reviewer(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_pull_request_details(
    input: UpdatePullRequestDetailsInput,
    state: State<'_, AppState>,
) -> Result<PrDetailsResult> {
    ensure_write_enabled(&state).await?;
    state.pr_review.update_pull_request_details(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_pull_request_mentions(
    input: SearchPullRequestMentionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>> {
    state.pr_review.search_mentions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn edit_pull_request_comment(
    input: EditPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state.pr_review.edit_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_pull_request_comment(
    input: DeletePullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.pr_review.delete_comment(input).await
}
