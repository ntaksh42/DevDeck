use tauri::State;

use crate::app_state::{run_blocking, AppState};
use crate::error::Result;
use crate::snooze::{
    ListSnoozedItemsInput, SnoozeItemInput, SnoozedItemSummary, UnsnoozeItemInput,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn snooze_item(input: SnoozeItemInput, state: State<'_, AppState>) -> Result<()> {
    let service = state.snooze.clone();
    run_blocking(move || service.snooze_item(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn unsnooze_item(input: UnsnoozeItemInput, state: State<'_, AppState>) -> Result<()> {
    let service = state.snooze.clone();
    run_blocking(move || service.unsnooze_item(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_snoozed_items(
    input: ListSnoozedItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<SnoozedItemSummary>> {
    let service = state.snooze.clone();
    run_blocking(move || service.list_snoozed_items(input)).await
}
