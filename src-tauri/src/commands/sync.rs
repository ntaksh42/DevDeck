use tauri::State;
use tokio::sync::oneshot;

use crate::app_state::{AppState, TriggerSyncInput};
use crate::error::{AppError, Result};
use crate::sync::{SyncScope, SyncTrigger};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn trigger_sync(
    input: Option<TriggerSyncInput>,
    state: State<'_, AppState>,
) -> Result<()> {
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
