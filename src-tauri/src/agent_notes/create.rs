//! Writing a new note file, plus the material gathered for it.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Local};

use super::format::{parse_note, write_atomic};
use super::{
    notes_dir, ops, replies, AgentNote, CreateAgentNoteInput, DRAFT_DIR, KINDS, MAX_BODY_CHARS,
    MAX_QUOTE_CHARS,
};
use crate::error::{AppError, Result};

/// Folder (inside an item's notes folder) holding the material DevDeck
/// gathered for each note. The agent reads it; it is never a note itself.
const CONTEXT_DIR: &str = "_context";
const MAX_DOCUMENT_BYTES: usize = 512 * 1024;

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
    let context = clean(input.context, 500);
    let kind = validate_kind(input.kind)?;
    let document = input
        .context_document
        .filter(|document| !document.trim().is_empty());
    if document
        .as_ref()
        .is_some_and(|d| d.len() > MAX_DOCUMENT_BYTES)
    {
        return Err(AppError::InvalidInput(
            "context document is too large".to_string(),
        ));
    }

    let mut dir = notes_dir(folder, input.target, input.item_id);
    if input.draft {
        dir = dir.join(DRAFT_DIR);
    }
    fs::create_dir_all(&dir)?;
    let stamp = now.format("%Y%m%d-%H%M%S").to_string();
    let path = ops::unique_path(&dir, &stamp)?;
    // Material DevDeck gathered for the agent (it gets no Azure DevOps access)
    // sits beside the notes under `_context/`, named after the note.
    let context_file = match document {
        Some(document) => {
            let docs = notes_dir(folder, input.target, input.item_id).join(CONTEXT_DIR);
            fs::create_dir_all(&docs)?;
            let file = docs.join(path.file_name().unwrap_or_default());
            write_atomic(&file, &document)?;
            Some(file.display().to_string())
        }
        None => None,
    };

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
        ("context", &context),
        ("context_file", &context_file),
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

pub(super) fn clean_body(body: &str) -> Result<&str> {
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
