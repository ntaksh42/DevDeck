use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::error::Result;
use crate::prs::{
    ListMyCreatedPullRequestsInput, ListMyReviewPullRequestsInput, MyCreatedPullRequestSummary,
    PullRequestSearchResult, ReviewPullRequestSummary, SearchPullRequestsInput,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_pull_requests(
    input: SearchPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<PullRequestSearchResult> {
    let service = state.pull_requests.clone();
    service.search(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_my_review_pull_requests(
    input: ListMyReviewPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReviewPullRequestSummary>> {
    let service = state.pull_requests.clone();
    run_blocking(move || service.list_my_reviews(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_my_created_pull_requests(
    input: ListMyCreatedPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MyCreatedPullRequestSummary>> {
    let service = state.pull_requests.clone();
    service.list_my_created_pull_requests(input).await
}
