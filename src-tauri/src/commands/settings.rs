use tauri::{AppHandle, State};

use crate::app_state::{run_blocking, AppState};
use crate::configure_show_window_hotkey;
use crate::db::{AppSettings, SyncState};
use crate::error::Result;
use crate::settings::{
    normalize_app_settings, GetReviewResultPreviewInput, ReviewResultPreview,
    UpdateAppSettingsInput,
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
    configure_show_window_hotkey(&app, settings.show_window_hotkey.as_deref())?;
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
pub async fn list_sync_states(state: State<'_, AppState>) -> Result<Vec<SyncState>> {
    let db = state.db.clone();
    run_blocking(move || db.list_sync_states()).await
}
