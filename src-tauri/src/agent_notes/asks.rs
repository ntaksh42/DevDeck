//! Free-standing requests (`ask-{id}/`): conversations started from any view,
//! listed together for the Agent panel.

use std::fs;
use std::path::Path;

use serde::Serialize;

use super::{list_notes, AgentNote, NoteTarget};
use crate::error::Result;

/// How many recent requests the Agent panel lists.
const MAX_ASKS: usize = 30;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAsk {
    pub item_id: i64,
    /// Latest change across the request's notes; the list is ordered by it.
    pub last_modified_at: Option<String>,
    pub notes: Vec<AgentNote>,
}

pub(crate) fn list_asks(root: &Path) -> Result<Vec<AgentAsk>> {
    let Ok(entries) = fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    let prefix = format!("{}-", NoteTarget::Ask.dir_prefix());
    let mut asks = Vec::new();
    for entry in entries.flatten() {
        let Some(item_id) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.strip_prefix(&prefix))
            .and_then(|id| id.parse::<i64>().ok())
            .filter(|id| *id > 0)
        else {
            continue;
        };
        let notes: Vec<AgentNote> = list_notes(root, NoteTarget::Ask, item_id)?
            .into_iter()
            .filter(|note| note.status != "draft")
            .collect();
        if notes.is_empty() {
            continue;
        }
        let last_modified_at = notes.iter().filter_map(|n| n.modified_at.clone()).max();
        asks.push(AgentAsk {
            item_id,
            last_modified_at,
            notes,
        });
    }
    asks.sort_by(|a, b| {
        b.last_modified_at
            .cmp(&a.last_modified_at)
            .then(b.item_id.cmp(&a.item_id))
    });
    asks.truncate(MAX_ASKS);
    Ok(asks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_notes::{create_note, CreateAgentNoteInput};
    use chrono::{Local, TimeZone};

    fn ask(item_id: i64, body: &str, context: Option<&str>) -> CreateAgentNoteInput {
        CreateAgentNoteInput {
            target: NoteTarget::Ask,
            item_id,
            body: body.to_string(),
            quote: None,
            quote_prefix: None,
            quote_suffix: None,
            quote_offset: None,
            result_file: None,
            result_hash: None,
            kind: Some("summarize".to_string()),
            context: context.map(str::to_string),
            context_document: None,
            draft: false,
        }
    }

    #[test]
    fn lists_requests_with_their_context_and_skips_other_targets() {
        let temp = tempfile::tempdir().unwrap();
        let at = Local.with_ymd_and_hms(2026, 10, 11, 9, 0, 0).unwrap();
        create_note(
            temp.path(),
            ask(20261011090000, "要約して", Some("Pipeline run 412 (CI)")),
            at,
        )
        .unwrap();
        let mut with_document = ask(20261011100000, "調べて", None);
        with_document.context_document = Some(
            "# Run 412
失敗ログ"
                .to_string(),
        );
        let note = create_note(temp.path(), with_document, at).unwrap();
        let file = note.context_file.expect("context file is recorded");
        assert!(file.contains("_context"));
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "# Run 412
失敗ログ"
        );
        fs::create_dir_all(temp.path().join("wi-3")).unwrap();
        fs::create_dir_all(temp.path().join("ask-x")).unwrap();

        let asks = list_asks(temp.path()).unwrap();
        // The material folder is not a note.
        assert_eq!(asks.len(), 2);
        let documented = asks.iter().find(|a| a.item_id == 20261011100000).unwrap();
        assert_eq!(documented.notes.len(), 1);
        let with_context = asks.iter().find(|a| a.item_id == 20261011090000).unwrap();
        let note = &with_context.notes[0];
        assert_eq!(note.context.as_deref(), Some("Pipeline run 412 (CI)"));
        assert_eq!(note.kind.as_deref(), Some("summarize"));
        assert_eq!(note.body, "要約して");
    }

    #[test]
    fn missing_root_lists_nothing() {
        let temp = tempfile::tempdir().unwrap();
        assert!(list_asks(&temp.path().join("missing")).unwrap().is_empty());
    }
}
