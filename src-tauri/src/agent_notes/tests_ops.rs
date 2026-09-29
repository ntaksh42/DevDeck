use super::*;
use chrono::TimeZone;

fn at(m: u32) -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 9, 27, 10, m, 0).unwrap()
}

fn note(folder: &Path, body: &str, draft: bool, m: u32) -> AgentNote {
    let input = CreateAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        body: body.to_string(),
        quote: Some("本文の一部".to_string()),
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: Some(12),
        result_file: None,
        result_hash: Some("abc123".to_string()),
        kind: Some("question".to_string()),
        draft,
    };
    create_note(folder, input, at(m)).unwrap()
}

fn list(folder: &Path) -> Vec<AgentNote> {
    list_notes(folder, NoteTarget::WorkItem, 7).unwrap()
}

fn dir(folder: &Path) -> PathBuf {
    notes_dir(folder, NoteTarget::WorkItem, 7)
}

#[test]
fn new_front_matter_fields_round_trip() {
    let temp = tempfile::tempdir().unwrap();
    let created = note(temp.path(), "質問です", false, 0);
    let listed = &list(temp.path())[0];
    assert_eq!(listed.kind.as_deref(), Some("question"));
    assert_eq!(listed.quote_offset, Some(12));
    assert_eq!(listed.result_hash.as_deref(), Some("abc123"));
    assert_eq!(listed.id, created.id);

    let mut bad = CreateAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        body: "x".to_string(),
        quote: None,
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: None,
        result_file: None,
        result_hash: None,
        kind: Some("later".to_string()),
        draft: false,
    };
    assert!(create_note(temp.path(), bad.clone(), at(1)).is_err());
    bad.kind = None;
    assert!(create_note(temp.path(), bad, at(1)).is_ok());
    // No temporary files are left behind.
    let leftovers = fs::read_dir(dir(temp.path()))
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        })
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn drafts_stay_hidden_until_submitted() {
    let temp = tempfile::tempdir().unwrap();
    note(temp.path(), "a", true, 0);
    note(temp.path(), "b", true, 0);
    let notes = list(temp.path());
    assert!(notes.iter().all(|n| n.status == "draft"));
    assert!(dir(temp.path())
        .join(DRAFT_DIR)
        .join("20260927-100000.md")
        .is_file());

    assert_eq!(
        ops::submit_drafts(temp.path(), NoteTarget::WorkItem, 7).unwrap(),
        2
    );
    let notes = list(temp.path());
    assert_eq!(notes.iter().filter(|n| n.status == "open").count(), 2);
    assert_eq!(
        ops::submit_drafts(temp.path(), NoteTarget::WorkItem, 7).unwrap(),
        0
    );
}

#[test]
fn delete_can_be_undone() {
    let temp = tempfile::tempdir().unwrap();
    let created = note(temp.path(), "a", false, 0);
    ops::trash_note(temp.path(), NoteTarget::WorkItem, 7, &created.id).unwrap();
    assert!(list(temp.path()).is_empty());
    let restore = |status: &str| RestoreAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        note_id: created.id.clone(),
        status: status.to_string(),
    };
    ops::restore_note(temp.path(), restore("open")).unwrap();
    assert_eq!(list(temp.path())[0].status, "open");
    assert!(ops::restore_note(temp.path(), restore("open")).is_err());
}

#[test]
fn body_edits_keep_replies_and_stop_once_the_agent_starts() {
    let temp = tempfile::tempdir().unwrap();
    let created = note(temp.path(), "旧本文", false, 0);
    let update = |body: &str| UpdateAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        note_id: created.id.clone(),
        body: Some(body.to_string()),
        anchor: None,
    };
    let edited = ops::update_note(temp.path(), update("新本文")).unwrap();
    assert_eq!(edited.body, "新本文");
    assert_eq!(edited.kind.as_deref(), Some("question"));

    let path = dir(temp.path()).join(&created.id);
    let text = fs::read_to_string(&path).unwrap();
    fs::write(&path, format!("{text}\n<!-- reply codex -->\n質問")).unwrap();
    assert!(ops::update_note(temp.path(), update("また変更")).is_err());
    let listed = &list(temp.path())[0];
    assert_eq!(listed.body, "新本文");
    assert_eq!(listed.replies.len(), 1);
}

#[test]
fn reanchoring_replaces_the_quote_fields() {
    let temp = tempfile::tempdir().unwrap();
    let created = note(temp.path(), "a", false, 0);
    let input = UpdateAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        note_id: created.id.clone(),
        body: None,
        anchor: Some(ops::NoteAnchorInput {
            quote: "新しい引用".to_string(),
            quote_prefix: Some("前".to_string()),
            quote_suffix: None,
            quote_offset: None,
            result_hash: Some("def".to_string()),
        }),
    };
    let updated = ops::update_note(temp.path(), input).unwrap();
    assert_eq!(updated.quote.as_deref(), Some("新しい引用"));
    assert_eq!(updated.quote_prefix.as_deref(), Some("前"));
    assert_eq!(updated.quote_offset, None);
    assert_eq!(updated.result_hash.as_deref(), Some("def"));
    let text = fs::read_to_string(&updated.file_path).unwrap();
    assert_eq!(text.matches("quote:").count(), 1);
}

#[test]
fn resolve_and_reopen_move_the_file() {
    let temp = tempfile::tempdir().unwrap();
    let created = note(temp.path(), "a", false, 0);
    let path = dir(temp.path()).join(&created.id);

    let set = |status: &str| SetAgentNoteStatusInput {
        target: NoteTarget::WorkItem,
        item_id: 7,
        note_id: created.id.clone(),
        status: status.to_string(),
    };
    let done = ops::set_status(temp.path(), set("done")).unwrap();
    assert_eq!(done.status, "done");
    assert_eq!(done.resolved.as_deref(), Some("Resolved in DevDeck"));
    assert!(!path.exists());

    let open = ops::set_status(temp.path(), set("open")).unwrap();
    assert_eq!(open.status, "open");
    // Reopening drops the stale "Resolved in DevDeck" line.
    assert_eq!(open.resolved, None);
    assert!(path.is_file());
    assert!(ops::set_status(temp.path(), set("later")).is_err());
}

#[test]
fn summary_counts_states_per_item() {
    let temp = tempfile::tempdir().unwrap();
    let asked = note(temp.path(), "a", false, 0);
    let answered = note(temp.path(), "b", false, 1);
    note(temp.path(), "c", false, 2);
    note(temp.path(), "d", true, 3);
    let d = dir(temp.path());
    let append = |id: &str, extra: &str| {
        let path = d.join(id);
        let text = fs::read_to_string(&path).unwrap();
        fs::write(&path, format!("{text}{extra}")).unwrap();
    };
    append(
        &asked.id,
        "\n<!-- reply codex 2026-09-27T11:00:00+09:00 -->\nどれ？\n",
    );
    append(
        &answered.id,
        "
<!-- reply codex -->
質問
<!-- reply user -->
答え
",
    );
    fs::create_dir_all(temp.path().join(NOTES_DIR).join("pr-3")).unwrap();
    fs::create_dir_all(temp.path().join(NOTES_DIR).join("wi-x")).unwrap();

    let summaries = summary::summarize(temp.path(), NoteTarget::WorkItem).unwrap();
    assert_eq!(summaries.len(), 1);
    let s = &summaries[0];
    assert_eq!(
        (s.item_id, s.open, s.needs_you, s.drafts, s.done),
        (7, 3, 1, 1, 0)
    );
    assert_eq!(
        s.last_agent_reply_at.as_deref(),
        Some("2026-09-27T11:00:00+09:00")
    );
    assert!(s.last_modified_at.is_some());
}
