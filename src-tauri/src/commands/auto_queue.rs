use tauri::State;

use crate::agent_notes::launch::AgentKind;
use crate::app_state::{run_blocking, AppState};
use crate::auto_agent::queue::{
    self, AutoQueueItem, AutoQueuePreview, AutoQueueTarget, WorkItemTarget,
};
use crate::auto_agent::work::{self, AgentWorkEntry, AgentWorkTarget, SetExcludedInput};
use crate::error::Result;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_agent_work(state: State<'_, AppState>) -> Result<Vec<AgentWorkEntry>> {
    let db = state.db.clone();
    run_blocking(move || work::list(&db)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn read_agent_work_log(
    input: AgentWorkTarget,
    state: State<'_, AppState>,
) -> Result<String> {
    let db = state.db.clone();
    run_blocking(move || work::read_log(&db, input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn retry_agent_work(input: AgentWorkTarget, state: State<'_, AppState>) -> Result<()> {
    let db = state.db.clone();
    run_blocking(move || work::retry(&db, input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_agent_work_excluded(
    input: SetExcludedInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let db = state.db.clone();
    run_blocking(move || work::set_excluded(&db, input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_auto_queue(state: State<'_, AppState>) -> Result<Vec<AutoQueueItem>> {
    let db = state.db.clone();
    run_blocking(move || queue::list(&db)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_auto_queue_preview(
    input: AutoQueueTarget,
    state: State<'_, AppState>,
) -> Result<AutoQueuePreview> {
    queue::preview(&state.db, input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn run_assigned_work_item_investigations(
    agent: Option<AgentKind>,
    state: State<'_, AppState>,
) -> Result<usize> {
    let db = state.db.clone();
    run_blocking(move || queue::run_assigned_work_items(&db, agent)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn run_work_item_investigations(
    input: Vec<WorkItemTarget>,
    agent: Option<AgentKind>,
    state: State<'_, AppState>,
) -> Result<usize> {
    let db = state.db.clone();
    run_blocking(move || queue::run_work_items(&db, input, agent)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn run_auto_queue(
    input: Vec<AutoQueueTarget>,
    focus: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize> {
    let db = state.db.clone();
    run_blocking(move || queue::run(&db, input, focus)).await
}
