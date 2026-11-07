use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::auto_agent::queue::{self, AutoQueueItem, AutoQueuePreview, AutoQueueTarget};
use crate::error::Result;

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
pub async fn run_auto_queue(
    input: Vec<AutoQueueTarget>,
    state: State<'_, AppState>,
) -> Result<usize> {
    let db = state.db.clone();
    run_blocking(move || queue::run(&db, input)).await
}
