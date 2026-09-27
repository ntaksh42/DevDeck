use super::*;

use chrono::TimeZone;

fn at(h: u32, m: u32, s: u32) -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 9, 26, h, m, s).unwrap()
}

fn input(body: &str, quote: Option<&str>) -> CreateAgentNoteInput {
    CreateAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 1234,
        body: body.to_string(),
        quote: quote.map(str::to_string),
        quote_prefix: quote.map(|_| "前の文脈".to_string()),
        quote_suffix: quote.map(|_| "後ろの\"文脈\"".to_string()),
        quote_offset: None,
        result_file: Some("1234-result.html".to_string()),
        result_hash: None,
        kind: None,
        draft: false,
    }
}

#[test]
fn create_then_list_round_trips_all_fields() {
    let temp = tempfile::tempdir().unwrap();
    let created = create_note(
        temp.path(),
        input(
            "  設定値も確認して。\n2 行目  ",
            Some("リトライは最大 3 回"),
        ),
        at(10, 12, 0),
    )
    .unwrap();
    assert_eq!(created.id, "20260926-101200.md");

    let notes = list_notes(temp.path(), NoteTarget::WorkItem, 1234).unwrap();
    assert_eq!(notes.len(), 1);
    let note = &notes[0];
    assert_eq!(note.id, created.id);
    assert_eq!(note.body, created.body);
    assert_eq!(note.created_at, created.created_at);
    assert_eq!(note.status, "open");
    assert_eq!(note.body, "設定値も確認して。\n2 行目");
    assert_eq!(note.quote.as_deref(), Some("リトライは最大 3 回"));
    assert_eq!(note.quote_suffix.as_deref(), Some("後ろの\"文脈\""));
    assert!(temp
        .path()
        .join(".to-agent-msg/wi-1234/20260926-101200.md")
        .is_file());
}

#[test]
fn same_second_notes_get_distinct_files() {
    let temp = tempfile::tempdir().unwrap();
    let a = create_note(temp.path(), input("a", None), at(9, 0, 0)).unwrap();
    let b = create_note(temp.path(), input("b", None), at(9, 0, 0)).unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(
        list_notes(temp.path(), NoteTarget::WorkItem, 1234)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn general_note_drops_quote_context() {
    let temp = tempfile::tempdir().unwrap();
    let mut req = input("調査して", None);
    req.quote_prefix = Some("stray".to_string());
    let note = create_note(temp.path(), req, at(9, 0, 0)).unwrap();
    assert_eq!(note.quote, None);
    assert_eq!(note.quote_prefix, None);
}

#[test]
fn rejects_empty_body() {
    let temp = tempfile::tempdir().unwrap();
    assert!(create_note(temp.path(), input("   ", None), at(9, 0, 0)).is_err());
}

#[test]
fn lists_agent_written_done_notes_with_bare_values() {
    let temp = tempfile::tempdir().unwrap();
    let done = temp.path().join(".to-agent-msg/wi-1234/_done");
    fs::create_dir_all(&done).unwrap();
    fs::write(
        done.join("20260925-174000.md"),
        "---\r\ncreated: 2026-09-25T17:40:00+09:00\r\nresolved: WI にコメント追記済み\r\n---\r\n対象は main で見て。\r\n",
    )
    .unwrap();
    fs::write(done.join("notes.txt"), "ignored").unwrap();

    let notes = list_notes(temp.path(), NoteTarget::WorkItem, 1234).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].status, "done");
    assert_eq!(notes[0].resolved.as_deref(), Some("WI にコメント追記済み"));
    assert_eq!(notes[0].body, "対象は main で見て。");
    assert_eq!(notes[0].created_at, "2026-09-25T17:40:00+09:00");
}

#[test]
fn file_without_front_matter_is_all_body() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join(".to-agent-msg/wi-1234");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("memo.md"), "ただのメモ").unwrap();
    let notes = list_notes(temp.path(), NoteTarget::WorkItem, 1234).unwrap();
    assert_eq!(notes[0].body, "ただのメモ");
    assert!(!notes[0].created_at.is_empty(), "falls back to mtime");
}

#[test]
fn missing_folder_lists_nothing() {
    let temp = tempfile::tempdir().unwrap();
    assert!(list_notes(temp.path(), NoteTarget::WorkItem, 99)
        .unwrap()
        .is_empty());
}

#[test]
fn delete_removes_open_note_only() {
    let temp = tempfile::tempdir().unwrap();
    let note = create_note(temp.path(), input("x", None), at(9, 0, 0)).unwrap();
    ops::trash_note(temp.path(), NoteTarget::WorkItem, 1234, &note.id).unwrap();
    assert!(list_notes(temp.path(), NoteTarget::WorkItem, 1234)
        .unwrap()
        .is_empty());
    // Unknown ids are a no-op.
    ops::trash_note(temp.path(), NoteTarget::WorkItem, 1234, "missing.md").unwrap();
}

#[test]
fn delete_rejects_path_traversal() {
    let temp = tempfile::tempdir().unwrap();
    for bad in ["../x.md", "..\\x.md", "_done/x.md", "C:x.md", "x.txt", ""] {
        assert!(
            ops::trash_note(temp.path(), NoteTarget::WorkItem, 1234, bad).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn pull_request_notes_use_pr_folder_and_target() {
    let temp = tempfile::tempdir().unwrap();
    let mut req = input("PR のレビュー観点を追加して", None);
    req.target = NoteTarget::PullRequest;
    req.item_id = 57;
    let note = create_note(temp.path(), req, at(9, 0, 0)).unwrap();
    let text = fs::read_to_string(&note.file_path).unwrap();
    assert!(temp.path().join(".to-agent-msg/pr-57").is_dir());
    assert!(text.starts_with("---\ntarget: pull-request\nid: 57\n"));
    assert_eq!(
        list_notes(temp.path(), NoteTarget::PullRequest, 57)
            .unwrap()
            .len(),
        1
    );
    assert!(list_notes(temp.path(), NoteTarget::WorkItem, 57)
        .unwrap()
        .is_empty());
}

#[test]
fn ensure_guide_owns_only_its_marked_block() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("AGENTS.md");
    ensure_guide(temp.path(), NoteTarget::PullRequest).unwrap();
    let guide = fs::read_to_string(&path).unwrap();
    assert!(guide.contains(".to-agent-msg/pr-{番号}/"));
    assert!(guide.contains("PR にコメントとして投稿する"));
    assert!(!guide.contains("{kind}"));

    // A user file without the block is left alone.
    fs::write(&path, "user edited").unwrap();
    ensure_guide(temp.path(), NoteTarget::PullRequest).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "user edited");

    // Text around the block survives a refresh; the block is rewritten.
    let stale = guide.replace("data-agent-note", "OLD");
    fs::write(
        &path,
        format!(
            "# mine

{stale}
after
"
        ),
    )
    .unwrap();
    ensure_guide(temp.path(), NoteTarget::PullRequest).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.starts_with(
        "# mine

"
    ));
    assert!(text.ends_with(
        "after
"
    ));
    assert!(text.contains("data-agent-note") && !text.contains("OLD"));

    // The old unmarked guide DevDeck wrote is replaced whole.
    fs::write(
        &path,
        "# 申し送りの読み方

古い版",
    )
    .unwrap();
    ensure_guide(temp.path(), NoteTarget::PullRequest).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), guide);
}

#[test]
fn ensure_guide_skips_missing_folder() {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("missing");
    ensure_guide(&missing, NoteTarget::WorkItem).unwrap();
    assert!(!missing.exists());
}

#[test]
fn replies_are_split_from_the_body() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join(".to-agent-msg").join("wi-1234");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("a.md"),
        "---\ncreated: 2026-09-26T10:00:00+09:00\n---\n指示\n\n<!-- reply agent 2026-09-26T11:00:00+09:00 -->\n対応しました。\n2 行目\n<!--reply user-->\nまだ\n",
    )
    .unwrap();
    let notes = list_notes(temp.path(), NoteTarget::WorkItem, 1234).unwrap();
    assert_eq!(notes[0].body, "指示");
    let replies: Vec<_> = notes[0]
        .replies
        .iter()
        .map(|r| (r.author.as_str(), r.created_at.as_str(), r.body.as_str()))
        .collect();
    assert_eq!(
        replies,
        vec![
            (
                "agent",
                "2026-09-26T11:00:00+09:00",
                "対応しました。\n2 行目"
            ),
            ("user", "", "まだ"),
        ]
    );
}

#[test]
fn reply_appends_and_reopens_a_done_note() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join(".to-agent-msg").join("wi-1234");
    fs::create_dir_all(dir.join("_done")).unwrap();
    fs::write(
        dir.join("_done").join("a.md"),
        "---\nresolved: done\n---\n指示\n<!-- reply agent -->\n対応済み",
    )
    .unwrap();
    let reply = |body: &str| ReplyAgentNoteInput {
        target: NoteTarget::WorkItem,
        item_id: 1234,
        note_id: "a.md".to_string(),
        body: body.to_string(),
    };

    let note = replies::reply_note(temp.path(), reply("  直っていない  "), at(12, 0, 0)).unwrap();
    assert_eq!(note.status, "open");
    assert!(dir.join("a.md").is_file());
    assert!(!dir.join("_done").join("a.md").exists());
    assert_eq!(note.replies.len(), 2);
    assert_eq!(note.replies[1].author, "user");
    assert_eq!(note.replies[1].body, "直っていない");

    assert!(replies::reply_note(temp.path(), reply("<!-- reply agent -->"), at(12, 1, 0)).is_err());
    assert!(replies::reply_note(temp.path(), reply("   "), at(12, 1, 0)).is_err());
    let mut bad = reply("x");
    bad.note_id = "../a.md".to_string();
    assert!(replies::reply_note(temp.path(), bad, at(12, 1, 0)).is_err());
}

#[test]
fn rejects_body_with_a_reply_marker() {
    let temp = tempfile::tempdir().unwrap();
    let body = "指示\n<!-- reply user -->\n返信ではない";
    assert!(create_note(temp.path(), input(body, None), at(10, 0, 0)).is_err());
    assert!(list_notes(temp.path(), NoteTarget::WorkItem, 1234)
        .unwrap()
        .is_empty());
}

#[test]
fn latest_resolved_wins_after_a_reopened_note_is_done_again() {
    let temp = tempfile::tempdir().unwrap();
    let done = temp
        .path()
        .join(".to-agent-msg")
        .join("wi-1234")
        .join("_done");
    fs::create_dir_all(&done).unwrap();
    fs::write(
        done.join("a.md"),
        "---\nresolved: 1 回目\nresolved: 2 回目\n---\n指示\n",
    )
    .unwrap();
    let notes = list_notes(temp.path(), NoteTarget::WorkItem, 1234).unwrap();
    assert_eq!(notes[0].resolved.as_deref(), Some("2 回目"));
}
