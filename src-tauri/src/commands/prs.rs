use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::prs::{
    ListMyCreatedPullRequestsInput, ListMyReviewPullRequestsInput, MyCreatedPullRequestsResult,
    PullRequestSearchResult, ReviewPullRequestSummary, SearchPullRequestsInput,
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
) -> Result<MyCreatedPullRequestsResult> {
    state
        .provider()
        .await?
        .list_my_created_pull_requests(input)
        .await
}
