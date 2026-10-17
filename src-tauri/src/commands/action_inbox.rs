use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::app_state::{run_blocking, AppState};
use crate::db::{InboxCounts, InboxItem, InboxListState};
use crate::error::{AppError, Result};

const DEFAULT_LIST_LIMIT: u32 = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListActionInboxInput {
    /// `open`, `snoozed` or `done`.
    pub state: String,
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActionInboxStateInput {
    pub ids: Vec<i64>,
    /// `open`, `snoozed` or `done`.
    pub state: String,
    /// RFC 3339 deadline; required for `snoozed`.
    #[serde(default)]
    pub snoozed_until: Option<String>,
}

fn parse_list_state(value: &str) -> Result<InboxListState> {
    match value {
        "open" => Ok(InboxListState::Open),
        "snoozed" => Ok(InboxListState::Snoozed),
        "done" => Ok(InboxListState::Done),
        other => Err(AppError::InvalidInput(format!(
            "unknown inbox list state: {other}"
        ))),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_action_inbox_items(
    input: ListActionInboxInput,
    state: State<'_, AppState>,
) -> Result<Vec<InboxItem>> {
    let list_state = parse_list_state(&input.state)?;
    let db = state.db.clone();
    run_blocking(move || {
        db.list_inbox_items(
            input.organization_id.as_deref(),
            list_state,
            input.limit.unwrap_or(DEFAULT_LIST_LIMIT),
        )
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_action_inbox_counts(
    organization_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<InboxCounts> {
    let db = state.db.clone();
    run_blocking(move || db.inbox_counts(organization_id.as_deref())).await
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn set_action_inbox_item_state(
    input: SetActionInboxStateInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<usize> {
    let db = state.db.clone();
    let changed = run_blocking(move || {
        db.set_inbox_item_state(&input.ids, &input.state, input.snoozed_until.as_deref())
    })
    .await?;
    if changed > 0 {
        if let Err(e) = app.emit("action-inbox:updated", serde_json::json!({})) {
            tracing::warn!(error = ?e, "failed to emit action inbox update");
        }
    }
    Ok(changed)
}

/// Starts writing Claude's notes for one open Inbox item in the background; the
/// result arrives through `action-inbox:updated`.
#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn generate_action_inbox_insight(
    id: i64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let db = state.db.clone();
    run_blocking(move || {
        let settings = db.get_app_settings()?;
        crate::inbox_insight::start_one(&db, &settings, &app, id).map_err(AppError::InvalidInput)
    })
    .await
}
