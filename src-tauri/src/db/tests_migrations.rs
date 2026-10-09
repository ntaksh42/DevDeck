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
            "SELECT count(*) FROM sqlite_master WHERE name IN ('commits', 'commits_fts', 'commit_prs')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);

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

#[test]
fn migrate_v19_db_upgrades_to_v20_adds_pr_author_id_column() {
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
            CREATE TABLE pull_requests(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                repository_id TEXT NOT NULL, repository_name TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
                created_by TEXT, creation_date TEXT NOT NULL, source_ref_name TEXT NOT NULL,
                target_ref_name TEXT NOT NULL, web_url TEXT, is_draft INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (org_id, repository_id, pull_request_id));
            INSERT INTO organizations VALUES('org1','org1',NULL,'https://dev.azure.com/org1','pat','key',NULL,NULL,'2024-01-01','2024-01-01');
            INSERT INTO pull_requests(org_id, project_id, project_name, repository_id, repository_name,
                pull_request_id, title, status, created_by, creation_date, source_ref_name, target_ref_name, web_url, is_draft)
                VALUES('org1', 'p1', 'P1', 'repo1', 'Repo1', 42, 'Old PR', 'active', 'Alice',
                    '2024-01-01T00:00:00Z', 'feature', 'main', NULL, 0);
            PRAGMA user_version = 19;
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

    // Pre-existing row survived and created_by_id defaulted to NULL, since it
    // did not exist before this migration (waypoint falls back to is_mine =
    // false in that case rather than erroring).
    let results = db.search_pull_requests("org1", None, None, None).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].created_by.as_deref(), Some("Alice"));
    assert_eq!(results[0].created_by_id, None);
}

#[test]
fn migrate_v22_db_drops_commit_cache_and_sync_rows() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    // Rebuild what a v22 database still carried for the removed Commits view.
    conn.execute_batch(
        r#"
        CREATE TABLE commits(org_id TEXT, repository_id TEXT, commit_id TEXT);
        CREATE VIRTUAL TABLE commits_fts USING fts5(comment);
        CREATE TABLE commit_prs(org_id TEXT, commit_id TEXT);
        INSERT INTO organizations(id, name, base_url, auth_provider, credential_key, created_at, updated_at)
            VALUES('org1', 'org1', 'https://dev.azure.com/org1', 'pat', 'key', '2024-01-01', '2024-01-01');
        INSERT INTO sync_state(scope, org_id) VALUES
            ('commits:org1', 'org1'),
            ('internal:commit_full_sync:org1', 'org1'),
            ('prs:org1', 'org1');
        PRAGMA user_version = 22;
        "#,
    )
    .unwrap();

    migrate(&conn).unwrap();

    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name IN ('commits', 'commits_fts', 'commit_prs')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0);
    let scopes: Vec<String> = conn
        .prepare("SELECT scope FROM sync_state ORDER BY scope")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert_eq!(scopes, vec!["prs:org1".to_string()]);
}
