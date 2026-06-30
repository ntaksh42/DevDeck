use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn sample_item(work_item_id: i64, title: &str) -> CachedFollowedWorkItem {
    CachedFollowedWorkItem {
        work_item_id,
        project_id: "p1".to_string(),
        project_name: "Project One".to_string(),
        title: title.to_string(),
        work_item_type: Some("Bug".to_string()),
        state: Some("Active".to_string()),
        assigned_to: Some("Alice".to_string()),
        web_url: Some("https://dev.azure.com/org1/p1/_workitems/edit/42".to_string()),
        followed_at: "2026-06-01T00:00:00Z".to_string(),
    }
}

#[test]
fn follow_unfollow_roundtrip() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    drop(conn);

    assert!(db.list_followed_work_items("org1").unwrap().is_empty());

    db.upsert_followed_work_item("org1", &sample_item(42, "Fix login"))
        .unwrap();

    let items = db.list_followed_work_items("org1").unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].work_item_id, 42);
    assert_eq!(items[0].title, "Fix login");

    db.delete_followed_work_item("org1", 42).unwrap();
    assert!(db.list_followed_work_items("org1").unwrap().is_empty());
}

#[test]
fn follow_is_scoped_per_organization() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    upsert_organization(&conn, make_org_draft("org2")).unwrap();
    drop(conn);

    db.upsert_followed_work_item("org1", &sample_item(1, "Org1 item"))
        .unwrap();
    db.upsert_followed_work_item("org2", &sample_item(1, "Org2 item"))
        .unwrap();

    assert_eq!(db.list_followed_work_items("org1").unwrap().len(), 1);
    assert_eq!(db.list_followed_work_items("org2").unwrap().len(), 1);

    db.delete_followed_work_item("org1", 1).unwrap();
    assert!(db.list_followed_work_items("org1").unwrap().is_empty());
    assert_eq!(db.list_followed_work_items("org2").unwrap().len(), 1);
}

#[test]
fn re_following_refreshes_the_snapshot() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    drop(conn);

    db.upsert_followed_work_item("org1", &sample_item(42, "Fix login"))
        .unwrap();
    let mut updated = sample_item(42, "Fix login timeout");
    updated.state = Some("Resolved".to_string());
    db.upsert_followed_work_item("org1", &updated).unwrap();

    let items = db.list_followed_work_items("org1").unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].title, "Fix login timeout");
    assert_eq!(items[0].state.as_deref(), Some("Resolved"));
}

#[test]
fn migrate_v17_db_upgrades_to_v18() {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE organizations(id TEXT PRIMARY KEY);
        PRAGMA user_version = 17;
        "#,
    )
    .unwrap();

    migrate(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);

    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='followed_work_items'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
