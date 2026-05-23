mod db;
mod error;
mod orgs;
mod prs;
mod secrets;

use db::{AppDatabase, Organization};
use error::Result;
use orgs::{AddPatOrganizationInput, OrganizationService};
use prs::{PullRequestService, PullRequestSummary, SearchPullRequestsInput};
use secrets::SecretStore;
use tauri::{Manager, State};

#[derive(Clone)]
struct AppState {
    organizations: OrganizationService,
    pull_requests: PullRequestService,
}

#[tauri::command]
fn list_organizations(state: State<'_, AppState>) -> Result<Vec<Organization>> {
    state.organizations.list()
}

#[tauri::command]
async fn add_pat_organization(
    input: AddPatOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Organization> {
    state.organizations.add_pat_organization(input).await
}

#[tauri::command]
async fn search_pull_requests(
    input: SearchPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PullRequestSummary>> {
    state.pull_requests.search(input).await
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
                pull_requests: PullRequestService::new(db, SecretStore),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_organizations,
            add_pat_organization,
            search_pull_requests
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
