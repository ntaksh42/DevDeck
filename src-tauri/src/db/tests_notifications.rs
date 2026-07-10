use tempfile::NamedTempFile;

use super::*;

fn new_notification(kind: &str, org_id: Option<&str>) -> NewNotification {
    NewNotification {
        organization_id: org_id.map(str::to_string),
        kind: kind.to_string(),
        title: format!("title-{kind}"),
        body: Some(format!("body-{kind}")),
        payload: serde_json::json!({ "kind": kind }),
    }
}

#[test]
fn migrate_v18_db_upgrades_to_v19() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);

    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='notifications'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn insert_and_list_notifications_roundtrip() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    db.insert_notifications(&[
        new_notification("prReviewRequested", Some("org1")),
        new_notification("wiAssigned", Some("org1")),
    ])
    .unwrap();

    let page = db.list_notifications(10, None, false, None, None).unwrap();
    assert_eq!(page.items.len(), 2);
    assert!(!page.has_more);
    // Newest first.
    assert_eq!(page.items[0].kind, "wiAssigned");
    assert_eq!(page.items[1].kind, "prReviewRequested");
    assert_eq!(page.items[0].organization_id.as_deref(), Some("org1"));
    assert_eq!(
        page.items[0].payload,
        serde_json::json!({ "kind": "wiAssigned" })
    );
    assert!(!page.items[0].is_read);
}

#[test]
fn list_notifications_paginates_with_before_id() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    for i in 0..5 {
        db.insert_notifications(&[new_notification(&format!("kind{i}"), None)])
            .unwrap();
    }

    let first_page = db.list_notifications(2, None, false, None, None).unwrap();
    assert_eq!(first_page.items.len(), 2);
    assert!(first_page.has_more);
    assert_eq!(first_page.items[0].kind, "kind4");
    assert_eq!(first_page.items[1].kind, "kind3");

    let last_id = first_page.items[1].id;
    let second_page = db
        .list_notifications(2, Some(last_id), false, None, None)
        .unwrap();
    assert_eq!(second_page.items.len(), 2);
    assert_eq!(second_page.items[0].kind, "kind2");
    assert_eq!(second_page.items[1].kind, "kind1");
    assert!(second_page.has_more);

    let third_page = db
        .list_notifications(2, Some(second_page.items[1].id), false, None, None)
        .unwrap();
    assert_eq!(third_page.items.len(), 1);
    assert_eq!(third_page.items[0].kind, "kind0");
    assert!(!third_page.has_more);
}

#[test]
fn list_notifications_filters_by_unread_kind_and_org() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    db.insert_notifications(&[
        new_notification("prReviewRequested", Some("org1")),
        new_notification("wiAssigned", Some("org2")),
        new_notification("syncFailed", None),
    ])
    .unwrap();

    let all = db.list_notifications(10, None, false, None, None).unwrap();
    let unread_id = all.items[0].id;
    db.mark_notifications_read(&[unread_id]).unwrap();

    let unread_only = db.list_notifications(10, None, true, None, None).unwrap();
    assert_eq!(unread_only.items.len(), 2);
    assert!(unread_only.items.iter().all(|n| !n.is_read));

    let kinds = vec!["wiAssigned".to_string()];
    let by_kind = db
        .list_notifications(10, None, false, Some(&kinds), None)
        .unwrap();
    assert_eq!(by_kind.items.len(), 1);
    assert_eq!(by_kind.items[0].kind, "wiAssigned");

    let by_org = db
        .list_notifications(10, None, false, None, Some("org2"))
        .unwrap();
    assert_eq!(by_org.items.len(), 1);
    assert_eq!(by_org.items[0].organization_id.as_deref(), Some("org2"));
}

#[test]
fn unread_count_and_mark_read_operations() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    db.insert_notifications(&[
        new_notification("prReviewRequested", None),
        new_notification("wiAssigned", None),
        new_notification("syncFailed", None),
    ])
    .unwrap();

    assert_eq!(db.unread_notifications_count().unwrap(), 3);

    let all = db.list_notifications(10, None, false, None, None).unwrap();
    db.mark_notifications_read(&[all.items[0].id]).unwrap();
    assert_eq!(db.unread_notifications_count().unwrap(), 2);

    db.mark_all_notifications_read().unwrap();
    assert_eq!(db.unread_notifications_count().unwrap(), 0);
}

#[test]
fn insert_prunes_rows_older_than_30_days() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    let old_created_at = (chrono::Utc::now() - chrono::Duration::days(31)).to_rfc3339();
    {
        let conn = db.open().unwrap();
        conn.execute(
            "INSERT INTO notifications(created_at, organization_id, kind, title, body, payload, is_read) \
             VALUES (?1, NULL, 'stale', 'stale title', NULL, '{}', 0)",
            rusqlite::params![old_created_at],
        )
        .unwrap();
    }

    db.insert_notifications(&[new_notification("fresh", None)])
        .unwrap();

    let page = db.list_notifications(10, None, false, None, None).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].kind, "fresh");
}

#[test]
fn insert_prunes_rows_beyond_max_count() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();

    let records: Vec<NewNotification> = (0..1005)
        .map(|i| new_notification(&format!("kind{i}"), None))
        .collect();
    db.insert_notifications(&records).unwrap();

    let conn = db.open().unwrap();
    let remaining: i64 = conn
        .query_row("SELECT count(*) FROM notifications", [], |r| r.get(0))
        .unwrap();
    assert_eq!(remaining, 1000);

    let newest_kind: String = conn
        .query_row(
            "SELECT kind FROM notifications ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(newest_kind, "kind1004");
}
