//! Changes to existing notes: edit, resolve / reopen, delete with undo, and
//! submitting drafts.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Deserialize;

use super::format::{parse_note, replace_body, set_field, write_atomic};
use super::{
    clean_body, notes_dir, validate_note_id, AgentNote, NoteTarget, DONE_DIR, DRAFT_DIR,
    MAX_QUOTE_CHARS, TRASH_DIR,
};
use crate::error::{AppError, Result};

/// Deleted notes are kept this long so the delete can be undone.
const TRASH_KEEP: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
    /// New body. Only allowed before the agent has replied or claimed it.
    pub body: Option<String>,
    /// New anchor for the note (re-attaching a note whose quote was lost).
    pub anchor: Option<NoteAnchorInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAnchorInput {
    pub quote: String,
    pub quote_prefix: Option<String>,
    pub quote_suffix: Option<String>,
    pub quote_offset: Option<i64>,
    pub result_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAgentNoteStatusInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
    /// `done` or `open`.
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
    /// Where the note was before it was deleted: `open` or `draft`.
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAgentNoteDraftsInput {
    pub target: NoteTarget,
    pub item_id: i64,
}

/// First free `{stamp}.md` / `{stamp}-{n}.md` in `dir`.
pub(crate) fn unique_path(dir: &Path, stamp: &str) -> Result<PathBuf> {
    (0..1000)
        .map(|n| {
            if n == 0 {
                dir.join(format!("{stamp}.md"))
            } else {
                dir.join(format!("{stamp}-{n}.md"))
            }
        })
        .find(|path| !path.exists())
        .ok_or_else(|| AppError::InvalidInput("too many notes in one second".to_string()))
}

/// Finds a note by id in the open, draft or done folder.
fn locate(dir: &Path, note_id: &str) -> Result<(PathBuf, &'static str)> {
    validate_note_id(note_id)?;
    [
        (dir.join(note_id), "open"),
        (dir.join(DRAFT_DIR).join(note_id), "draft"),
        (dir.join(DONE_DIR).join(note_id), "done"),
    ]
    .into_iter()
    .find(|(path, _)| path.is_file())
    .ok_or_else(|| {
        AppError::InvalidInput(format!(
            "note not found (it may have just been moved): {note_id}"
        ))
    })
}

pub(crate) fn update_note(folder: &Path, input: UpdateAgentNoteInput) -> Result<AgentNote> {
    let dir = notes_dir(folder, input.target, input.item_id);
    let (path, status) = locate(&dir, &input.note_id)?;
    let mut text = fs::read_to_string(&path)?;
    let current = parse_note(&path, status, &text, None);

    if let Some(body) = input.body {
        if status == "done" || !current.replies.is_empty() {
            return Err(AppError::InvalidInput(
                "the agent has already started on this note; reply instead".to_string(),
            ));
        }
        text = replace_body(&text, clean_body(&body)?);
    }
    if let Some(anchor) = input.anchor {
        let quote: String = anchor.quote.trim().chars().take(MAX_QUOTE_CHARS).collect();
        if quote.is_empty() {
            return Err(AppError::InvalidInput("quote is empty".to_string()));
        }
        let short = |value: Option<String>| value.map(|v| v.chars().take(64).collect::<String>());
        let offset = anchor
            .quote_offset
            .filter(|offset| *offset >= 0)
            .map(|o| o.to_string());
        text = set_field(&text, "quote", Some(&quote));
        text = set_field(&text, "quote_prefix", short(anchor.quote_prefix).as_deref());
        text = set_field(&text, "quote_suffix", short(anchor.quote_suffix).as_deref());
        text = set_field(&text, "quote_offset", offset.as_deref());
        if let Some(hash) = anchor.result_hash.as_deref() {
            text = set_field(&text, "result_hash", Some(hash));
        }
    }
    write_atomic(&path, &text)?;
    Ok(parse_note(&path, status, &text, None))
}

/// Resolves a note on the user's side (moves it to `_done/`) or reopens it
/// without a reply.
pub(crate) fn set_status(folder: &Path, input: SetAgentNoteStatusInput) -> Result<AgentNote> {
    let dir = notes_dir(folder, input.target, input.item_id);
    let (path, status) = locate(&dir, &input.note_id)?;
    let (to_dir, to_status) = match input.status.as_str() {
        "done" => (dir.join(DONE_DIR), "done"),
        "open" => (dir.clone(), "open"),
        other => {
            return Err(AppError::InvalidInput(format!(
                "unknown note status: {other}"
            )))
        }
    };
    if status == to_status {
        let text = fs::read_to_string(&path)?;
        return Ok(parse_note(&path, status, &text, None));
    }
    let mut text = fs::read_to_string(&path)?;
    text = if to_status == "done" {
        set_field(&text, "resolved", Some("Resolved in DevDeck"))
    } else {
        // Reopened by the user: a leftover `resolved` line would still show it
        // as handled.
        set_field(&text, "resolved", None)
    };
    fs::create_dir_all(&to_dir)?;
    let to_path = to_dir.join(&input.note_id);
    write_atomic(&to_path, &text)?;
    fs::remove_file(&path)?;
    Ok(parse_note(&to_path, to_status, &text, None))
}

/// Moves an open or draft note into `_trash/`. Done notes are the agent's
/// record and stay put.
pub(crate) fn trash_note(
    folder: &Path,
    target: NoteTarget,
    item_id: i64,
    note_id: &str,
) -> Result<()> {
    validate_note_id(note_id)?;
    let dir = notes_dir(folder, target, item_id);
    for path in [dir.join(note_id), dir.join(DRAFT_DIR).join(note_id)] {
        if path.is_file() {
            let trash = dir.join(TRASH_DIR);
            fs::create_dir_all(&trash)?;
            fs::rename(&path, trash.join(note_id))?;
        }
    }
    Ok(())
}

pub(crate) fn restore_note(folder: &Path, input: RestoreAgentNoteInput) -> Result<()> {
    validate_note_id(&input.note_id)?;
    let dir = notes_dir(folder, input.target, input.item_id);
    let from = dir.join(TRASH_DIR).join(&input.note_id);
    if !from.is_file() {
        return Err(AppError::InvalidInput(format!(
            "deleted note not found: {}",
            input.note_id
        )));
    }
    let to_dir = if input.status == "draft" {
        dir.join(DRAFT_DIR)
    } else {
        dir
    };
    fs::create_dir_all(&to_dir)?;
    fs::rename(from, to_dir.join(&input.note_id))?;
    Ok(())
}

/// Best effort: forgets notes deleted more than a day ago.
pub(crate) fn purge_old_trash(trash: &Path) {
    let Ok(entries) = fs::read_dir(trash) else {
        return;
    };
    let cutoff = SystemTime::now() - TRASH_KEEP;
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| modified < cutoff);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Moves every draft into the open folder, where the agent picks it up.
pub(crate) fn submit_drafts(folder: &Path, target: NoteTarget, item_id: i64) -> Result<usize> {
    let dir = notes_dir(folder, target, item_id);
    let drafts = dir.join(DRAFT_DIR);
    if !drafts.is_dir() {
        return Ok(0);
    }
    let mut names: Vec<_> = fs::read_dir(&drafts)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| super::is_note_file(path))
        .collect();
    names.sort();
    for path in &names {
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("note");
        let to = unique_path(&dir, stem)?;
        fs::rename(path, to)?;
    }
    Ok(names.len())
}
