// Cache/sync scaffolding can land before all call sites; keep builds warning-free.
#![allow(dead_code)]

use std::str::FromStr;

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
use error::{AppError, Result};
use orgs::{AddAzureCliOrganizationInput, AddPatOrganizationInput, OrganizationService};
use prs::{
    ListMyReviewPullRequestsInput, PullRequestService, PullRequestSummary,
    ReviewPullRequestSummary, SearchPullRequestsInput,
};
use secrets::SecretStore;
use settings::{
    normalize_app_settings, GetReviewResultPreviewInput, ReviewResultPreview, SettingsService,
    UpdateAppSettingsInput,
};
use sync::SyncRunner;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::mpsc;
use work_items::{
    AddWorkItemCommentInput, AssignWorkItemInput, AssignWorkItemsInput, BulkWorkItemResult,
    GetWorkItemPreviewInput, ListMyWorkItemsInput, ListWorkItemProjectsInput,
    ListWorkItemTypeStatesInput, MentionCandidate, RunWorkItemQueryInput,
    SearchWorkItemMentionsInput, SearchWorkItemsInput, SetWorkItemStateInput,
    SetWorkItemsStateInput, WorkItemComment, WorkItemPreview, WorkItemProjectOption,
    WorkItemService, WorkItemSummary,
};

#[derive(Clone)]
struct AppState {
    organizations: OrganizationService,
    pull_requests: PullRequestService,
    work_items: WorkItemService,
    commits: CommitService,
    settings: SettingsService,
    sync_trigger: mpsc::Sender<()>,
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
    app: AppHandle,
) -> Result<AppSettings> {
    let settings = normalize_app_settings(input);
    configure_show_window_hotkey(&app, settings.show_window_hotkey.as_deref())?;
    state.settings.update_normalized(settings)
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
fn search_pull_requests(
    input: SearchPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<PullRequestSummary>> {
    state.pull_requests.search(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn list_my_review_pull_requests(
    input: ListMyReviewPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReviewPullRequestSummary>> {
    state.pull_requests.list_my_reviews(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn search_work_items(
    input: SearchWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.search(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn list_my_work_items(
    input: ListMyWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.list_my(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_work_item_projects(
    input: ListWorkItemProjectsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemProjectOption>> {
    state.work_items.list_projects(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn run_work_item_query(
    input: RunWorkItemQueryInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.run_query(input).await
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
async fn assign_work_item(
    input: AssignWorkItemInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    state.work_items.assign(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn set_work_item_state(
    input: SetWorkItemStateInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    state.work_items.set_state(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn set_work_items_state(
    input: SetWorkItemsStateInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    state.work_items.set_items_state(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn assign_work_items(
    input: AssignWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    state.work_items.assign_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_work_item_type_states(
    input: ListWorkItemTypeStatesInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    state.work_items.list_type_states(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitSummary>> {
    state.commits.search(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn list_commit_repositories(
    input: ListCommitRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitRepositoryOption>> {
    state.commits.list_repositories(input)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
fn trigger_sync(state: State<'_, AppState>) -> Result<()> {
    state.sync_trigger.try_send(()).ok();
    Ok(())
}

fn configure_show_window_hotkey(app: &AppHandle, hotkey: Option<&str>) -> Result<()> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;

    let Some(hotkey) = hotkey.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let shortcut = Shortcut::from_str(hotkey).map_err(|error| {
        AppError::InvalidInput(format!("show window hotkey is invalid: {error}"))
    })?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = AppDatabase::new(app_data_dir.join("azdodeck.sqlite3"));
            db.initialize()?;
            let settings = db.get_app_settings()?;
            configure_show_window_hotkey(app.handle(), settings.show_window_hotkey.as_deref())?;
            let (sync_tx, sync_rx) = SyncRunner::channel();
            app.manage(AppState {
                organizations: OrganizationService::new(db.clone(), SecretStore),
                pull_requests: PullRequestService::new(db.clone(), SecretStore),
                work_items: WorkItemService::new(db.clone(), SecretStore),
                commits: CommitService::new(db.clone(), SecretStore),
                settings: SettingsService::new(db.clone()),
                sync_trigger: sync_tx,
            });
            tauri::async_runtime::spawn(
                SyncRunner::new(db, SecretStore).run(app.handle().clone(), sync_rx),
            );
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
            list_work_item_projects,
            run_work_item_query,
            get_work_item_preview,
            search_work_item_mentions,
            add_work_item_comment,
            assign_work_item,
            set_work_item_state,
            list_work_item_type_states,
            set_work_items_state,
            assign_work_items,
            search_commits,
            list_commit_repositories,
            trigger_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
