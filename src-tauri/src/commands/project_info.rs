use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::project_info::{ProjectInfoInput, ProjectTeams, ServiceConnectionInfo, ServiceHookInfo};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_project_teams(
    input: ProjectInfoInput,
    state: State<'_, AppState>,
) -> Result<ProjectTeams> {
    state.provider().await?.list_project_teams(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_service_connections(
    input: ProjectInfoInput,
    state: State<'_, AppState>,
) -> Result<Vec<ServiceConnectionInfo>> {
    state
        .provider()
        .await?
        .list_service_connections(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_service_hooks(
    input: ProjectInfoInput,
    state: State<'_, AppState>,
) -> Result<Vec<ServiceHookInfo>> {
    state.provider().await?.list_service_hooks(input).await
}
