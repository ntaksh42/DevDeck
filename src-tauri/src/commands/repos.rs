use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::repos::{ListBranchesInput, ListRepositoriesInput, RepoBranch, RepositoryOption};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repositories(
    input: ListRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepositoryOption>> {
    state.provider().await?.list_repositories(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_repo_branches(
    input: ListBranchesInput,
    state: State<'_, AppState>,
) -> Result<Vec<RepoBranch>> {
    state.provider().await?.list_repo_branches(input).await
}
