use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::search::{self, SearchAllInput, SearchAllResult};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_all(
    input: SearchAllInput,
    state: State<'_, AppState>,
) -> Result<SearchAllResult> {
    let db = state.db.clone();
    let work_items = state.work_items.clone();
    let pull_requests = state.pull_requests.clone();
    let commits = state.commits.clone();
    search::search_all(&db, &work_items, &pull_requests, &commits, input).await
}
