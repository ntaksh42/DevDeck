//! Notes the user leaves for an external AI agent about a work item's
//! investigation result (or, for pull requests, a review result). Each note is
//! one Markdown file with a small front-matter block under
//! `{app_data}/agent-notes/{wi|pr}-{id}/`, outside the result folders so they
//! stay free of DevDeck's bookkeeping; the `AGENTS.md` guide in each result
//! folder points the agent there. The agent reads the open notes, acts on them,
//! and moves each file into the `_done/` subfolder. The files are the source of
//! truth -- nothing is stored in SQLite -- so the agent needs no access to
//! DevDeck. Notes still require the target's result folder to be set, since
//! they are about the result HTML in it.
//!
//! Besides the open folder and `_done/`, DevDeck keeps unsent drafts in
//! `_draft/` and deleted notes in `_trash/` (so a delete can be undone). The
//! agent only reads the `.md` files directly in the item folder.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::error::{AppError, Result};

mod asks;
mod create;
mod format;
mod guide;
mod launch;
mod migrate;
mod ops;
mod replies;
mod skill;
mod summary;

pub use asks::AgentAsk;
pub(crate) use guide::ensure_guide;
pub(crate) use migrate::migrate_legacy_notes;
pub use ops::{
    RestoreAgentNoteInput, SetAgentNoteStatusInput, SubmitAgentNoteDraftsInput,
    UpdateAgentNoteInput,
};
pub use replies::{NoteReply, ReplyAgentNoteInput};
pub(crate) use skill::ensure_skills;
pub use summary::{AgentNoteSummary, SummarizeAgentNotesInput};

use create::clean_body;
pub(crate) use create::create_note;
use format::parse_note;

/// Folder under the app data directory holding every item's notes.
const NOTES_ROOT: &str = "agent-notes";
const DONE_DIR: &str = "_done";
const DRAFT_DIR: &str = "_draft";
const TRASH_DIR: &str = "_trash";
const MAX_BODY_CHARS: usize = 20_000;
const MAX_QUOTE_CHARS: usize = 2_000;
const KINDS: [&str; 5] = ["fix", "question", "redo", "investigate", "summarize"];

/// What a note is about. Selects the result folder and the `wi-` / `pr-`
/// subfolder, and is written to the note's `target` front-matter field. `Ask`
/// is a free-standing request (from any view, about a pipeline run, a wiki
/// page or nothing in particular): its "item id" is a timestamp the frontend
/// picks, and it needs no result folder.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NoteTarget {
    WorkItem,
    PullRequest,
    Ask,
}

impl NoteTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::WorkItem => "work-item",
            Self::PullRequest => "pull-request",
            Self::Ask => "ask",
        }
    }

    fn dir_prefix(self) -> &'static str {
        match self {
            Self::WorkItem => "wi",
            Self::PullRequest => "pr",
            Self::Ask => "ask",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentNotesInput {
    pub target: NoteTarget,
    pub item_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub body: String,
    pub quote: Option<String>,
    pub quote_prefix: Option<String>,
    pub quote_suffix: Option<String>,
    /// Offset of the quote in the result's whitespace-free text; tells apart
    /// repeated occurrences of the same text.
    #[serde(default)]
    pub quote_offset: Option<i64>,
    pub result_file: Option<String>,
    /// Fingerprint of the result HTML the note was written against.
    #[serde(default)]
    pub result_hash: Option<String>,
    /// `fix`, `question`, `redo`, `investigate` or `summarize`.
    #[serde(default)]
    pub kind: Option<String>,
    /// One line telling the agent what the request is about (title, URL),
    /// for requests made outside a result.
    #[serde(default)]
    pub context: Option<String>,
    /// Markdown material DevDeck gathered about the subject (fields,
    /// comments, logs), saved under `_context/` for the agent to read.
    #[serde(default)]
    pub context_document: Option<String>,
    /// Saved to `_draft/` until the drafts are submitted together.
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAgentInput {
    pub target: NoteTarget,
    pub item_id: i64,
    /// Repository of the pull request, to start the agent in its clone inside
    /// the workspace folder.
    #[serde(default)]
    pub repository_name: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentNote {
    /// File name; unique within the item's folder.
    pub id: String,
    /// `open`, `done` (in `_done/`) or `draft` (in `_draft/`).
    pub status: String,
    pub created_at: String,
    /// File modification time; changes whenever the agent or user touches it.
    pub modified_at: Option<String>,
    pub body: String,
    pub quote: Option<String>,
    pub quote_prefix: Option<String>,
    pub quote_suffix: Option<String>,
    pub quote_offset: Option<i64>,
    pub result_file: Option<String>,
    pub result_hash: Option<String>,
    pub kind: Option<String>,
    pub context: Option<String>,
    /// Absolute path of the material saved with the note, if any.
    pub context_file: Option<String>,
    /// What the agent reported when it handled the note.
    pub resolved: Option<String>,
    /// Agent and user replies appended after the body, oldest first.
    pub replies: Vec<NoteReply>,
    pub file_path: String,
}

#[derive(Clone)]
pub struct AgentNoteService {
    db: AppDatabase,
}

impl AgentNoteService {
    pub fn new(db: AppDatabase) -> Self {
        Self { db }
    }

    pub fn list(&self, input: ListAgentNotesInput) -> Result<Vec<AgentNote>> {
        validate_id(input.item_id)?;
        match self.result_folder(input.target)? {
            Some(_) => list_notes(&self.notes_root(), input.target, input.item_id),
            None => Ok(Vec::new()),
        }
    }

    pub fn create(&self, input: CreateAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        create_note(&self.notes_root(), input, Local::now())
    }

    pub fn delete(&self, input: DeleteAgentNoteInput) -> Result<()> {
        validate_id(input.item_id)?;
        if self.result_folder(input.target)?.is_none() {
            return Ok(());
        }
        ops::trash_note(
            &self.notes_root(),
            input.target,
            input.item_id,
            &input.note_id,
        )
    }

    pub fn restore(&self, input: RestoreAgentNoteInput) -> Result<()> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        ops::restore_note(&self.notes_root(), input)
    }

    pub fn reply(&self, input: ReplyAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        replies::reply_note(&self.notes_root(), input, Local::now())
    }

    pub fn update(&self, input: UpdateAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        ops::update_note(&self.notes_root(), input)
    }

    pub fn set_status(&self, input: SetAgentNoteStatusInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        ops::set_status(&self.notes_root(), input)
    }

    pub fn submit_drafts(&self, input: SubmitAgentNoteDraftsInput) -> Result<usize> {
        validate_id(input.item_id)?;
        self.require_folder(input.target)?;
        ops::submit_drafts(&self.notes_root(), input.target, input.item_id)
    }

    /// Free-standing requests, most recently touched first.
    pub fn list_asks(&self) -> Result<Vec<AgentAsk>> {
        asks::list_asks(&self.notes_root())
    }

    pub fn summarize(&self, input: SummarizeAgentNotesInput) -> Result<Vec<AgentNoteSummary>> {
        match self.result_folder(input.target)? {
            Some(_) => summary::summarize(&self.notes_root(), input.target),
            None => Ok(Vec::new()),
        }
    }

    /// Starts the agent command from Settings for one item's notes.
    pub fn run_agent(&self, input: RunAgentInput) -> Result<()> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        let settings = self.db.get_app_settings()?;
        let workspace = match settings.agent_workspace_path.as_deref() {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_dir() {
                    return Err(AppError::InvalidInput(format!(
                        "agent workspace folder does not exist: {}",
                        path.display()
                    )));
                }
                Some(path)
            }
            None => None,
        };
        let notes_root = self.notes_root();
        if input.target == NoteTarget::Ask {
            ensure_guide(&folder, NoteTarget::Ask, &notes_root)?;
        }
        let context = launch::AgentLaunch {
            result_folder: &folder,
            notes_root: &notes_root,
            workspace: workspace.as_deref(),
            repository: input.repository_name.as_deref(),
        };
        launch::run_agent(
            &context,
            settings.agent_command.as_deref(),
            input.target,
            input.item_id,
        )
    }

    fn notes_root(&self) -> PathBuf {
        notes_root(&self.db)
    }

    fn require_folder(&self, target: NoteTarget) -> Result<PathBuf> {
        self.result_folder(target)?.ok_or_else(|| {
            AppError::InvalidInput(
                "Set a result folder in Settings to leave agent notes".to_string(),
            )
        })
    }

    /// Work item notes are about the investigation results, pull request
    /// notes about the review results.
    /// Free-standing requests use the notes root itself.
    fn result_folder(&self, target: NoteTarget) -> Result<Option<PathBuf>> {
        let settings = self.db.get_app_settings()?;
        let path = match target {
            NoteTarget::WorkItem => settings.work_item_result_folder_path,
            NoteTarget::PullRequest => settings.review_result_folder_path,
            NoteTarget::Ask => {
                let root = self.notes_root();
                fs::create_dir_all(&root)?;
                return Ok(Some(root));
            }
        };
        let Some(path) = path else {
            return Ok(None);
        };
        let folder = PathBuf::from(path);
        if !folder.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "result folder does not exist: {}",
                folder.display()
            )));
        }
        Ok(Some(folder))
    }
}

fn validate_id(item_id: i64) -> Result<()> {
    if item_id <= 0 {
        return Err(AppError::InvalidInput(
            "itemId must be greater than zero".to_string(),
        ));
    }
    Ok(())
}

/// Where every item's notes live: beside the app's database.
pub(crate) fn notes_root(db: &AppDatabase) -> PathBuf {
    db.data_dir().join(NOTES_ROOT)
}

fn notes_dir(root: &Path, target: NoteTarget, item_id: i64) -> PathBuf {
    root.join(format!("{}-{item_id}", target.dir_prefix()))
}

pub(crate) fn list_notes(
    folder: &Path,
    target: NoteTarget,
    item_id: i64,
) -> Result<Vec<AgentNote>> {
    let dir = notes_dir(folder, target, item_id);
    ops::purge_old_trash(&dir.join(TRASH_DIR));
    let mut notes = read_notes_in(&dir, "open")?;
    notes.extend(read_notes_in(&dir.join(DONE_DIR), "done")?);
    notes.extend(read_notes_in(&dir.join(DRAFT_DIR), "draft")?);
    notes.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    Ok(notes)
}

fn read_notes_in(dir: &Path, status: &str) -> Result<Vec<AgentNote>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut notes = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if !is_note_file(&path) {
            continue;
        }
        // The agent moves handled notes into `_done/` while DevDeck polls, so a
        // file listed a moment ago may be gone; skip it instead of failing the
        // whole listing. Hand-written notes may also not be valid UTF-8.
        let (bytes, metadata) = match fs::read(&path).and_then(|b| Ok((b, fs::metadata(&path)?))) {
            Ok(read) => read,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err.into()),
        };
        let text = String::from_utf8_lossy(&bytes);
        let modified = metadata.modified().ok().map(|time| {
            DateTime::<Local>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
        });
        notes.push(parse_note(&path, status, &text, modified));
    }
    Ok(notes)
}

fn is_note_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// Note ids are bare file names; reject anything that could leave the folder.
fn validate_note_id(note_id: &str) -> Result<()> {
    let is_plain_name = !note_id.is_empty()
        && !note_id.contains(['/', '\\', ':'])
        && note_id != "."
        && note_id != ".."
        && note_id.to_ascii_lowercase().ends_with(".md");
    if !is_plain_name {
        return Err(AppError::InvalidInput(format!(
            "invalid note id: {note_id}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_ops;
