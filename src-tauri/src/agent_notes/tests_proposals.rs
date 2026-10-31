use super::proposals::{prepare_post_in, record_posted_in, signature};
use super::*;
use chrono::TimeZone;

fn at(m: u32) -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 10, 1, 10, m, 0).unwrap()
}

fn input(index: usize, auto: bool) -> PostAgentProposalInput {
    PostAgentProposalInput {
        target: NoteTarget::PullRequest,
        item_id: 45,
        note_id: "n.md".to_string(),
        reply_index: index,
        auto,
    }
}

/// A note with a user reply, an agent reply and two proposals.
fn setup(root: &Path, proposals: &[&str]) {
    let dir = notes_dir(root, NoteTarget::PullRequest, 45);
    fs::create_dir_all(&dir).unwrap();
    let mut text = String::from("---\ntarget: pull-request\nid: 45\n---\nレビューして\n");
    text.push_str("\n<!-- reply claude 2026-10-01T10:00:00+09:00 -->\n見ました\n");
    for (i, proposal) in proposals.iter().enumerate() {
        text.push_str(&format!(
            "\n<!-- post claude 2026-10-01T10:0{i}:00+09:00 -->\n{proposal}\n"
        ));
    }
    fs::write(dir.join("n.md"), text).unwrap();
}

fn load(root: &Path) -> AgentNote {
    list_notes(root, NoteTarget::PullRequest, 45)
        .unwrap()
        .remove(0)
}

#[test]
fn proposals_are_parsed_as_post_replies() {
    let temp = tempfile::tempdir().unwrap();
    setup(temp.path(), &["ここを直して"]);
    let note = load(temp.path());
    assert_eq!(note.replies.len(), 2);
    assert_eq!(note.replies[0].kind, "reply");
    assert_eq!(note.replies[1].kind, "post");
    assert_eq!(note.replies[1].body, "ここを直して");
}

#[test]
fn posting_signs_the_comment_and_records_it_once() {
    let temp = tempfile::tempdir().unwrap();
    setup(temp.path(), &["ここを直して", "もう一件"]);
    let prepared = prepare_post_in(temp.path(), input(1, false), false, at(0)).unwrap();
    assert_eq!(
        prepared.body,
        format!("ここを直して\n\n{}", signature("Claude"))
    );
    assert!(prepare_post_in(temp.path(), input(1, false), false, at(0)).is_err());
    record_posted_in(temp.path(), prepared, "thread-9", at(1)).unwrap();

    let note = load(temp.path());
    assert_eq!(note.replies.len(), 3);
    assert_eq!(note.replies[1].posted_ref.as_deref(), Some("thread-9"));
    assert_eq!(note.replies[1].body, "ここを直して");
    assert!(note.replies[2].posted_at.is_none());
    assert!(prepare_post_in(temp.path(), input(1, false), false, at(2)).is_err());
    // The other proposal is still postable.
    assert!(prepare_post_in(temp.path(), input(2, false), false, at(2)).is_ok());
}

#[test]
fn a_signature_written_by_the_agent_is_not_doubled() {
    let temp = tempfile::tempdir().unwrap();
    let own = signature("Codex");
    setup(temp.path(), &[&format!("本文\n\n{own}")]);
    let prepared = prepare_post_in(temp.path(), input(1, false), false, at(0)).unwrap();
    assert_eq!(prepared.body, format!("本文\n\n{}", signature("Claude")));
}

#[test]
fn only_known_agents_and_posts_can_be_posted() {
    let temp = tempfile::tempdir().unwrap();
    setup(temp.path(), &["x"]);
    // index 0 is a plain reply, not a proposal.
    assert!(prepare_post_in(temp.path(), input(0, false), false, at(0)).is_err());
    assert!(prepare_post_in(temp.path(), input(9, false), false, at(0)).is_err());
    let dir = notes_dir(temp.path(), NoteTarget::PullRequest, 45);
    let forged = fs::read_to_string(dir.join("n.md"))
        .unwrap()
        .replace("post claude", "post user");
    fs::write(dir.join("n.md"), forged).unwrap();
    assert!(prepare_post_in(temp.path(), input(1, false), false, at(0)).is_err());
    let mut ask = input(1, false);
    ask.target = NoteTarget::Ask;
    assert!(prepare_post_in(temp.path(), ask, false, at(0)).is_err());
}

#[test]
fn automatic_posting_needs_the_setting_and_plain_text() {
    let temp = tempfile::tempdir().unwrap();
    setup(
        temp.path(),
        &["いい変更です", "see https://example.com", "@someone 見て"],
    );
    assert!(prepare_post_in(temp.path(), input(1, true), false, at(0)).is_err());
    assert!(prepare_post_in(temp.path(), input(1, true), true, at(0)).is_ok());
    assert!(prepare_post_in(temp.path(), input(2, true), true, at(0)).is_err());
    assert!(prepare_post_in(temp.path(), input(3, true), true, at(0)).is_err());
    // The user can still approve those by hand.
    assert!(prepare_post_in(temp.path(), input(2, false), false, at(0)).is_ok());
}

#[test]
fn automatic_posts_are_rate_limited_and_not_repeated() {
    let temp = tempfile::tempdir().unwrap();
    let texts = ["一", "二", "三", "四", "一"];
    setup(temp.path(), &texts);
    for index in 1..=3 {
        let prepared =
            prepare_post_in(temp.path(), input(index, true), true, at(index as u32)).unwrap();
        record_posted_in(temp.path(), prepared, "thread-1", at(index as u32)).unwrap();
    }
    let blocked = prepare_post_in(temp.path(), input(4, true), true, at(10));
    assert!(blocked.is_err());
    // An hour later the limit is gone, but the same text is not posted again.
    let later = at(0) + chrono::Duration::hours(2);
    assert!(prepare_post_in(temp.path(), input(4, true), true, later).is_ok());
    assert!(prepare_post_in(temp.path(), input(5, true), true, later).is_err());
}

#[test]
fn user_text_cannot_contain_post_markers() {
    assert!(replies::reject_markers("<!-- post claude 2026 -->").is_err());
    assert!(replies::reject_markers("<!-- posted 2026 thread-1 -->").is_err());
}

/// A pull request note whose proposals carry `file=` / `line=` (or broken ones).
fn setup_located(root: &Path, target: NoteTarget, markers: &[&str]) {
    let dir = notes_dir(root, target, 45);
    fs::create_dir_all(&dir).unwrap();
    let mut text = String::from("---\nid: 45\n---\nレビューして\n");
    for marker in markers {
        text.push_str(&format!(
            "\n<!-- post claude 2026-10-01T10:00:00+09:00 {marker} -->\nここを直して\n"
        ));
    }
    fs::write(dir.join("n.md"), text).unwrap();
}

#[test]
fn line_proposals_carry_their_file_and_line() {
    let temp = tempfile::tempdir().unwrap();
    setup_located(
        temp.path(),
        NoteTarget::PullRequest,
        &["file=/src/my%20app.ts line=42", ""],
    );
    let note = load(temp.path());
    assert_eq!(note.replies[0].file_path.as_deref(), Some("/src/my app.ts"));
    assert_eq!(note.replies[0].line, Some(42));
    assert_eq!(note.replies[0].body, "ここを直して");
    assert!(note.replies[1].file_path.is_none());

    let prepared = prepare_post_in(temp.path(), input(0, false), false, at(0)).unwrap();
    assert_eq!(prepared.location, Some(("/src/my app.ts".to_string(), 42)));
    record_posted_in(temp.path(), prepared, "thread-3", at(1)).unwrap();
    let note = load(temp.path());
    assert_eq!(note.replies[0].posted_ref.as_deref(), Some("thread-3"));
    assert_eq!(note.replies[0].line, Some(42));

    let plain = prepare_post_in(temp.path(), input(1, false), false, at(2)).unwrap();
    assert_eq!(plain.location, None);
}

#[test]
fn line_proposals_are_never_posted_automatically() {
    let temp = tempfile::tempdir().unwrap();
    setup_located(temp.path(), NoteTarget::PullRequest, &["file=/a.ts line=3"]);
    let error = prepare_post_in(temp.path(), input(0, true), true, at(0))
        .err()
        .unwrap();
    assert!(error.to_string().contains("needs your approval"));
}

#[test]
fn broken_locations_are_refused() {
    for marker in [
        "file=/a.ts",
        "line=3",
        "file=a.ts line=3",
        "file=/a/../b.ts line=3",
        "file=/a.ts line=0",
        "file=/a.ts line=x",
    ] {
        let temp = tempfile::tempdir().unwrap();
        setup_located(temp.path(), NoteTarget::PullRequest, &[marker]);
        assert!(
            prepare_post_in(temp.path(), input(0, false), false, at(0)).is_err(),
            "{marker} should be refused"
        );
    }
}

#[test]
fn work_item_proposals_cannot_point_at_a_line() {
    let temp = tempfile::tempdir().unwrap();
    setup_located(temp.path(), NoteTarget::WorkItem, &["file=/a.ts line=3"]);
    let input = PostAgentProposalInput {
        target: NoteTarget::WorkItem,
        ..input(0, false)
    };
    let error = prepare_post_in(temp.path(), input, false, at(0))
        .err()
        .unwrap();
    assert!(error
        .to_string()
        .contains("only be posted to a pull request"));
}
