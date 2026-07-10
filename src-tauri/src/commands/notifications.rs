use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::app_state::{run_blocking, AppState};
use crate::db::{NewNotification, NotificationPage};
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotificationsInput {
    pub limit: u32,
    #[serde(default)]
    pub before_id: Option<i64>,
    #[serde(default)]
    pub unread_only: Option<bool>,
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    #[serde(default)]
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsReadInput {
    pub ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordNotificationInput {
    #[serde(default)]
    pub organization_id: Option<String>,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub payload: Value,
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_notifications(
    input: ListNotificationsInput,
    state: State<'_, AppState>,
) -> Result<NotificationPage> {
    let db = state.db.clone();
    run_blocking(move || {
        db.list_notifications(
            input.limit,
            input.before_id,
            input.unread_only.unwrap_or(false),
            input.kinds.as_deref(),
            input.organization_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_unread_notifications_count(state: State<'_, AppState>) -> Result<i64> {
    let db = state.db.clone();
    run_blocking(move || db.unread_notifications_count()).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn mark_notifications_read(
    input: MarkNotificationsReadInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let db = state.db.clone();
    run_blocking(move || db.mark_notifications_read(&input.ids)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn mark_all_notifications_read(state: State<'_, AppState>) -> Result<()> {
    let db = state.db.clone();
    run_blocking(move || db.mark_all_notifications_read()).await
}

// Lets the frontend record its own notification-worthy events (e.g. pipeline
// watch alerts) into the same history the sync loop writes to.
#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn record_notification(
    input: RecordNotificationInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let db = state.db.clone();
    let record = NewNotification {
        organization_id: input.organization_id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        payload: input.payload,
    };
    run_blocking(move || db.insert_notifications(&[record])).await?;
    if let Err(e) = app.emit("notifications:inbox-updated", serde_json::json!({})) {
        tracing::warn!(error = ?e, "failed to emit notification inbox update");
    }
    Ok(())
}
