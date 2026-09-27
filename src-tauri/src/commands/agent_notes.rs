use tauri::State;

use crate::agent_notes::{
    AgentNote, AgentNoteSummary, CreateAgentNoteInput, DeleteAgentNoteInput, ListAgentNotesInput,
    ReplyAgentNoteInput, RestoreAgentNoteInput, RunAgentInput, SetAgentNoteStatusInput,
    SubmitAgentNoteDraftsInput, SummarizeAgentNotesInput, UpdateAgentNoteInput,
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

#[tauri::command]
#[tracing::instrument(skip(state, input))]
pub async fn reply_agent_note(
    input: ReplyAgentNoteInput,
    state: State<'_, AppState>,
) -> Result<AgentNote> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.reply(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state, input))]
pub async fn update_agent_note(
    input: UpdateAgentNoteInput,
    state: State<'_, AppState>,
) -> Result<AgentNote> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.update(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_agent_note_status(
    input: SetAgentNoteStatusInput,
    state: State<'_, AppState>,
) -> Result<AgentNote> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.set_status(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn restore_agent_note(
    input: RestoreAgentNoteInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.restore(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn submit_agent_note_drafts(
    input: SubmitAgentNoteDraftsInput,
    state: State<'_, AppState>,
) -> Result<usize> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.submit_drafts(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn summarize_agent_notes(
    input: SummarizeAgentNotesInput,
    state: State<'_, AppState>,
) -> Result<Vec<AgentNoteSummary>> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.summarize(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn run_agent(input: RunAgentInput, state: State<'_, AppState>) -> Result<()> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.run_agent(input)).await
}
