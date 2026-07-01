use tempfile::NamedTempFile;

use super::*;

#[test]
fn migrate_is_repeatable() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    migrate(&conn).unwrap();
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
}

#[test]
fn migrate_v1_db_upgrades_to_latest() {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS organizations(
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT,
            base_url TEXT NOT NULL, auth_provider TEXT NOT NULL, credential_key TEXT NOT NULL,
            authenticated_user_id TEXT, authenticated_user_display_name TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
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
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='commits'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);

    let fts_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='work_items_fts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fts_count, 1);

    let mywi_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='my_work_items'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mywi_count, 1);
}

#[test]
fn migrate_v1_db_adds_committer_and_avatar_columns_to_commits() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();

    for column in [
        "committer_name",
        "committer_email",
        "committer_date",
        "author_image_url",
    ] {
        assert!(
            table_column_exists(&conn, "commits", column).unwrap(),
            "commits table must have a {column} column"
        );
    }
}

#[test]
fn migrate_v2_db_upgrades_to_v3() {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE organizations(id TEXT PRIMARY KEY);
        CREATE TABLE work_items(
            org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
            id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
            assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
        PRAGMA user_version = 2;
        "#,
    )
    .unwrap();

    migrate(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);

    let mywi_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='my_work_items'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mywi_count, 1);
}

#[test]
fn migrate_v3_db_upgrades_to_v4() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    {
        let conn = db.open().unwrap();
        // Bring the DB to v3 manually
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
            .unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                display_name TEXT, base_url TEXT NOT NULL, auth_provider TEXT NOT NULL,
                credential_key TEXT NOT NULL, authenticated_user_id TEXT,
                authenticated_user_display_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE work_items(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
            CREATE TABLE my_work_items(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
            INSERT INTO organizations VALUES('org1','org1',NULL,'https://dev.azure.com/org1','pat','key',NULL,NULL,'2024-01-01','2024-01-01');
            INSERT INTO work_items(org_id, project_id, project_name, id, title, assigned_to)
                VALUES('org1', 'p1', 'P1', 1, 'Old item', 'Alice');
            PRAGMA user_version = 3;
            "#,
        )
        .unwrap();
    }
    db.initialize().unwrap();

    let version: i64 = db
        .open()
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);

    // Pre-existing row survived and assigned_to_unique_name defaulted to NULL
    let results = db
        .search_work_items("org1", None, None, None, None)
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].assigned_to.as_deref(), Some("Alice"));
}

#[test]
fn migrate_v4_db_upgrades_to_v5() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    {
        let conn = db.open().unwrap();
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
            .unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                display_name TEXT, base_url TEXT NOT NULL, auth_provider TEXT NOT NULL,
                credential_key TEXT NOT NULL, authenticated_user_id TEXT,
                authenticated_user_display_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE work_items(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                assigned_to TEXT, changed_date TEXT, web_url TEXT,
                assigned_to_unique_name TEXT,
                PRIMARY KEY (org_id, id));
            CREATE TABLE my_work_items(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                assigned_to TEXT, changed_date TEXT, web_url TEXT,
                assigned_to_unique_name TEXT,
                PRIMARY KEY (org_id, id));
            CREATE VIRTUAL TABLE work_items_fts USING fts5(
                org_id UNINDEXED, item_id UNINDEXED, title);
            CREATE TRIGGER work_items_fts_ai AFTER INSERT ON work_items BEGIN
                INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                VALUES (new.rowid, new.org_id, new.id, new.title);
            END;
            CREATE TRIGGER work_items_fts_ad AFTER DELETE ON work_items BEGIN
                DELETE FROM work_items_fts WHERE rowid = old.rowid;
            END;
            CREATE TRIGGER work_items_fts_au AFTER UPDATE ON work_items BEGIN
                DELETE FROM work_items_fts WHERE rowid = old.rowid;
                INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                VALUES (new.rowid, new.org_id, new.id, new.title);
            END;
            INSERT INTO organizations VALUES('org1','org1',NULL,'https://dev.azure.com/org1','pat','key',NULL,NULL,'2024-01-01','2024-01-01');
            INSERT INTO work_items(org_id, project_id, project_name, id, title, work_item_type, assigned_to)
                VALUES('org1', 'p1', 'P1', 1, 'Fix login', 'Bug', 'Alice');
            PRAGMA user_version = 4;
            "#,
        )
        .unwrap();
    }
    db.initialize().unwrap();

    let version: i64 = db
        .open()
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);

    // Pre-existing row is still present and searchable by assignee name via FTS
    let results = db.search_work_items_fts("org1", "Alice").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].assigned_to.as_deref(), Some("Alice"));
}
