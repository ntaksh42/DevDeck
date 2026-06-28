use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::db::Organization;
use crate::error::Result;
use crate::orgs::{AddAzureCliOrganizationInput, AddPatOrganizationInput};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<Organization>> {
    let service = state.organizations.clone();
    run_blocking(move || service.list()).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_organization(id: String, state: State<'_, AppState>) -> Result<()> {
    let service = state.organizations.clone();
    run_blocking(move || service.delete(&id)).await
}

#[tauri::command]
#[tracing::instrument(skip(state, input), fields(organization = %input.organization.trim()))]
pub async fn add_pat_organization(
    input: AddPatOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    state.organizations.add_pat_organization(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(organization = %input.organization.trim()))]
pub async fn add_azure_cli_organization(
    input: AddAzureCliOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    state.organizations.add_azure_cli_organization(input).await
}
