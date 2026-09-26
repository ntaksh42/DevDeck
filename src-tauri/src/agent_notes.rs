//! Notes the user leaves for an external AI agent about a work item's
//! investigation result (or, for pull requests, a review result). Each note is
//! one Markdown file with a small front-matter block under
//! `{result_folder}/.to-agent-msg/{wi|pr}-{id}/`, where the result folder is the
//! work item or review result folder from Settings; the agent reads the open
//! notes, acts on them, and moves each file into the `_done/` subfolder. The
//! files are the source of truth -- nothing is stored in SQLite -- so the agent
//! needs no access to DevDeck.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::error::{AppError, Result};

const NOTES_DIR: &str = ".to-agent-msg";
const DONE_DIR: &str = "_done";
const MAX_BODY_CHARS: usize = 20_000;
const MAX_QUOTE_CHARS: usize = 2_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub body: String,
    pub quote: Option<String>,
    pub quote_prefix: Option<String>,
    pub quote_suffix: Option<String>,
    pub result_file: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentNote {
    /// File name; unique within the item's folder.
    pub id: String,
    /// `open` (in the item folder) or `done` (moved into `_done/`).
    pub status: String,
    pub created_at: String,
    pub body: String,
    pub quote: Option<String>,
    pub quote_prefix: Option<String>,
    pub quote_suffix: Option<String>,
    pub result_file: Option<String>,
    /// What the agent reported when it handled the note.
    pub resolved: Option<String>,
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
        let folder = self.result_folder(input.target)?.ok_or_else(|| {
            AppError::InvalidInput(
                "Set a result folder in Settings to leave agent notes".to_string(),
            )
        })?;
        create_note(&folder, input, Local::now())
    }

    pub fn delete(&self, input: DeleteAgentNoteInput) -> Result<()> {
        validate_id(input.item_id)?;
        let Some(folder) = self.result_folder(input.target)? else {
            return Ok(());
        };
        delete_note(&folder, input.target, input.item_id, &input.note_id)
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
    let mut notes = read_notes_in(&dir, "open")?;
    notes.extend(read_notes_in(&dir.join(DONE_DIR), "done")?);
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
        let is_md = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
        if !path.is_file() || !is_md {
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

fn parse_note(path: &Path, status: &str, text: &str, modified: Option<String>) -> AgentNote {
    let (fields, body) = split_front_matter(text);
    let get = |key: &str| {
        fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())
    };
    AgentNote {
        id: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        status: status.to_string(),
        created_at: get("created").or(modified).unwrap_or_default(),
        body: body.trim().to_string(),
        quote: get("quote"),
        quote_prefix: get("quote_prefix"),
        quote_suffix: get("quote_suffix"),
        result_file: get("result_file"),
        resolved: get("resolved"),
        file_path: path.display().to_string(),
    }
}

/// Splits `---`-delimited `key: value` lines from the body. Values written by
/// DevDeck are JSON strings; values an agent writes by hand may be bare text,
/// so both are accepted. A file without front-matter is all body.
fn split_front_matter(text: &str) -> (Vec<(String, String)>, &str) {
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))
    else {
        return (Vec::new(), text);
    };
    let mut fields = Vec::new();
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        offset += line.len();
        let trimmed = line.trim_end();
        if trimmed == "---" {
            return (fields, &rest[offset..]);
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            fields.push((key.trim().to_string(), parse_value(value.trim())));
        }
    }
    (Vec::new(), text)
}

fn parse_value(raw: &str) -> String {
    if raw.starts_with('"') {
        if let Ok(value) = serde_json::from_str::<String>(raw) {
            return value;
        }
    }
    if raw == "null" || raw == "~" {
        return String::new();
    }
    raw.to_string()
}

pub(crate) fn create_note(
    folder: &Path,
    input: CreateAgentNoteInput,
    now: DateTime<Local>,
) -> Result<AgentNote> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::InvalidInput("note body is empty".to_string()));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::InvalidInput("note body is too long".to_string()));
    }
    let clean = |value: Option<String>, max: usize| {
        value
            .map(|value| value.trim().chars().take(max).collect::<String>())
            .filter(|value| !value.is_empty())
    };
    let quote = clean(input.quote, MAX_QUOTE_CHARS);
    let (quote_prefix, quote_suffix) = if quote.is_some() {
        (clean(input.quote_prefix, 64), clean(input.quote_suffix, 64))
    } else {
        (None, None)
    };
    let result_file = clean(input.result_file, 260);

    let dir = notes_dir(folder, input.target, input.item_id);
    fs::create_dir_all(&dir)?;
    let stamp = now.format("%Y%m%d-%H%M%S").to_string();
    let path = (0..1000)
        .map(|n| {
            if n == 0 {
                dir.join(format!("{stamp}.md"))
            } else {
                dir.join(format!("{stamp}-{n}.md"))
            }
        })
        .find(|path| !path.exists())
        .ok_or_else(|| AppError::InvalidInput("too many notes in one second".to_string()))?;

    let created_at = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let json = |value: &str| serde_json::to_string(value).unwrap_or_default();
    let mut text = format!(
        "---\ntarget: {}\nid: {}\ncreated: {created_at}\n",
        input.target.as_str(),
        input.item_id
    );
    for (key, value) in [
        ("result_file", &result_file),
        ("quote", &quote),
        ("quote_prefix", &quote_prefix),
        ("quote_suffix", &quote_suffix),
    ] {
        if let Some(value) = value {
            text.push_str(&format!("{key}: {}\n", json(value)));
        }
    }
    text.push_str(&format!("---\n{body}\n"));
    fs::write(&path, text)?;

    Ok(AgentNote {
        id: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        status: "open".to_string(),
        created_at,
        body: body.to_string(),
        quote,
        quote_prefix,
        quote_suffix,
        result_file,
        resolved: None,
        file_path: path.display().to_string(),
    })
}

/// Deletes an open note. Done notes are the agent's record and stay put.
pub(crate) fn delete_note(
    folder: &Path,
    target: NoteTarget,
    item_id: i64,
    note_id: &str,
) -> Result<()> {
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
    let path = notes_dir(folder, target, item_id).join(note_id);
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "agent_notes_tests.rs"]
mod tests;
