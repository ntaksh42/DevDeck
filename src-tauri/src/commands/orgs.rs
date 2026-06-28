use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::db::Organization;
use crate::error::Result;
use crate::orgs::{
    AddAzureCliOrganizationInput, AddGitHubOrganizationInput, AddPatOrganizationInput,
};
use crate::providers::ProviderInfo;

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
    let db = state.db.clone();
    let delete_id = id.clone();
    run_blocking(move || {
        service.delete(&delete_id)?;
        // Clear the active pointer if it referenced the removed connection.
        if db.get_active_organization_id()?.as_deref() == Some(delete_id.as_str()) {
            db.set_active_organization_id(None)?;
        }
        Ok(())
    })
    .await?;
    // Rebuild against whatever connection remains active (or the first one).
    state.clear_provider().await;
    Ok(())
}

/// The connection the app is currently pointed at (the active one, or the first
/// configured). `None` when no connection is configured.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_active_organization(state: State<'_, AppState>) -> Result<Option<Organization>> {
    let db = state.db.clone();
    run_blocking(move || Ok(db.resolve_organization(None).ok())).await
}

/// Points the app at a different connection and swaps the API-layer provider.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_active_organization(
    id: String,
    state: State<'_, AppState>,
) -> Result<Organization> {
    let db = state.db.clone();
    let org = run_blocking(move || {
        db.set_active_organization_id(Some(&id))?;
        db.resolve_organization(Some(&id))
    })
    .await?;
    state.refresh_provider().await?;
    Ok(org)
}

/// Capabilities of the active connection's provider, so the UI can hide features
/// the active platform does not support.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_provider_capabilities(state: State<'_, AppState>) -> Result<ProviderInfo> {
    let capabilities = state.provider().await?.capabilities();
    Ok(ProviderInfo {
        kind: capabilities.kind.to_string(),
        capabilities,
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, input), fields(organization = %input.organization.trim()))]
pub async fn add_pat_organization(
    input: AddPatOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    let org = state.organizations.add_pat_organization(input).await?;
    activate_new_connection(&state, &org).await?;
    Ok(org)
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(organization = %input.organization.trim()))]
pub async fn add_azure_cli_organization(
    input: AddAzureCliOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    let org = state
        .organizations
        .add_azure_cli_organization(input)
        .await?;
    activate_new_connection(&state, &org).await?;
    Ok(org)
}

#[tauri::command]
#[tracing::instrument(skip(state, input))]
pub async fn add_github_organization(
    input: AddGitHubOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    let org = state.organizations.add_github_organization(input).await?;
    activate_new_connection(&state, &org).await?;
    Ok(org)
}

/// Makes a freshly added connection the active one and swaps the provider, so
/// the app immediately points at what the user just connected.
async fn activate_new_connection(state: &State<'_, AppState>, org: &Organization) -> Result<()> {
    let db = state.db.clone();
    let id = org.id.clone();
    run_blocking(move || db.set_active_organization_id(Some(&id))).await?;
    state.refresh_provider().await
}
