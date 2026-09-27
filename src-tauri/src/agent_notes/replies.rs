//! Replies threaded under an agent note. Both the agent and the user append
//! them to the end of the note file, each after a marker line
//! `<!-- reply {author} {created} -->`, so the note stays one Markdown file the
//! agent can edit with plain text tools. Everything before the first marker is
//! the note's original body.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use super::format::{parse_note, write_atomic};
use super::{notes_dir, AgentNote, NoteTarget, DONE_DIR, MAX_BODY_CHARS};
use crate::error::{AppError, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyAgentNoteInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
    pub body: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteReply {
    /// `agent` or `user` as written in the marker; anything else is kept as is.
    pub author: String,
    pub created_at: String,
    pub body: String,
}

fn parse_marker(line: &str) -> Option<(String, String)> {
    let inner = line
        .trim()
        .strip_prefix("<!--")?
        .strip_suffix("-->")?
        .trim();
    let mut words = inner.split_whitespace();
    if words.next()? != "reply" {
        return None;
    }
    let author = words.next().unwrap_or("agent").to_string();
    let created_at = words.next().unwrap_or_default().to_string();
    Some((author, created_at))
}

pub(crate) fn is_marker(line: &str) -> bool {
    parse_marker(line).is_some()
}

/// A marker line in user text would split it into a fake reply when read back.
pub(crate) fn reject_markers(body: &str) -> Result<()> {
    if body.lines().any(|line| parse_marker(line).is_some()) {
        return Err(AppError::InvalidInput(
            "text must not contain a `<!-- reply ... -->` line".to_string(),
        ));
    }
    Ok(())
}

/// Splits the note body from the replies that follow it.
pub(crate) fn split_replies(text: &str) -> (String, Vec<NoteReply>) {
    let mut body = String::new();
    let mut replies: Vec<NoteReply> = Vec::new();
    for line in text.split_inclusive('\n') {
        if let Some((author, created_at)) = parse_marker(line) {
            replies.push(NoteReply {
                author,
                created_at,
                body: String::new(),
            });
        } else if let Some(reply) = replies.last_mut() {
            reply.body.push_str(line);
        } else {
            body.push_str(line);
        }
    }
    for reply in &mut replies {
        reply.body = reply.body.trim().to_string();
    }
    (body.trim().to_string(), replies)
}

/// Appends the user's reply. A reply to a done note moves it back to the open
/// folder, since it asks the agent for more.
pub(crate) fn reply_note(
    folder: &Path,
    input: ReplyAgentNoteInput,
    now: DateTime<Local>,
) -> Result<AgentNote> {
    super::validate_note_id(&input.note_id)?;
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::InvalidInput("reply is empty".to_string()));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::InvalidInput("reply is too long".to_string()));
    }
    reject_markers(body)?;

    let dir = notes_dir(folder, input.target, input.item_id);
    let open_path = dir.join(&input.note_id);
    let done_path = dir.join(DONE_DIR).join(&input.note_id);
    if !open_path.is_file() {
        if !done_path.is_file() {
            return Err(AppError::InvalidInput(format!(
                "note not found (it may have just been moved): {}",
                input.note_id
            )));
        }
        fs::rename(&done_path, &open_path)?;
    }

    let created = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let text = fs::read_to_string(&open_path)?;
    let text = format!(
        "{}\n\n<!-- reply user {created} -->\n{body}\n",
        text.trim_end_matches(['\r', '\n'])
    );
    write_atomic(&open_path, &text)?;
    Ok(parse_note(&open_path, "open", &text, Some(created)))
}
