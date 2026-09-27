//! Per-item note counts across one result folder, for grid badges, change
//! detection and desktop notifications.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{list_notes, AgentNote, NoteTarget, NOTES_DIR};
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeAgentNotesInput {
    pub target: NoteTarget,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentNoteSummary {
    pub item_id: i64,
    /// All open notes, including the ones below.
    pub open: usize,
    /// Open notes whose last reply is from the agent: it asked something or
    /// reported it could not finish, and waits for the user.
    pub needs_you: usize,
    pub drafts: usize,
    pub done: usize,
    /// Latest agent reply across the item's notes.
    pub last_agent_reply_at: Option<String>,
    /// Changes whenever any note file of the item changes.
    pub last_modified_at: Option<String>,
}

/// Whether the note is waiting for the user.
pub(crate) fn needs_you(note: &AgentNote) -> bool {
    note.status == "open"
        && note
            .replies
            .last()
            .is_some_and(|reply| reply.author != "user")
}

pub(crate) fn summarize(folder: &Path, target: NoteTarget) -> Result<Vec<AgentNoteSummary>> {
    let root = folder.join(NOTES_DIR);
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let prefix = format!("{}-", target.dir_prefix());
    let mut summaries = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(item_id) = name
            .to_str()
            .and_then(|name| name.strip_prefix(&prefix))
            .and_then(|id| id.parse::<i64>().ok())
            .filter(|id| *id > 0)
        else {
            continue;
        };
        let notes = list_notes(folder, target, item_id)?;
        if notes.is_empty() {
            continue;
        }
        summaries.push(summarize_item(item_id, &notes));
    }
    summaries.sort_by_key(|summary| summary.item_id);
    Ok(summaries)
}

fn summarize_item(item_id: i64, notes: &[AgentNote]) -> AgentNoteSummary {
    let count = |pred: &dyn Fn(&AgentNote) -> bool| notes.iter().filter(|n| pred(n)).count();
    AgentNoteSummary {
        item_id,
        open: count(&|n| n.status == "open"),
        needs_you: count(&|n| needs_you(n)),
        drafts: count(&|n| n.status == "draft"),
        done: count(&|n| n.status == "done"),
        last_agent_reply_at: notes
            .iter()
            .flat_map(|n| n.replies.iter())
            .filter(|reply| reply.author != "user")
            .map(|reply| reply.created_at.clone())
            .max(),
        last_modified_at: notes.iter().filter_map(|n| n.modified_at.clone()).max(),
    }
}
