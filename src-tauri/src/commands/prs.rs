use tauri::State;

use crate::app_state::{ensure_write_enabled, AppState};
use crate::error::Result;
use crate::prs::{
    CreatePullRequestInput, CreatePullRequestResult, ListMyCreatedPullRequestsInput,
    ListMyReviewPullRequestsInput, MyCreatedPullRequestSummary, PullRequestSearchResult,
    ReviewPullRequestSummary, SearchPullRequestsInput,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_pull_requests(
    input: SearchPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<PullRequestSearchResult> {
    state.provider().await?.search_pull_requests(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn create_pull_request(
    input: CreatePullRequestInput,
    state: State<'_, AppState>,
) -> Result<CreatePullRequestResult> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.create_pull_request(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_my_review_pull_requests(
    input: ListMyReviewPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReviewPullRequestSummary>> {
    state
        .provider()
        .await?
        .list_my_review_pull_requests(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_my_created_pull_requests(
    input: ListMyCreatedPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MyCreatedPullRequestSummary>> {
    state
        .provider()
        .await?
        .list_my_created_pull_requests(input)
        .await
}
