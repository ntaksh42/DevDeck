use std::str::FromStr;

mod app_state;
mod auth;
mod cancellation;
mod code_browse;
mod code_search;
mod commands;
mod commits;
mod db;
mod error;
mod github;
mod orgs;
mod pipelines;
mod pr_review;
mod projects;
mod providers;
mod prs;
mod search;
mod secrets;
mod settings;
mod snooze;
mod sync;
mod work_items;

use app_state::AppState;
use cancellation::CancellationRegistry;
use code_browse::CodeBrowseService;
use code_search::CodeSearchService;
use commits::CommitService;
use db::AppDatabase;
use error::{AppError, Result};
use orgs::OrganizationService;
use pipelines::PipelineService;
use pr_review::PrReviewService;
use prs::PullRequestService;
use secrets::SecretStore;
use settings::SettingsService;
use snooze::SnoozeService;
use sync::SyncRunner;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use work_items::WorkItemService;

pub(crate) fn configure_show_window_hotkey(app: &AppHandle, hotkey: Option<&str>) -> Result<()> {
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
    // Without this, a panic during startup leaves only a blank window and no
    // trace of why. Print it to stderr (visible under `tauri dev` / a console
    // build) before the default hook aborts.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("DevDeck panic: {info}");
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            // Surface setup failures (e.g. a failed DB migration) to stderr;
            // otherwise the window stays blank with no clue why state was never
            // managed and every command fails.
            let app_data_dir = app.path().app_data_dir().inspect_err(|e| {
                eprintln!("DevDeck setup failed (app_data_dir): {e}");
            })?;
            let db = AppDatabase::new(app_data_dir.join("azdodeck.sqlite3"));
            db.initialize().inspect_err(|e| {
                eprintln!("DevDeck setup failed (db.initialize): {e}");
            })?;
            let settings = db.get_app_settings().inspect_err(|e| {
                eprintln!("DevDeck setup failed (get_app_settings): {e}");
            })?;
            configure_show_window_hotkey(app.handle(), settings.show_window_hotkey.as_deref())
                .inspect_err(|e| {
                    eprintln!("DevDeck setup failed (configure_show_window_hotkey): {e}");
                })?;
            let (sync_tx, sync_rx) = SyncRunner::channel();
            app.manage(AppState {
                db: db.clone(),
                organizations: OrganizationService::new(db.clone(), SecretStore),
                pull_requests: PullRequestService::new(db.clone(), SecretStore),
                pr_review: PrReviewService::new(db.clone(), SecretStore),
                work_items: WorkItemService::new(db.clone(), SecretStore),
                commits: CommitService::new(db.clone(), SecretStore),
                pipelines: PipelineService::new(db.clone(), SecretStore),
                code_search: CodeSearchService::new(db.clone(), SecretStore),
                code_browse: CodeBrowseService::new(db.clone(), SecretStore),
                settings: SettingsService::new(db.clone()),
                snooze: SnoozeService::new(db.clone()),
                cancellation: CancellationRegistry::new(),
                sync_trigger: sync_tx,
                active_provider: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
            });
            tauri::async_runtime::spawn(
                SyncRunner::new(db, SecretStore).run(app.handle().clone(), sync_rx),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::orgs::list_organizations,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::settings::get_review_result_preview,
            commands::settings::list_sync_states,
            commands::snooze::snooze_item,
            commands::snooze::unsnooze_item,
            commands::snooze::list_snoozed_items,
            commands::orgs::delete_organization,
            commands::orgs::add_pat_organization,
            commands::orgs::add_azure_cli_organization,
            commands::orgs::add_github_organization,
            commands::orgs::get_active_organization,
            commands::orgs::set_active_organization,
            commands::orgs::get_provider_capabilities,
            commands::prs::search_pull_requests,
            commands::prs::list_my_review_pull_requests,
            commands::prs::list_my_created_pull_requests,
            commands::pr_review::get_pull_request_review,
            commands::pr_review::list_pull_request_changes,
            commands::pr_review::get_pull_request_file_diff,
            commands::pr_review::list_pull_request_commits,
            commands::pr_review::post_pull_request_comment,
            commands::pr_review::set_pull_request_thread_status,
            commands::pr_review::submit_pull_request_vote,
            commands::pr_review::update_pull_request,
            commands::pr_review::set_pull_request_reviewer_required,
            commands::pr_review::remove_pull_request_reviewer,
            commands::pr_review::update_pull_request_details,
            commands::pr_review::search_pull_request_mentions,
            commands::pr_review::edit_pull_request_comment,
            commands::pr_review::delete_pull_request_comment,
            commands::search::search_all,
            commands::work_items::search_work_items,
            commands::work_items::list_my_work_items,
            commands::work_items::list_work_item_projects,
            commands::work_items::run_work_item_query,
            commands::work_items::count_work_item_query,
            commands::work_items::get_work_item_preview,
            commands::work_items::search_work_item_mentions,
            commands::work_items::record_mention_interaction,
            commands::work_items::record_assignee_interaction,
            commands::work_items::search_work_item_assignees,
            commands::work_items::fetch_work_item_image,
            commands::work_items::add_work_item_comment,
            commands::work_items::add_work_item_link,
            commands::work_items::remove_work_item_link,
            commands::work_items::delete_work_item_comment,
            commands::work_items::update_work_item_comment,
            commands::work_items::set_work_item_comment_reaction,
            commands::work_items::update_work_item_fields,
            commands::work_items::list_work_item_updates,
            commands::work_items::list_work_item_field_allowed_values,
            commands::work_items::list_work_item_type_states,
            commands::work_items::list_work_item_fields,
            commands::work_items::list_classification_nodes,
            commands::work_items::get_saved_query,
            commands::work_items::set_work_items_state,
            commands::work_items::assign_work_items,
            commands::work_items::set_work_items_priority,
            commands::work_items::set_work_items_tags,
            commands::commits::search_commits,
            commands::commits::list_commit_repositories,
            commands::commits::commit_activity,
            commands::code::search_code,
            commands::code::get_code_search_context,
            commands::code::list_repo_branches,
            commands::code::list_repo_tree,
            commands::code::get_repo_file,
            commands::code::list_repo_history,
            commands::code::cancel_operation,
            commands::commits::get_commit_changes,
            commands::commits::get_commit_file_diff,
            commands::commits::get_commit_pull_requests,
            commands::commits::get_commit_parents,
            commands::pipelines::list_pipeline_projects,
            commands::pipelines::list_pipeline_runs,
            commands::pipelines::list_pipeline_definitions,
            commands::pipelines::get_pipeline_run,
            commands::pipelines::list_pipeline_artifacts,
            commands::pipelines::get_pipeline_definition,
            commands::pipelines::get_pipeline_run_log_tail,
            commands::pipelines::rerun_pipeline_run,
            commands::pipelines::queue_pipeline_run,
            commands::pipelines::cancel_pipeline_run,
            commands::pipelines::list_pipeline_approvals,
            commands::pipelines::update_pipeline_approval,
            commands::sync::trigger_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_show_window_hotkey_validates_before_registration_changes() {
        assert!(parse_show_window_hotkey(Some("Ctrl+Alt+D"))
            .unwrap()
            .is_some());
        assert!(parse_show_window_hotkey(Some("   ")).unwrap().is_none());
        assert!(parse_show_window_hotkey(Some("not a shortcut")).is_err());
    }
}
