// Cache/sync scaffolding can land before all call sites; keep builds warning-free.
#![allow(dead_code)]

mod auth;
mod commits;
mod db;
mod error;
mod orgs;
mod prs;
mod secrets;
mod settings;
mod sync;
mod work_items;

use commits::{
    CommitRepositoryOption, CommitService, CommitSummary, ListCommitRepositoriesInput,
    SearchCommitsInput,
};
use db::{AppDatabase, AppSettings, Organization};
use error::Result;
use orgs::{AddAzureCliOrganizationInput, AddPatOrganizationInput, OrganizationService};
use prs::{
    ListMyReviewPullRequestsInput, PullRequestService, PullRequestSummary,
    ReviewPullRequestSummary, SearchPullRequestsInput,
};
use secrets::SecretStore;
use settings::{
    GetReviewResultPreviewInput, ReviewResultPreview, SettingsService, UpdateAppSettingsInput,
};
use sync::SyncRunner;
use tauri::{Manager, State};
use work_items::{
    AddWorkItemCommentInput, GetWorkItemPreviewInput, ListMyWorkItemsInput, MentionCandidate,
    SearchWorkItemMentionsInput, SearchWorkItemsInput, WorkItemComment, WorkItemPreview,
    WorkItemService, WorkItemSummary,
};

#[derive(Clone)]
struct AppState {
    organizations: OrganizationService,
    pull_requests: PullRequestService,
    work_items: WorkItemService,
    commits: CommitService,
    settings: SettingsService,
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn list_organizations(state: State<'_, AppState>) -> Result<Vec<Organization>> {
    state.organizations.list()
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    state.settings.get()
}

#[tauri::command]
#[tracing::instrument(skip(state, input))]
fn update_app_settings(
    input: UpdateAppSettingsInput,
    state: State<'_, AppState>,
) -> Result<AppSettings> {
    state.settings.update(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn get_review_result_preview(
    input: GetReviewResultPreviewInput,
    state: State<'_, AppState>,
) -> Result<Option<ReviewResultPreview>> {
    state.settings.review_result_preview(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn delete_organization(id: String, state: State<'_, AppState>) -> Result<()> {
    state.organizations.delete(&id)
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
async fn list_my_review_pull_requests(
    input: ListMyReviewPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReviewPullRequestSummary>> {
    state.pull_requests.list_my_reviews(input).await
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
async fn list_my_work_items(
    input: ListMyWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.list_my(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_work_item_preview(
    input: GetWorkItemPreviewInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    state.work_items.preview(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_work_item_mentions(
    input: SearchWorkItemMentionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>> {
    state.work_items.search_mentions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn add_work_item_comment(
    input: AddWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<WorkItemComment> {
    state.work_items.add_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitSummary>> {
    state.commits.search(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_commit_repositories(
    input: ListCommitRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitRepositoryOption>> {
    state.commits.list_repositories(input).await
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
                commits: CommitService::new(db.clone(), SecretStore),
                settings: SettingsService::new(db.clone()),
            });
            tauri::async_runtime::spawn(SyncRunner::new(db, SecretStore).run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_organizations,
            get_app_settings,
            update_app_settings,
            get_review_result_preview,
            delete_organization,
            add_pat_organization,
            add_azure_cli_organization,
            search_pull_requests,
            list_my_review_pull_requests,
            search_work_items,
            list_my_work_items,
            get_work_item_preview,
            search_work_item_mentions,
            add_work_item_comment,
            search_commits,
            list_commit_repositories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
