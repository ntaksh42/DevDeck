use chrono::{Duration, SecondsFormat, Utc};
use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn setup() -> (NamedTempFile, AppDatabase) {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    upsert_organization(&conn, make_org_draft("org2")).unwrap();
    drop(conn);
    (tf, db)
}

fn item(org: &str, pr: i64, comment: i64) -> NewInboxItem {
    NewInboxItem {
        organization_id: org.to_string(),
        kind: "pr_mention".to_string(),
        subject_id: pr,
        project_id: "proj".to_string(),
        project_name: "Project".to_string(),
        repository_id: "repo".to_string(),
        repository_name: "api".to_string(),
        thread_id: comment * 10,
        comment_id: comment,
        title: format!("PR {pr}"),
        author: Some("Tanaka".to_string()),
        snippet: Some("please check".to_string()),
        web_url: Some(format!(
            "https://dev.azure.com/org1/Project/_git/api/pullrequest/{pr}"
        )),
    }
}

fn in_future(hours: i64) -> String {
    (Utc::now() + Duration::hours(hours)).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn ids(items: &[InboxItem]) -> Vec<i64> {
    items.iter().map(|i| i.id).collect()
}

#[test]
fn migrate_creates_inbox_tables_at_current_version() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    for table in ["action_inbox_items", "action_inbox_cursor"] {
        assert!(table_exists(&conn, table).unwrap(), "{table} missing");
    }
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
}

#[test]
fn inserting_the_same_comment_twice_keeps_one_row() {
    let (_tf, db) = setup();
    assert_eq!(db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap(), 1);
    assert_eq!(db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap(), 0);
    let open = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].state, "open");
    assert_eq!(open[0].kind, "pr_mention");
    assert_eq!(open[0].author.as_deref(), Some("Tanaka"));
}

#[test]
fn a_done_item_is_not_reopened_by_a_rescan() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap();
    let id = db.list_inbox_items(None, InboxListState::Open, 50).unwrap()[0].id;
    db.set_inbox_item_state(&[id], "done", None).unwrap();

    assert_eq!(db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap(), 0);
    assert!(db
        .list_inbox_items(None, InboxListState::Open, 50)
        .unwrap()
        .is_empty());
    let done = db.list_inbox_items(None, InboxListState::Done, 50).unwrap();
    assert_eq!(ids(&done), vec![id]);
    assert!(done[0].done_at.is_some());
}

#[test]
fn open_list_is_newest_first_and_scoped_by_organization() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap();
    db.insert_inbox_items(&[item("org1", 2, 200), item("org2", 3, 300)])
        .unwrap();

    let all = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    assert_eq!(all.len(), 3);
    let org1 = db
        .list_inbox_items(Some("org1"), InboxListState::Open, 50)
        .unwrap();
    assert_eq!(org1.len(), 2);
    assert!(org1[0].id > org1[1].id, "newest first");
    assert_eq!(
        db.inbox_counts(Some("org2")).unwrap(),
        InboxCounts {
            open: 1,
            snoozed: 0,
            done: 0
        }
    );
}

#[test]
fn snoozed_items_leave_the_open_list_and_count() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100), item("org1", 2, 200)])
        .unwrap();
    let open = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    let snooze_id = open[0].id;
    db.set_inbox_item_state(&[snooze_id], "snoozed", Some(&in_future(3)))
        .unwrap();

    let open_after = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    assert_eq!(open_after.len(), 1);
    assert_ne!(open_after[0].id, snooze_id);
    let snoozed = db
        .list_inbox_items(None, InboxListState::Snoozed, 50)
        .unwrap();
    assert_eq!(ids(&snoozed), vec![snooze_id]);
    assert!(snoozed[0].snoozed_until.is_some());
    assert_eq!(
        db.inbox_counts(None).unwrap(),
        InboxCounts {
            open: 1,
            snoozed: 1,
            done: 0
        }
    );
}

#[test]
fn a_snooze_past_its_deadline_counts_as_open_again() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap();
    // Write an already-expired deadline directly: the public setter rejects
    // past times, but a deadline passes while the app is running.
    let conn = db.open().unwrap();
    conn.execute(
        "UPDATE action_inbox_items SET state = 'snoozed', snoozed_until = '2000-01-01T00:00:00Z'",
        [],
    )
    .unwrap();
    drop(conn);

    assert_eq!(
        db.list_inbox_items(None, InboxListState::Open, 50)
            .unwrap()
            .len(),
        1
    );
    assert!(db
        .list_inbox_items(None, InboxListState::Snoozed, 50)
        .unwrap()
        .is_empty());
    assert_eq!(db.inbox_counts(None).unwrap().open, 1);
}

#[test]
fn state_changes_validate_input() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap();
    let id = db.list_inbox_items(None, InboxListState::Open, 50).unwrap()[0].id;

    assert!(db.set_inbox_item_state(&[id], "snoozed", None).is_err());
    assert!(db
        .set_inbox_item_state(&[id], "snoozed", Some("2000-01-01T00:00:00Z"))
        .is_err());
    assert!(db
        .set_inbox_item_state(&[id], "snoozed", Some("not a date"))
        .is_err());
    assert!(db.set_inbox_item_state(&[id], "archived", None).is_err());
    // Nothing above changed the row.
    assert_eq!(
        db.list_inbox_items(None, InboxListState::Open, 50)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(db.set_inbox_item_state(&[], "done", None).unwrap(), 0);
}

#[test]
fn reopening_a_done_item_clears_done_state() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[item("org1", 1, 100)]).unwrap();
    let id = db.list_inbox_items(None, InboxListState::Open, 50).unwrap()[0].id;
    db.set_inbox_item_state(&[id], "done", None).unwrap();
    db.set_inbox_item_state(&[id], "open", None).unwrap();

    let open = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    assert_eq!(ids(&open), vec![id]);
    assert!(open[0].done_at.is_none());
    assert!(open[0].snoozed_until.is_none());
}

#[test]
fn open_refs_for_pr_exclude_done_items_and_other_prs() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[
        item("org1", 1, 100),
        item("org1", 1, 101),
        item("org1", 2, 200),
    ])
    .unwrap();
    let done_id = db
        .list_inbox_items(None, InboxListState::Open, 50)
        .unwrap()
        .into_iter()
        .find(|i| i.comment_id == 101)
        .unwrap()
        .id;
    db.set_inbox_item_state(&[done_id], "done", None).unwrap();

    let refs = db.open_inbox_refs_for_pr("org1", "repo", 1).unwrap();
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].comment_id, 100);
    assert_eq!(refs[0].thread_id, 1000);
}

#[test]
fn comment_cursor_only_moves_forward() {
    let (_tf, db) = setup();
    assert_eq!(
        db.get_inbox_comment_cursor("org1", "repo", 1).unwrap(),
        None
    );
    db.set_inbox_comment_cursor("org1", "repo", 1, 50).unwrap();
    db.set_inbox_comment_cursor("org1", "repo", 1, 40).unwrap();
    assert_eq!(
        db.get_inbox_comment_cursor("org1", "repo", 1).unwrap(),
        Some(50)
    );
    db.set_inbox_comment_cursor("org1", "repo", 1, 60).unwrap();
    assert_eq!(
        db.get_inbox_comment_cursor("org1", "repo", 1).unwrap(),
        Some(60)
    );
}
