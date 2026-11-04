use chrono::{Duration, Utc};
use tempfile::NamedTempFile;

use super::action_inbox::format_time;
use super::reply_reminders::reconcile;
use super::test_support::make_org_draft;
use super::*;

fn setup() -> (NamedTempFile, AppDatabase) {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    drop(conn);
    (tf, db)
}

fn input(due_in_hours: i64) -> ReplyReminderInput {
    ReplyReminderInput {
        organization_id: "org1".into(),
        kind: "pr".into(),
        subject_id: 7,
        project_id: "proj".into(),
        project_name: "Project".into(),
        repository_id: "repo".into(),
        repository_name: "api".into(),
        thread_id: 70,
        title: "PR 7".into(),
        web_url: Some("https://dev.azure.com/org1/Project/_git/api/pullrequest/7".into()),
        due_at: format_time(Utc::now() + Duration::hours(due_in_hours)),
    }
}

fn comment_item(comment_id: i64) -> NewInboxItem {
    NewInboxItem {
        organization_id: "org1".into(),
        kind: "pr_reply".into(),
        subject_id: 7,
        project_id: "proj".into(),
        project_name: "Project".into(),
        repository_id: "repo".into(),
        repository_name: "api".into(),
        thread_id: 70,
        comment_id,
        title: "PR 7".into(),
        author: Some("Tanaka".into()),
        snippet: Some("done".into()),
        web_url: None,
        file_path: None,
        line: None,
    }
}

fn open_kinds(db: &AppDatabase) -> Vec<String> {
    db.list_inbox_items(Some("org1"), InboxListState::Open, 50)
        .unwrap()
        .into_iter()
        .map(|item| item.kind)
        .collect()
}

#[test]
fn rejects_unknown_kind_and_past_deadlines() {
    let (_tf, db) = setup();
    let mut bad = input(1);
    bad.kind = "other".into();
    assert!(db.set_reply_reminder(&bad).is_err());
    assert!(db.set_reply_reminder(&input(-1)).is_err());
}

#[test]
fn waits_until_the_deadline_then_raises_one_waiting_row() {
    let (_tf, db) = setup();
    db.set_reply_reminder(&input(48)).unwrap();
    let before = reconcile(&db.open().unwrap(), "org1", Utc::now()).unwrap();
    assert!(before.fired.is_empty());
    assert!(open_kinds(&db).is_empty());

    let later = Utc::now() + Duration::hours(49);
    let due = reconcile(&db.open().unwrap(), "org1", later).unwrap();
    assert_eq!(due.fired.len(), 1);
    assert_eq!(open_kinds(&db), vec!["pr_waiting".to_string()]);
    assert!(db.list_reply_reminders().unwrap().is_empty());

    // The same deadline is never raised twice, even across restarts.
    let again = reconcile(&db.open().unwrap(), "org1", later).unwrap();
    assert!(again.fired.is_empty());
    assert_eq!(open_kinds(&db).len(), 1);
}

#[test]
fn a_reply_after_the_reminder_clears_it() {
    let (_tf, db) = setup();
    db.set_reply_reminder(&input(48)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    db.insert_inbox_items(&[comment_item(5)]).unwrap();

    let later = Utc::now() + Duration::hours(49);
    let outcome = reconcile(&db.open().unwrap(), "org1", later).unwrap();
    assert_eq!(outcome.cleared, 1);
    assert!(outcome.fired.is_empty());
    assert!(db.list_reply_reminders().unwrap().is_empty());
}

#[test]
fn a_comment_seen_before_the_reminder_does_not_clear_it() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[comment_item(5)]).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    db.set_reply_reminder(&input(48)).unwrap();
    let outcome = reconcile(&db.open().unwrap(), "org1", Utc::now()).unwrap();
    assert_eq!(outcome.cleared, 0);
    assert_eq!(db.list_reply_reminders().unwrap().len(), 1);
}

#[test]
fn a_late_reply_finishes_the_waiting_row() {
    let (_tf, db) = setup();
    db.set_reply_reminder(&input(1)).unwrap();
    let due_at = Utc::now() + Duration::hours(2);
    reconcile(&db.open().unwrap(), "org1", due_at).unwrap();
    assert_eq!(open_kinds(&db), vec!["pr_waiting".to_string()]);

    // The test fired the reminder with a clock two hours ahead; put the row's
    // detection time back to where a real sync would have set it.
    db.open()
        .unwrap()
        .execute(
            "UPDATE action_inbox_items SET detected_at = ?1 WHERE kind = ?2",
            rusqlite::params![format_time(Utc::now() - Duration::hours(1)), "pr_waiting"],
        )
        .unwrap();
    db.insert_inbox_items(&[comment_item(9)]).unwrap();
    reconcile(&db.open().unwrap(), "org1", Utc::now()).unwrap();
    assert_eq!(open_kinds(&db), vec!["pr_reply".to_string()]);
}

#[test]
fn setting_again_restarts_the_wait_and_clear_removes_it() {
    let (_tf, db) = setup();
    let first = db.set_reply_reminder(&input(24)).unwrap();
    let second = db.set_reply_reminder(&input(72)).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(db.list_reply_reminders().unwrap().len(), 1);
    assert_eq!(db.clear_reply_reminder(first.id).unwrap(), 1);
    assert!(db.list_reply_reminders().unwrap().is_empty());
}
