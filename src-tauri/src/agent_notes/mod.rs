//! Notes the user leaves for an external AI agent about a work item's
//! investigation result (or, for pull requests, a review result). Each note is
//! one Markdown file with a small front-matter block under
//! `{result_folder}/.to-agent-msg/{wi|pr}-{id}/`, where the result folder is the
//! work item or review result folder from Settings; the agent reads the open
//! notes, acts on them, and moves each file into the `_done/` subfolder. The
//! files are the source of truth -- nothing is stored in SQLite -- so the agent
//! needs no access to DevDeck.
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

mod format;
mod guide;
mod launch;
mod ops;
mod replies;
mod summary;

pub(crate) use guide::ensure_guide;
pub use ops::{
    RestoreAgentNoteInput, SetAgentNoteStatusInput, SubmitAgentNoteDraftsInput,
    UpdateAgentNoteInput,
};
pub use replies::{NoteReply, ReplyAgentNoteInput};
pub use summary::{AgentNoteSummary, SummarizeAgentNotesInput};

use format::{parse_note, write_atomic};

const NOTES_DIR: &str = ".to-agent-msg";
const DONE_DIR: &str = "_done";
const DRAFT_DIR: &str = "_draft";
const TRASH_DIR: &str = "_trash";
const MAX_BODY_CHARS: usize = 20_000;
const MAX_QUOTE_CHARS: usize = 2_000;
const KINDS: [&str; 3] = ["fix", "question", "redo"];

/// What a note is about. Selects the result folder and the `wi-` / `pr-`
/// subfolder, and is written to the note's `target` front-matter field.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NoteTarget {
    WorkItem,
    PullRequest,
}

impl NoteTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::WorkItem => "work-item",
            Self::PullRequest => "pull-request",
        }
    }

    fn dir_prefix(self) -> &'static str {
        match self {
            Self::WorkItem => "wi",
            Self::PullRequest => "pr",
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
    /// `fix`, `question` or `redo`.
    #[serde(default)]
    pub kind: Option<String>,
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
            Some(folder) => list_notes(&folder, input.target, input.item_id),
            None => Ok(Vec::new()),
        }
    }

    pub fn create(&self, input: CreateAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        create_note(&folder, input, Local::now())
    }

    pub fn delete(&self, input: DeleteAgentNoteInput) -> Result<()> {
        validate_id(input.item_id)?;
        let Some(folder) = self.result_folder(input.target)? else {
            return Ok(());
        };
        ops::trash_note(&folder, input.target, input.item_id, &input.note_id)
    }

    pub fn restore(&self, input: RestoreAgentNoteInput) -> Result<()> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        ops::restore_note(&folder, input)
    }

    pub fn reply(&self, input: ReplyAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        replies::reply_note(&folder, input, Local::now())
    }

    pub fn update(&self, input: UpdateAgentNoteInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        ops::update_note(&folder, input)
    }

    pub fn set_status(&self, input: SetAgentNoteStatusInput) -> Result<AgentNote> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        ops::set_status(&folder, input)
    }

    pub fn submit_drafts(&self, input: SubmitAgentNoteDraftsInput) -> Result<usize> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        ops::submit_drafts(&folder, input.target, input.item_id)
    }

    pub fn summarize(&self, input: SummarizeAgentNotesInput) -> Result<Vec<AgentNoteSummary>> {
        match self.result_folder(input.target)? {
            Some(folder) => summary::summarize(&folder, input.target),
            None => Ok(Vec::new()),
        }
    }

    /// Starts the agent command from Settings for one item's notes.
    pub fn run_agent(&self, input: RunAgentInput) -> Result<()> {
        validate_id(input.item_id)?;
        let folder = self.require_folder(input.target)?;
        let command = self.db.get_app_settings()?.agent_command;
        launch::run_agent(&folder, command.as_deref(), input.target, input.item_id)
    }

    fn require_folder(&self, target: NoteTarget) -> Result<PathBuf> {
        self.result_folder(target)?.ok_or_else(|| {
            AppError::InvalidInput(
                "Set a result folder in Settings to leave agent notes".to_string(),
            )
        })
    }

    /// Work item notes live beside the investigation results, pull request
    /// notes beside the review results.
    fn result_folder(&self, target: NoteTarget) -> Result<Option<PathBuf>> {
        let settings = self.db.get_app_settings()?;
        let path = match target {
            NoteTarget::WorkItem => settings.work_item_result_folder_path,
            NoteTarget::PullRequest => settings.review_result_folder_path,
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

fn notes_dir(folder: &Path, target: NoteTarget, item_id: i64) -> PathBuf {
    folder
        .join(NOTES_DIR)
        .join(format!("{}-{item_id}", target.dir_prefix()))
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

pub(crate) fn create_note(
    folder: &Path,
    input: CreateAgentNoteInput,
    now: DateTime<Local>,
) -> Result<AgentNote> {
    let body = clean_body(&input.body)?;
    let clean = |value: Option<String>, max: usize| {
        value
            .map(|value| value.trim().chars().take(max).collect::<String>())
            .filter(|value| !value.is_empty())
    };
    let quote = clean(input.quote, MAX_QUOTE_CHARS);
    let (quote_prefix, quote_suffix, quote_offset) = if quote.is_some() {
        (
            clean(input.quote_prefix, 64),
            clean(input.quote_suffix, 64),
            input.quote_offset.filter(|offset| *offset >= 0),
        )
    } else {
        (None, None, None)
    };
    let result_file = clean(input.result_file, 260);
    let result_hash = clean(input.result_hash, 64);
    let kind = validate_kind(input.kind)?;

    let mut dir = notes_dir(folder, input.target, input.item_id);
    if input.draft {
        dir = dir.join(DRAFT_DIR);
    }
    fs::create_dir_all(&dir)?;
    let stamp = now.format("%Y%m%d-%H%M%S").to_string();
    let path = ops::unique_path(&dir, &stamp)?;

    let created_at = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let json = |value: &str| serde_json::to_string(value).unwrap_or_default();
    let mut text = format!(
        "---\ntarget: {}\nid: {}\ncreated: {created_at}\n",
        input.target.as_str(),
        input.item_id
    );
    if let Some(kind) = &kind {
        text.push_str(&format!("kind: {kind}\n"));
    }
    for (key, value) in [
        ("result_file", &result_file),
        ("result_hash", &result_hash),
        ("quote", &quote),
        ("quote_prefix", &quote_prefix),
        ("quote_suffix", &quote_suffix),
    ] {
        if let Some(value) = value {
            text.push_str(&format!("{key}: {}\n", json(value)));
        }
    }
    if let Some(offset) = quote_offset {
        text.push_str(&format!("quote_offset: {offset}\n"));
    }
    text.push_str(&format!("---\n{body}\n"));
    write_atomic(&path, &text)?;

    let status = if input.draft { "draft" } else { "open" };
    Ok(parse_note(&path, status, &text, Some(created_at)))
}

fn clean_body(body: &str) -> Result<&str> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::InvalidInput("note body is empty".to_string()));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::InvalidInput("note body is too long".to_string()));
    }
    replies::reject_markers(body)?;
    Ok(body)
}

fn validate_kind(kind: Option<String>) -> Result<Option<String>> {
    match kind.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(kind) if KINDS.contains(&kind) => Ok(Some(kind.to_string())),
        Some(kind) => Err(AppError::InvalidInput(format!("unknown note kind: {kind}"))),
    }
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
