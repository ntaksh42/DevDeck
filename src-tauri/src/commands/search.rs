use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::search::{SearchAllInput, SearchAllResult};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_all(
    input: SearchAllInput,
    state: State<'_, AppState>,
) -> Result<SearchAllResult> {
    state.provider().await?.search_all(input).await
}
