use rusqlite::params;
use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

#[test]
fn work_items_fts_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    conn.execute(
        "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
        params!["org1", "p1", "Project One", 42_i64, "fix the login bug"],
    )
    .unwrap();

    let results = search_work_items_fts(&conn, "org1", "login").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, 42);

    // Re-upsert same PK: FTS must not duplicate
    conn.execute(
        "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
        params!["org1", "p1", "Project One", 42_i64, "fix the login timeout bug"],
    )
    .unwrap();

    let fts_count: i64 = conn
        .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fts_count, 1);

    let results = search_work_items_fts(&conn, "org1", "timeout").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "fix the login timeout bug");
}

#[test]
fn search_work_items_fts_matches_assigned_to_unique_name() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    conn.execute(
        "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title, assigned_to, assigned_to_unique_name) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            "org1",
            "p1",
            "Project One",
            7_i64,
            "improve search",
            "Jane Doe",
            "jane.doe@example.com"
        ],
    )
    .unwrap();

    // Full-text match on the unique name (email) token.
    let results = search_work_items_fts(&conn, "org1", "jane.doe@example.com").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, 7);
}

#[test]
fn search_work_items_fts_matches_numeric_query_by_id() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    for (id, title) in [
        (42_i64, "fix the login bug"),
        (421_i64, "label 42 spike"),
        (9_i64, "error 42 cascade"),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["org1", "p1", "Project One", id, title],
        )
        .unwrap();
    }

    let results = search_work_items_fts(&conn, "org1", "42").unwrap();
    let ids: Vec<i64> = results.iter().map(|item| item.id).collect();
    // Exact ID match first, prefix and title matches follow without duplicates.
    assert_eq!(ids[0], 42);
    assert!(ids.contains(&421));
    assert!(ids.contains(&9));
    assert_eq!(ids.len(), 3);
}

#[test]
fn search_work_items_fts_orders_mixed_matches_by_changed_date_desc() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    // A numeric query produces both id-prefix matches and FTS text matches.
    // They must be merged into a single changed_date DESC ordering.
    for (id, title, changed) in [
        (42_i64, "id prefix match", "2024-01-01T00:00:00Z"),
        (421_i64, "another id prefix", "2024-05-01T00:00:00Z"),
        (9_i64, "release 42 text match", "2024-03-01T00:00:00Z"),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title, changed_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["org1", "p1", "Project One", id, title, changed],
        )
        .unwrap();
    }

    let results = search_work_items_fts(&conn, "org1", "42").unwrap();
    let changed: Vec<Option<String>> = results
        .iter()
        .map(|item| item.changed_date.clone())
        .collect();
    let mut sorted = changed.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(changed, sorted);
    assert_eq!(results[0].id, 421);
}

fn make_cached_wi(id: i64, title: &str, changed: &str) -> CachedWorkItem {
    CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "Project One".to_string(),
        id,
        title: title.to_string(),
        work_item_type: Some("Task".to_string()),
        state: Some("Active".to_string()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: Some(changed.to_string()),
        web_url: None,
        tags: None,
    }
}

#[test]
fn replace_work_items_skips_unchanged_rows_and_deletes_stale() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    db.replace_work_items(
        "org1",
        &["p1"],
        &[
            make_cached_wi(1, "first item", "2026-06-01T00:00:00Z"),
            make_cached_wi(2, "second item", "2026-06-01T00:00:00Z"),
        ],
        &[],
    )
    .unwrap();

    let conn = db.open().unwrap();
    let rowid_query = "SELECT rowid FROM work_items WHERE org_id = 'org1' AND id = 1";
    let rowid_before: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();

    // Re-sync: item 1 is unchanged, item 2 has a new revision.
    db.replace_work_items(
        "org1",
        &["p1"],
        &[
            make_cached_wi(1, "first item", "2026-06-01T00:00:00Z"),
            make_cached_wi(2, "second item edited", "2026-06-02T00:00:00Z"),
        ],
        &[],
    )
    .unwrap();

    let rowid_after: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();
    assert_eq!(
        rowid_before, rowid_after,
        "unchanged rows must not be rewritten"
    );
    let results = search_work_items_fts(&conn, "org1", "edited").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, 2);

    // Items missing from the snapshot are deleted, including their FTS rows.
    db.replace_work_items(
        "org1",
        &["p1"],
        &[make_cached_wi(1, "first item", "2026-06-01T00:00:00Z")],
        &[],
    )
    .unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM work_items WHERE org_id = 'org1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert!(search_work_items_fts(&conn, "org1", "second")
        .unwrap()
        .is_empty());
}

#[test]
fn update_my_work_item_removes_row_when_reassigned_away() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let mine = CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        id: 5,
        title: "owned by me".to_string(),
        work_item_type: None,
        state: Some("Active".to_string()),
        assigned_to: Some("Me".to_string()),
        assigned_to_unique_name: Some("me@example.com".to_string()),
        changed_date: None,
        web_url: None,
        tags: None,
    };
    db.replace_work_items(
        "org1",
        &["p1"],
        std::slice::from_ref(&mine),
        std::slice::from_ref(&mine),
    )
    .unwrap();
    assert_eq!(db.list_my_work_items("org1").unwrap().len(), 1);

    // Reassigned to someone else: the row must leave the my_work_items view.
    let reassigned = CachedWorkItem {
        assigned_to: Some("Other".to_string()),
        assigned_to_unique_name: Some("other@example.com".to_string()),
        ..mine.clone()
    };
    db.update_my_work_item_if_present(&reassigned, Some("me@example.com"))
        .unwrap();
    assert!(
        db.list_my_work_items("org1").unwrap().is_empty(),
        "reassigning away should drop the row immediately"
    );
}

#[test]
fn update_my_work_item_keeps_row_when_still_mine() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let mine = CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        id: 5,
        title: "owned by me".to_string(),
        work_item_type: None,
        state: Some("Active".to_string()),
        assigned_to: Some("Me".to_string()),
        assigned_to_unique_name: Some("me@example.com".to_string()),
        changed_date: None,
        web_url: None,
        tags: None,
    };
    db.replace_work_items(
        "org1",
        &["p1"],
        std::slice::from_ref(&mine),
        std::slice::from_ref(&mine),
    )
    .unwrap();

    // State edit while still assigned to me: row stays and is updated.
    let updated = CachedWorkItem {
        state: Some("Closed".to_string()),
        ..mine.clone()
    };
    db.update_my_work_item_if_present(&updated, Some("ME@EXAMPLE.COM"))
        .unwrap();
    let rows = db.list_my_work_items("org1").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].state.as_deref(), Some("Closed"));
}

#[test]
fn apply_work_item_updates_batches_upsert_and_my_items() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let mine = |id: i64, state: &str| CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        id,
        title: format!("item {id}"),
        work_item_type: None,
        state: Some(state.to_string()),
        assigned_to: Some("Me".to_string()),
        assigned_to_unique_name: Some("me@example.com".to_string()),
        changed_date: Some(format!("2024-01-0{id}T00:00:00Z")),
        web_url: None,
        tags: None,
    };

    let seed = [mine(1, "Active"), mine(2, "Active")];
    db.replace_work_items("org1", &["p1"], &seed, &seed)
        .unwrap();
    assert_eq!(db.list_my_work_items("org1").unwrap().len(), 2);

    // Item 1 stays mine but changes state; item 2 is reassigned away.
    let item1 = CachedWorkItem {
        state: Some("Closed".to_string()),
        changed_date: Some("2024-02-01T00:00:00Z".to_string()),
        ..mine(1, "Active")
    };
    let item2 = CachedWorkItem {
        assigned_to: Some("Other".to_string()),
        assigned_to_unique_name: Some("other@example.com".to_string()),
        changed_date: Some("2024-02-02T00:00:00Z".to_string()),
        ..mine(2, "Active")
    };
    db.apply_work_item_updates(&[item1, item2], Some("me@example.com"))
        .unwrap();

    // work_items reflects both edits.
    let all = db
        .search_work_items("org1", None, None, None, None)
        .unwrap();
    let state_of = |id: i64| {
        all.iter()
            .find(|w| w.id == id)
            .and_then(|w| w.state.clone())
    };
    assert_eq!(state_of(1).as_deref(), Some("Closed"));
    assert_eq!(
        all.iter()
            .find(|w| w.id == 2)
            .and_then(|w| w.assigned_to.clone())
            .as_deref(),
        Some("Other")
    );

    // my_work_items: item 1 updated in place, item 2 dropped.
    let mine_rows = db.list_my_work_items("org1").unwrap();
    assert_eq!(mine_rows.len(), 1);
    assert_eq!(mine_rows[0].id, 1);
    assert_eq!(mine_rows[0].state.as_deref(), Some("Closed"));
}

#[test]
fn replace_work_items_clears_and_repopulates_both_tables() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make_item = |id: i64, title: &str| CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        id,
        title: title.to_string(),
        work_item_type: None,
        state: None,
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: None,
        web_url: None,
        tags: None,
    };

    // Seed both tables (distinct IDs per table: work=1, my=10)
    db.replace_work_items(
        "org1",
        &["p1"],
        &[make_item(1, "all-A")],
        &[make_item(10, "my-A")],
    )
    .unwrap();

    // Replace with B-rows (work=2, my=20); A-rows must disappear
    db.replace_work_items(
        "org1",
        &["p1"],
        &[make_item(2, "all-B")],
        &[make_item(20, "my-B")],
    )
    .unwrap();

    let all = db
        .search_work_items("org1", None, None, None, None)
        .unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, 2, "work_items should contain only all-B");

    let my = db.list_my_work_items("org1").unwrap();
    assert_eq!(my.len(), 1);
    assert_eq!(my[0].id, 20, "my_work_items should contain only my-B");
}

#[test]
fn replace_work_items_preserves_unsynced_project_rows() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make_item = |id: i64, project_id: &str| CachedWorkItem {
        org_id: "org1".to_string(),
        project_id: project_id.to_string(),
        project_name: project_id.to_uppercase(),
        id,
        title: format!("item-{id}"),
        work_item_type: None,
        state: None,
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: None,
        web_url: None,
        tags: None,
    };

    // Seed p1 and p2
    db.replace_work_items(
        "org1",
        &["p1", "p2"],
        &[make_item(1, "p1"), make_item(2, "p2")],
        &[make_item(10, "p1"), make_item(20, "p2")],
    )
    .unwrap();

    // Re-sync only p1 — p2 must be preserved
    db.replace_work_items(
        "org1",
        &["p1"],
        &[make_item(3, "p1")],
        &[make_item(30, "p1")],
    )
    .unwrap();

    let all_ids: Vec<i64> = db
        .search_work_items("org1", None, None, None, None)
        .unwrap()
        .iter()
        .map(|w| w.id)
        .collect();
    assert!(!all_ids.contains(&1), "old p1 row must be replaced");
    assert!(all_ids.contains(&2), "p2 row must be preserved");
    assert!(all_ids.contains(&3), "new p1 row must be present");

    let my_ids: Vec<i64> = db
        .list_my_work_items("org1")
        .unwrap()
        .iter()
        .map(|w| w.id)
        .collect();
    assert!(!my_ids.contains(&10), "old p1 my row must be replaced");
    assert!(my_ids.contains(&20), "p2 my row must be preserved");
    assert!(my_ids.contains(&30), "new p1 my row must be present");
}
