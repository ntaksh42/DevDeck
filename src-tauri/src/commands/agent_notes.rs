use serde::Deserialize;
use tauri::State;

use crate::agent_notes::{
    AgentAsk, AgentNote, AgentNoteSummary, CreateAgentNoteInput, DeleteAgentNoteInput,
    ListAgentNotesInput, NoteTarget, PostAgentProposalInput, ReplyAgentNoteInput,
    RestoreAgentNoteInput, RunAgentInput, SetAgentNoteStatusInput, SubmitAgentNoteDraftsInput,
    SummarizeAgentNotesInput, UpdateAgentNoteInput,
};
use crate::app_state::{ensure_write_enabled, run_blocking, AppState};
use crate::error::{AppError, Result};
use crate::pr_review::{PostPullRequestCommentInput, PrLocator};
use crate::work_items::AddWorkItemCommentInput;

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

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_agent_asks(state: State<'_, AppState>) -> Result<Vec<AgentAsk>> {
    let service = state.agent_notes.clone();
    run_blocking(move || service.list_asks()).await
}

/// A proposed agent comment to post, with where it goes. The target must be
/// the note's own item: the locator is checked against the note's id.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostAgentCommentInput {
    #[serde(flatten)]
    pub proposal: PostAgentProposalInput,
    pub organization_id: Option<String>,
    pub project_id: String,
    /// Pull request notes only.
    pub repository_id: Option<String>,
    /// Pull request notes only: reply in this thread instead of opening one.
    pub thread_id: Option<i64>,
}

/// Posts a comment the agent proposed in a note, signed with the agent's name,
/// and records it in the note so it is posted once.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn post_agent_comment(
    input: PostAgentCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    let proposal = input.proposal.clone();
    let service = state.agent_notes.clone();
    let prepared = run_blocking(move || service.prepare_post(proposal)).await?;

    let provider = state.provider().await?;
    let reference = match input.proposal.target {
        NoteTarget::PullRequest => {
            let repository_id = input.repository_id.ok_or_else(|| {
                AppError::InvalidInput("repositoryId is required for a pull request".to_string())
            })?;
            let thread = provider
                .post_pull_request_comment(PostPullRequestCommentInput {
                    pr: PrLocator {
                        organization_id: input.organization_id,
                        project_id: input.project_id,
                        repository_id,
                        pull_request_id: input.proposal.item_id,
                    },
                    thread_id: input.thread_id,
                    content: prepared.body.clone(),
                    file_path: None,
                    right_line: None,
                    left_line: None,
                })
                .await?;
            format!("thread-{}", thread.id)
        }
        NoteTarget::WorkItem => {
            let comment = provider
                .add_work_item_comment(AddWorkItemCommentInput {
                    organization_id: input.organization_id,
                    project_id: input.project_id,
                    work_item_id: input.proposal.item_id,
                    markdown: prepared.body.clone(),
                })
                .await?;
            format!("comment-{}", comment.id)
        }
        NoteTarget::Ask => unreachable!("prepare_post rejects ask notes"),
    };
    let service = state.agent_notes.clone();
    run_blocking(move || service.record_posted(prepared, &reference)).await
}
