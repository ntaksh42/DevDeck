use std::str::FromStr;

use serde::Deserialize;

mod auth;
mod commits;
mod db;
mod error;
mod orgs;
mod pr_review;
mod projects;
mod prs;
mod search;
mod secrets;
mod settings;
mod sync;
mod work_items;

use commits::{
    CommitRepositoryOption, CommitService, CommitSummary, ListCommitRepositoriesInput,
    SearchCommitsInput,
};
use db::{AppDatabase, AppSettings, Organization, SyncState};
use error::{AppError, Result};
use orgs::{AddAzureCliOrganizationInput, AddPatOrganizationInput, OrganizationService};
use pr_review::{
    DeletePullRequestCommentInput, EditPullRequestCommentInput, GetPullRequestFileDiffInput,
    PostPullRequestCommentInput, PrCommit, PrFileDiff, PrLocator, PrReviewService, PrReviewer,
    PrThread, PullRequestChanges, PullRequestReview, SearchPullRequestMentionsInput,
    SetPullRequestThreadStatusInput, SubmitPullRequestVoteInput,
};
use prs::{
    ListMyReviewPullRequestsInput, PullRequestService, PullRequestSummary,
    ReviewPullRequestSummary, SearchPullRequestsInput,
};
use search::{SearchAllInput, SearchAllResult};
use secrets::SecretStore;
use settings::{
    normalize_app_settings, GetReviewResultPreviewInput, ReviewResultPreview, SettingsService,
    UpdateAppSettingsInput,
};
use sync::{SyncRunner, SyncScope, SyncTrigger};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::{mpsc, oneshot};
use work_items::{
    AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult, DeleteWorkItemCommentInput,
    FetchWorkItemImageInput, GetSavedQueryInput, GetWorkItemPreviewInput, ListMyWorkItemsInput,
    ListWorkItemFieldAllowedValuesInput, ListWorkItemFieldsInput, ListWorkItemProjectsInput,
    ListWorkItemTypeStatesInput, ListWorkItemUpdatesInput, MentionCandidate,
    RecordAssigneeInteractionInput, RecordMentionInteractionInput, RunWorkItemQueryInput,
    SavedQueryResult, SearchWorkItemAssigneesInput, SearchWorkItemMentionsInput,
    SearchWorkItemsInput, SetWorkItemsPriorityInput, SetWorkItemsStateInput,
    UpdateWorkItemFieldsInput, WorkItemAssigneeCandidate, WorkItemComment, WorkItemFieldOption,
    WorkItemImage, WorkItemPreview, WorkItemProjectOption, WorkItemService, WorkItemSummary,
    WorkItemUpdateSummary,
};

#[derive(Clone)]
struct AppState {
    db: AppDatabase,
    organizations: OrganizationService,
    pull_requests: PullRequestService,
    pr_review: PrReviewService,
    work_items: WorkItemService,
    commits: CommitService,
    settings: SettingsService,
    sync_trigger: mpsc::Sender<SyncTrigger>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriggerSyncInput {
    scope: Option<SyncScope>,
}

// Keeps SQLite and file I/O off the main thread, where synchronous Tauri
// commands would otherwise block the UI event loop.
async fn run_blocking<T, F>(task: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Database(format!("background task failed: {error}")))?
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_organizations(state: State<'_, AppState>) -> Result<Vec<Organization>> {
    let service = state.organizations.clone();
    run_blocking(move || service.list()).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    let service = state.settings.clone();
    run_blocking(move || service.get()).await
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
async fn get_review_result_preview(
    input: GetReviewResultPreviewInput,
    state: State<'_, AppState>,
) -> Result<Option<ReviewResultPreview>> {
    let service = state.settings.clone();
    run_blocking(move || service.review_result_preview(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_sync_states(state: State<'_, AppState>) -> Result<Vec<SyncState>> {
    let db = state.db.clone();
    run_blocking(move || db.list_sync_states()).await
}

fn ensure_write_enabled(state: &State<'_, AppState>) -> Result<()> {
    if state.settings.get()?.read_only_validation_mode_enabled {
        return Err(AppError::InvalidInput(
            "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps."
                .to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn delete_organization(id: String, state: State<'_, AppState>) -> Result<()> {
    let service = state.organizations.clone();
    run_blocking(move || service.delete(&id)).await
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
    let service = state.pull_requests.clone();
    run_blocking(move || service.search(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_my_review_pull_requests(
    input: ListMyReviewPullRequestsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReviewPullRequestSummary>> {
    let service = state.pull_requests.clone();
    run_blocking(move || service.list_my_reviews(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_pull_request_review(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestReview> {
    state.pr_review.get_review(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_pull_request_changes(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<PullRequestChanges> {
    state.pr_review.list_changes(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_pull_request_file_diff(
    input: GetPullRequestFileDiffInput,
    state: State<'_, AppState>,
) -> Result<PrFileDiff> {
    state.pr_review.get_file_diff(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_pull_request_commits(
    input: PrLocator,
    state: State<'_, AppState>,
) -> Result<Vec<PrCommit>> {
    state.pr_review.list_commits(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn post_pull_request_comment(
    input: PostPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state)?;
    state.pr_review.post_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn set_pull_request_thread_status(
    input: SetPullRequestThreadStatusInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state)?;
    state.pr_review.set_thread_status(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn submit_pull_request_vote(
    input: SubmitPullRequestVoteInput,
    state: State<'_, AppState>,
) -> Result<PrReviewer> {
    ensure_write_enabled(&state)?;
    state.pr_review.submit_vote(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_pull_request_mentions(
    input: SearchPullRequestMentionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>> {
    state.pr_review.search_mentions(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn edit_pull_request_comment(
    input: EditPullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<PrThread> {
    ensure_write_enabled(&state)?;
    state.pr_review.edit_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn delete_pull_request_comment(
    input: DeletePullRequestCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state)?;
    state.pr_review.delete_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_all(input: SearchAllInput, state: State<'_, AppState>) -> Result<SearchAllResult> {
    let db = state.db.clone();
    let work_items = state.work_items.clone();
    let pull_requests = state.pull_requests.clone();
    let commits = state.commits.clone();
    run_blocking(move || search::search_all(&db, &work_items, &pull_requests, &commits, input))
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_work_items(
    input: SearchWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    let service = state.work_items.clone();
    run_blocking(move || service.search(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_my_work_items(
    input: ListMyWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    let service = state.work_items.clone();
    run_blocking(move || service.list_my(input)).await
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
async fn count_work_item_query(
    input: RunWorkItemQueryInput,
    state: State<'_, AppState>,
) -> Result<usize> {
    state.work_items.count_query(input).await
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
async fn record_mention_interaction(
    input: RecordMentionInteractionInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.record_mention_interaction(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn record_assignee_interaction(
    input: RecordAssigneeInteractionInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.record_assignee_interaction(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_work_item_assignees(
    input: SearchWorkItemAssigneesInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemAssigneeCandidate>> {
    state.work_items.search_assignees(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn fetch_work_item_image(
    input: FetchWorkItemImageInput,
    state: State<'_, AppState>,
) -> Result<WorkItemImage> {
    state.work_items.fetch_image(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn add_work_item_comment(
    input: AddWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<WorkItemComment> {
    ensure_write_enabled(&state)?;
    state.work_items.add_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn delete_work_item_comment(
    input: DeleteWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state)?;
    state.work_items.delete_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_work_item_updates(
    input: ListWorkItemUpdatesInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemUpdateSummary>> {
    state.work_items.list_updates(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn set_work_items_state(
    input: SetWorkItemsStateInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state)?;
    state.work_items.set_items_state(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn assign_work_items(
    input: AssignWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state)?;
    state.work_items.assign_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn set_work_items_priority(
    input: SetWorkItemsPriorityInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state)?;
    state.work_items.set_items_priority(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn update_work_item_fields(
    input: UpdateWorkItemFieldsInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    ensure_write_enabled(&state)?;
    state.work_items.update_fields(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_work_item_field_allowed_values(
    input: ListWorkItemFieldAllowedValuesInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    state.work_items.list_field_allowed_values(input).await
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
async fn list_work_item_fields(
    input: ListWorkItemFieldsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemFieldOption>> {
    state.work_items.list_fields(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn get_saved_query(
    input: GetSavedQueryInput,
    state: State<'_, AppState>,
) -> Result<SavedQueryResult> {
    state.work_items.get_saved_query(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn search_commits(
    input: SearchCommitsInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitSummary>> {
    let service = state.commits.clone();
    run_blocking(move || service.search(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_commit_repositories(
    input: ListCommitRepositoriesInput,
    state: State<'_, AppState>,
) -> Result<Vec<CommitRepositoryOption>> {
    let service = state.commits.clone();
    run_blocking(move || service.list_repositories(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn trigger_sync(input: Option<TriggerSyncInput>, state: State<'_, AppState>) -> Result<()> {
    let (tx, rx) = oneshot::channel();
    state
        .sync_trigger
        .send(SyncTrigger {
            scope: input
                .and_then(|input| input.scope)
                .unwrap_or(SyncScope::All),
            done: tx,
        })
        .await
        .map_err(|error| AppError::InvalidInput(format!("sync runner stopped: {error}")))?;
    rx.await
        .map_err(|error| AppError::InvalidInput(format!("sync runner stopped: {error}")))?;
    Ok(())
}

fn configure_show_window_hotkey(app: &AppHandle, hotkey: Option<&str>) -> Result<()> {
    let shortcut = parse_show_window_hotkey(hotkey)?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;

    let Some(shortcut) = shortcut else {
        return Ok(());
    };
    app.global_shortcut()
        .register(shortcut)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    Ok(())
}

fn parse_show_window_hotkey(hotkey: Option<&str>) -> Result<Option<Shortcut>> {
    let Some(hotkey) = hotkey.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    Shortcut::from_str(hotkey)
        .map(Some)
        .map_err(|error| AppError::InvalidInput(format!("show window hotkey is invalid: {error}")))
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
        .plugin(tauri_plugin_notification::init())
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
                db: db.clone(),
                organizations: OrganizationService::new(db.clone(), SecretStore),
                pull_requests: PullRequestService::new(db.clone(), SecretStore),
                pr_review: PrReviewService::new(db.clone(), SecretStore),
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
            list_sync_states,
            delete_organization,
            add_pat_organization,
            add_azure_cli_organization,
            search_pull_requests,
            list_my_review_pull_requests,
            get_pull_request_review,
            list_pull_request_changes,
            get_pull_request_file_diff,
            list_pull_request_commits,
            post_pull_request_comment,
            set_pull_request_thread_status,
            submit_pull_request_vote,
            search_pull_request_mentions,
            edit_pull_request_comment,
            delete_pull_request_comment,
            search_all,
            search_work_items,
            list_my_work_items,
            list_work_item_projects,
            run_work_item_query,
            count_work_item_query,
            get_work_item_preview,
            search_work_item_mentions,
            record_mention_interaction,
            record_assignee_interaction,
            search_work_item_assignees,
            fetch_work_item_image,
            add_work_item_comment,
            delete_work_item_comment,
            update_work_item_fields,
            list_work_item_updates,
            list_work_item_field_allowed_values,
            list_work_item_type_states,
            list_work_item_fields,
            get_saved_query,
            set_work_items_state,
            assign_work_items,
            set_work_items_priority,
            search_commits,
            list_commit_repositories,
            trigger_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_show_window_hotkey_validates_before_registration_changes() {
        assert!(parse_show_window_hotkey(Some("Ctrl+Alt+D"))
            .unwrap()
            .is_some());
        assert!(parse_show_window_hotkey(Some("   ")).unwrap().is_none());
        assert!(parse_show_window_hotkey(Some("not a shortcut")).is_err());
    }

    #[test]
    fn trigger_sync_input_rejects_unknown_scope() {
        assert!(serde_json::from_value::<TriggerSyncInput>(json!({
            "scope": "myReviews"
        }))
        .is_ok());
        assert!(serde_json::from_value::<TriggerSyncInput>(json!({
            "scope": "notARealScope"
        }))
        .is_err());
    }
}
