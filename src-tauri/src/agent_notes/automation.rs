//! Controller messages for automatic attempts, shown through the normal notes UI.
use std::fs;

use chrono::Local;

use super::format::{set_field, write_atomic};
use super::{notes_dir, AgentNote, AgentNoteService, NoteTarget};
use crate::error::Result;

pub(crate) fn is_automatic(note: &AgentNote) -> bool {
    // The existing automatic-note prefix is retained for migration/recovery.
    note.body
        .starts_with(concat!("DevDeck ", "の自動実行です。"))
        || note.body.starts_with("DevDeck automatic review")
}

pub(crate) fn has_human_request(note: &AgentNote) -> bool {
    note.status == "open"
        && (!is_automatic(note) || note.replies.last().is_some_and(|r| r.author == "user"))
}

pub(crate) fn append_status(
    service: &AgentNoteService,
    target: NoteTarget,
    id: i64,
    note_id: &str,
    message: &str,
    done: bool,
) -> Result<()> {
    super::validate_note_id(note_id)?;
    let dir = notes_dir(&service.notes_root(), target, id);
    let open = dir.join(note_id);
    let closed = dir.join("_done").join(note_id);
    let path = if open.is_file() { &open } else { &closed };
    let mut text = fs::read_to_string(path)?;
    let summary = done.then_some("Automatic attempt finished; see controller reply");
    text = set_field(&text, "resolved", summary);
    // Controller messages never contain model output or raw REST errors.
    let message = message.replace("<!--", "&lt;!--");
    text.push_str(&format!(
        "\n<!-- reply devdeck {} -->\n{message}\n",
        Local::now().to_rfc3339()
    ));
    let destination = if done { &closed } else { &open };
    fs::create_dir_all(destination.parent().expect("note parent"))?;
    write_atomic(destination, &text)?;
    if path != destination {
        fs::remove_file(path)?;
    }
    Ok(())
}
