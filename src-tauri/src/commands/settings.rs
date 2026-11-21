use tauri::{AppHandle, State};

use crate::app_state::{run_blocking, AppState};
use crate::configure_show_window_hotkey;
use crate::db::{AppSettings, SyncState};
use crate::error::Result;
use crate::settings::{
    normalize_app_settings, DiagnosticsExport, ExportDiagnosticsInput, GetReviewResultPreviewInput,
    GetWorkItemResultPreviewInput, ListResultItemIdsInput, ReviewResultPreview,
    UpdateAppSettingsInput, WorkItemResultPreview,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    let service = state.settings.clone();
    run_blocking(move || service.get()).await
}

#[tauri::command]
#[tracing::instrument(skip(state, input))]
pub fn update_app_settings(
    input: UpdateAppSettingsInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSettings> {
    let settings = normalize_app_settings(input);
    // A changed hotkey that cannot be registered is an error for the user to
    // fix. An unchanged one is only re-tried: if another app took it since
    // startup, that must not block saving unrelated settings.
    let current = state.settings.get()?.show_window_hotkey;
    let changed =
        current.as_deref().map(str::trim) != settings.show_window_hotkey.as_deref().map(str::trim);
    let registered = configure_show_window_hotkey(&app, settings.show_window_hotkey.as_deref());
    match registered {
        Err(e) if !changed => {
            tracing::warn!(error = ?e, "could not re-register the show window hotkey");
        }
        other => other?,
    }
    state.settings.update_normalized(settings)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_review_result_preview(
    input: GetReviewResultPreviewInput,
    state: State<'_, AppState>,
) -> Result<Option<ReviewResultPreview>> {
    let service = state.settings.clone();
    run_blocking(move || service.review_result_preview(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_result_item_ids(
    input: ListResultItemIdsInput,
    state: State<'_, AppState>,
) -> Result<Vec<i64>> {
    let service = state.settings.clone();
    run_blocking(move || service.result_item_ids(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_work_item_result_preview(
    input: GetWorkItemResultPreviewInput,
    state: State<'_, AppState>,
) -> Result<Option<WorkItemResultPreview>> {
    let service = state.settings.clone();
    run_blocking(move || service.work_item_result_preview(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_sync_states(state: State<'_, AppState>) -> Result<Vec<SyncState>> {
    let db = state.db.clone();
    run_blocking(move || db.list_sync_states()).await
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn export_diagnostics(
    input: ExportDiagnosticsInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<DiagnosticsExport> {
    let service = state.settings.clone();
    let app_version = app.package_info().version.to_string();
    run_blocking(move || service.export_diagnostics(input, app_version)).await
}
