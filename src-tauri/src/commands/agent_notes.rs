use tauri::State;

use crate::agent_notes::{
    AgentNote, CreateAgentNoteInput, DeleteAgentNoteInput, ListAgentNotesInput,
};
use crate::app_state::{run_blocking, AppState};
use crate::error::Result;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_agent_notes(
    input: ListAgentNotesInput,
    state: State<'_, AppState>,
) -> Result<Vec<AgentNote>> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.list(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state, input))]
pub async fn create_agent_note(
    input: CreateAgentNoteInput,
    state: State<'_, AppState>,
) -> Result<AgentNote> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.create(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_agent_note(
    input: DeleteAgentNoteInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.delete(input)).await
}
