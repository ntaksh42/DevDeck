mod auth;
mod commits;
mod db;
mod error;
mod orgs;
mod prs;
mod secrets;
mod work_items;

use commits::{CommitService, CommitSummary, SearchCommitsInput};
use db::{AppDatabase, Organization};
use error::Result;
use orgs::{AddAzureCliOrganizationInput, AddPatOrganizationInput, OrganizationService};
use prs::{PullRequestService, PullRequestSummary, SearchPullRequestsInput};
use secrets::SecretStore;
use tauri::{Manager, State};
use work_items::{SearchWorkItemsInput, WorkItemService, WorkItemSummary};

#[derive(Clone)]
struct AppState {
    organizations: OrganizationService,
    pull_requests: PullRequestService,
    work_items: WorkItemService,
    commits: CommitService,
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn list_organizations(state: State<'_, AppState>) -> Result<Vec<Organization>> {
    state.organizations.list()
}

#[tauri::command]
#[tracing::instrument(skip(state, input), fields(organization = %input.organization.trim()))]
async fn add_pat_organization(
    input: AddPatOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    state.organizations.add_pat_organization(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state), fields(organization = %input.organization.trim()))]
async fn add_azure_cli_organization(
    input: AddAzureCliOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    state.organizations.add_azure_cli_organization(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_pull_requests(
    input: SearchPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PullRequestSummary>> {
    state.pull_requests.search(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_work_items(
    input: SearchWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.search(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitSummary>> {
    state.commits.search(input).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = AppDatabase::new(app_data_dir.join("azdodeck.sqlite3"));
            db.initialize()?;
            app.manage(AppState {
                organizations: OrganizationService::new(db.clone(), SecretStore),
                pull_requests: PullRequestService::new(db.clone(), SecretStore),
                work_items: WorkItemService::new(db.clone(), SecretStore),
                commits: CommitService::new(db, SecretStore),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_organizations,
            add_pat_organization,
            add_azure_cli_organization,
            search_pull_requests,
            search_work_items,
            search_commits
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
