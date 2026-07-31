use rusqlite::params;
use tempfile::NamedTempFile;

use super::snooze::{list_snoozed_items, upsert_snoozed_item};
use super::test_support::make_org_draft;
use super::*;

#[test]
fn open_applies_connection_pragmas() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();

    let conn = db.open().unwrap();
    let synchronous: i64 = conn
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .unwrap();
    assert_eq!(synchronous, 1, "synchronous should be NORMAL");
    let busy_timeout: i64 = conn
        .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
        .unwrap();
    assert_eq!(busy_timeout, 3000);
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode, "wal");
}

#[test]
fn open_upgrades_existing_non_wal_db_to_wal() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let path = db_file.path().to_path_buf();

    // Simulate a pre-existing DB that is on a rollback journal rather than
    // WAL (e.g. created before WAL was applied, or downgraded externally).
    {
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update_and_check(None, "journal_mode", "DELETE", |_| Ok(()))
            .unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "delete", "DB should start in a non-WAL mode");
    }

    let db = AppDatabase::new(path);
    let conn = db.open().unwrap();
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode, "wal", "open() should re-apply WAL");
}

#[test]
fn pr_comment_seen_roundtrips() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org")).unwrap();
    assert_eq!(get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(), None);
    set_pr_comment_seen(&conn, "org", "repo", 42, 100).unwrap();
    assert_eq!(
        get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(),
        Some(100)
    );
    set_pr_comment_seen(&conn, "org", "repo", 42, 150).unwrap();
    assert_eq!(
        get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(),
        Some(150)
    );
}

#[test]
fn snoozed_items_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org")).unwrap();

    assert!(list_snoozed_items(&conn, "org", "pull_request")
        .unwrap()
        .is_empty());

    upsert_snoozed_item(
        &conn,
        "org",
        "pull_request",
        "repo:42",
        "2026-06-20T09:00:00Z",
        Some("100"),
    )
    .unwrap();
    upsert_snoozed_item(&conn, "org", "work_item", "7", "2026-06-18T09:00:00Z", None).unwrap();

    let prs = list_snoozed_items(&conn, "org", "pull_request").unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].item_key, "repo:42");
    assert_eq!(prs[0].baseline_activity.as_deref(), Some("100"));

    // Re-snoozing the same key updates the deadline and baseline in place.
    upsert_snoozed_item(
        &conn,
        "org",
        "pull_request",
        "repo:42",
        "2026-06-25T09:00:00Z",
        Some("150"),
    )
    .unwrap();
    let prs = list_snoozed_items(&conn, "org", "pull_request").unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0].snooze_until, "2026-06-25T09:00:00Z");
    assert_eq!(prs[0].baseline_activity.as_deref(), Some("150"));

    let work_items = list_snoozed_items(&conn, "org", "work_item").unwrap();
    assert_eq!(work_items.len(), 1);
    assert_eq!(work_items[0].baseline_activity, None);
}

#[test]
fn upsert_preserves_created_at_and_updates_user() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();

    let first = upsert_organization(
        &conn,
        OrganizationDraft {
            authenticated_user_id: Some("user-1".to_string()),
            authenticated_user_display_name: Some("First User".to_string()),
            ..make_org_draft("contoso")
        },
    )
    .unwrap();

    let second = upsert_organization(
        &conn,
        OrganizationDraft {
            authenticated_user_id: Some("user-2".to_string()),
            authenticated_user_display_name: Some("Second User".to_string()),
            ..make_org_draft("contoso")
        },
    )
    .unwrap();

    assert_eq!(first.created_at, second.created_at);
    assert_eq!(
        second.authenticated_user_display_name.as_deref(),
        Some("Second User")
    );
    assert_eq!(list_organizations(&conn).unwrap().len(), 1);
}

#[test]
fn app_settings_can_be_saved_and_cleared() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();

    assert_eq!(get_app_settings(&conn).unwrap(), AppSettings::default());

    let saved = update_app_settings(
        &conn,
        AppSettings {
            review_result_folder_path: Some("C:/reports".to_string()),
            show_window_hotkey: Some("Ctrl+Alt+D".to_string()),
            read_only_validation_mode_enabled: true,
            desktop_notifications_enabled: true,
            notification_content_preview_enabled: false,
            notify_work_item_assignments: true,
            notify_work_item_state_changes: false,
            notify_pr_review_requests: false,
            notify_pr_vote_resets: true,
            notify_pr_comment_replies: false,
            quiet_hours_enabled: true,
            quiet_hours_start: "23:30".to_string(),
            quiet_hours_end: "06:15".to_string(),
            review_stale_threshold_days: 7,
            work_item_stale_threshold_days: 14,
            notification_rules: vec![NotificationRule {
                types: vec!["reviewRequested".to_string()],
                projects: vec!["Platform".to_string()],
                repositories: Vec::new(),
                mute: false,
            }],
        },
    )
    .unwrap();
    assert_eq!(
        saved.review_result_folder_path.as_deref(),
        Some("C:/reports")
    );
    assert_eq!(saved.review_stale_threshold_days, 7);
    assert_eq!(saved.work_item_stale_threshold_days, 14);
    assert_eq!(saved.notification_rules.len(), 1);
    assert_eq!(saved.notification_rules[0].types, vec!["reviewRequested"]);
    assert_eq!(saved.notification_rules[0].projects, vec!["Platform"]);
    assert_eq!(saved.show_window_hotkey.as_deref(), Some("Ctrl+Alt+D"));
    assert!(saved.read_only_validation_mode_enabled);
    assert!(saved.desktop_notifications_enabled);
    assert!(!saved.notification_content_preview_enabled);
    assert!(saved.notify_work_item_assignments);
    assert!(!saved.notify_work_item_state_changes);
    assert!(!saved.notify_pr_review_requests);
    assert!(saved.notify_pr_vote_resets);
    assert!(!saved.notify_pr_comment_replies);
    assert!(saved.quiet_hours_enabled);
    assert_eq!(saved.quiet_hours_start, "23:30");
    assert_eq!(saved.quiet_hours_end, "06:15");

    let cleared = update_app_settings(
        &conn,
        AppSettings {
            review_result_folder_path: Some("   ".to_string()),
            show_window_hotkey: Some("   ".to_string()),
            ..AppSettings::default()
        },
    )
    .unwrap();
    assert_eq!(cleared, AppSettings::default());
}

#[test]
fn cascade_delete_clears_cache() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    conn.execute(
        "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
        params!["org1", "p1", "P1", 1_i64, "Test task"],
    )
    .unwrap();
    conn.execute(
        r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        params!["org1", "p1", "P1", "r1", "Repo", "sha1", "initial commit"],
    )
    .unwrap();

    let wi_count: i64 = conn
        .query_row("SELECT count(*) FROM work_items", [], |r| r.get(0))
        .unwrap();
    let fts_wi: i64 = conn
        .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
        .unwrap();
    let c_count: i64 = conn
        .query_row("SELECT count(*) FROM commits", [], |r| r.get(0))
        .unwrap();
    let fts_c: i64 = conn
        .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!((wi_count, fts_wi, c_count, fts_c), (1, 1, 1, 1));

    conn.execute("DELETE FROM organizations WHERE id = 'org1'", [])
        .unwrap();

    let wi_count: i64 = conn
        .query_row("SELECT count(*) FROM work_items", [], |r| r.get(0))
        .unwrap();
    let fts_wi: i64 = conn
        .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
        .unwrap();
    let c_count: i64 = conn
        .query_row("SELECT count(*) FROM commits", [], |r| r.get(0))
        .unwrap();
    let fts_c: i64 = conn
        .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!((wi_count, fts_wi, c_count, fts_c), (0, 0, 0, 0));
}

#[test]
fn sync_state_upsert_and_read() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    db.update_sync_state(
        "prs:org1",
        "org1",
        Some("2024-01-01T00:00:00Z"),
        0,
        None,
        Some("warning"),
    )
    .unwrap();
    let state = db.get_sync_state("prs:org1").unwrap().unwrap();
    assert_eq!(state.error_count, 0);
    assert_eq!(
        state.last_synced_at.as_deref(),
        Some("2024-01-01T00:00:00Z")
    );
    assert_eq!(state.last_warning.as_deref(), Some("warning"));

    db.update_sync_state("prs:org1", "org1", None, 2, Some("timeout"), None)
        .unwrap();
    let state = db.get_sync_state("prs:org1").unwrap().unwrap();
    assert_eq!(state.error_count, 2);
    assert_eq!(state.last_error.as_deref(), Some("timeout"));
    assert_eq!(state.last_warning, None);
    // A failed sync must not erase the last successful sync timestamp.
    assert_eq!(
        state.last_synced_at.as_deref(),
        Some("2024-01-01T00:00:00Z")
    );
}

#[test]
fn list_mention_history_ranks_by_interaction_count() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    db.record_mention_interaction(
        "org1",
        "alice@corp.com",
        "Alice",
        None,
        "2026-06-01T00:00:00Z",
    )
    .unwrap();
    db.record_mention_interaction(
        "org1",
        "bob@corp.com",
        "Bob",
        Some("bob-id"),
        "2026-06-02T00:00:00Z",
    )
    .unwrap();
    db.record_mention_interaction("org1", "bob@corp.com", "Bob", None, "2026-06-03T00:00:00Z")
        .unwrap();

    let entries = db.list_mention_history("org1", 10).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].unique_name, "bob@corp.com");
    assert_eq!(entries[0].display_name, "Bob");
    assert_eq!(entries[0].user_id.as_deref(), Some("bob-id"));
    assert_eq!(entries[1].unique_name, "alice@corp.com");
}

#[test]
fn list_assignee_history_ranks_by_interaction_count() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    db.record_assignee_interaction(
        "org1",
        "alice@corp.com",
        "Alice",
        None,
        "2026-06-01T00:00:00Z",
    )
    .unwrap();
    db.record_assignee_interaction(
        "org1",
        "bob@corp.com",
        "Bob",
        Some("bob-id"),
        "2026-06-02T00:00:00Z",
    )
    .unwrap();
    db.record_assignee_interaction("org1", "bob@corp.com", "Bob", None, "2026-06-03T00:00:00Z")
        .unwrap();

    let entries = db.list_assignee_history("org1", 10).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].unique_name, "bob@corp.com");
    assert_eq!(entries[0].display_name, "Bob");
    assert_eq!(entries[0].user_id.as_deref(), Some("bob-id"));
    assert_eq!(entries[1].unique_name, "alice@corp.com");

    // Assignee history must stay separate from mention history.
    assert!(db.list_mention_history("org1", 10).unwrap().is_empty());
}

#[test]
fn search_work_items_fts_falls_back_to_like_for_cjk_substrings() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    conn.execute(
        "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
        params!["org1", "p1", "Project One", 7_i64, "ユーザーログイン機能を修正"],
    )
    .unwrap();

    // Mid-string CJK term: FTS prefix queries cannot match, LIKE fallback should.
    let results = search_work_items_fts(&conn, "org1", "修正").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, 7);

    let results = search_work_items_fts(&conn, "org1", "存在しない語").unwrap();
    assert!(results.is_empty());
}
