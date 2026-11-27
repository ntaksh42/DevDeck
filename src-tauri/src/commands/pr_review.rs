use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::error::Result;
use crate::pr_review::{
    AddPullRequestLabelInput, AddPullRequestReviewerInput, DeletePullRequestCommentInput,
    EditPullRequestCommentInput, GetPullRequestFileDiffInput, PostPullRequestCommentInput,
    PrCommit, PrDetailsResult, PrFileDiff, PrLabel, PrLocator, PrReviewer, PrStatusResult,
    PrThread, PullRequestChanges, PullRequestReview, RemovePullRequestLabelInput,
    RemovePullRequestReviewerInput, SearchPullRequestMentionsInput,
    SetPullRequestReviewerRequiredInput, SetPullRequestThreadStatusInput,
    SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput, UpdatePullRequestInput,
};
use crate::work_items::MentionCandidate;

#[tauri::command]
pub(crate) async fn upload_comment_image(
    input: crate::pr_review::CommentImageInput,
    state: State<'_, AppState>,
) -> Result<String> {
    ensure_write_enabled(&state).await?;
    state.pr_review.upload_comment_image(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pull_request_review(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestReview> {
    state.provider().await?.get_pull_request_review(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pull_request_changes(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestChanges> {
    state
        .provider()
        .await?
        .list_pull_request_changes(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_pull_request_file_diff(
    input: GetPullRequestFileDiffInput,
    state: State<'_, AppState>,
) -> Result<PrFileDiff> {
    state
        .provider()
        .await?
        .get_pull_request_file_diff(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pull_request_commits(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<Vec<PrCommit>> {
    state
        .provider()
        .await?
        .list_pull_request_commits(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_pull_request_work_items(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<Vec<i64>> {
    state
        .provider()
        .await?
        .list_pull_request_work_items(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn post_pull_request_comment(
    input: PostPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .post_pull_request_comment(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_pull_request_thread_status(
    input: SetPullRequestThreadStatusInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .set_pull_request_thread_status(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn submit_pull_request_vote(
    input: SubmitPullRequestVoteInput,
    state: State<'_, AppState>,
) -> Result<PrReviewer> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .submit_pull_request_vote(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_pull_request(
    input: UpdatePullRequestInput,
    state: State<'_, AppState>,
) -> Result<PrStatusResult> {
    ensure_write_enabled(&state).await?;
    let locator = input.pr.clone();
    let result = state.provider().await?.update_pull_request(input).await?;
    if let Some(status) = result.status.as_deref().filter(|s| *s != "active") {
        forget_closed_pull_request(&state, &locator, status).await;
    }
    Ok(result)
}

/// The grids read the synced cache, which still lists a PR this app just
/// completed or abandoned; drop it now instead of waiting for the next sync.
/// Best-effort: the next sync removes it anyway.
async fn forget_closed_pull_request(state: &AppState, pr: &PrLocator, status: &str) {
    let db = state.db.clone();
    let (pr, status) = (pr.clone(), status.to_string());
    let shared_cache_path = crate::shared_cache::path();
    let outcome = tokio::task::spawn_blocking(move || -> Result<()> {
        let org = db.resolve_organization(pr.organization_id.as_deref())?;
        db.forget_closed_pull_request(&org.id, &pr.repository_id, pr.pull_request_id)?;
        let conn = crate::shared_cache::open_at(shared_cache_path)?;
        crate::shared_cache::set_pull_request_status(
            &conn,
            &org.name,
            &pr.repository_id,
            pr.pull_request_id,
            &status,
        )
    })
    .await;
    if let Ok(Err(error)) = outcome {
        tracing::warn!(%error, "failed to drop a closed pull request from the cache");
    }
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_pull_request_reviewer_required(
    input: SetPullRequestReviewerRequiredInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .set_pull_request_reviewer_required(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn add_pull_request_label(
    input: AddPullRequestLabelInput,
    state: State<'_, AppState>,
) -> Result<PrLabel> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.add_pull_request_label(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn remove_pull_request_label(
    input: RemovePullRequestLabelInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .remove_pull_request_label(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn add_pull_request_reviewer(
    input: AddPullRequestReviewerInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .add_pull_request_reviewer(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn remove_pull_request_reviewer(
    input: RemovePullRequestReviewerInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .remove_pull_request_reviewer(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_pull_request_details(
    input: UpdatePullRequestDetailsInput,
    state: State<'_, AppState>,
) -> Result<PrDetailsResult> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .update_pull_request_details(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_pull_request_mentions(
    input: SearchPullRequestMentionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>> {
    state
        .provider()
        .await?
        .search_pull_request_mentions(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn edit_pull_request_comment(
    input: EditPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .edit_pull_request_comment(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_pull_request_comment(
    input: DeletePullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .delete_pull_request_comment(input)
        .await
}
