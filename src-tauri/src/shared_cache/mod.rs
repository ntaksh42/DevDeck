//! Neutral, cross-app shared cache for Azure DevOps Active PR / Work Item
//! data.
//!
//! waypoint (a separate, unrelated repository — a Windows launcher with its
//! own Quick Launch search) polls the same Azure DevOps organization
//! independently of DevDeck's background sync. Rather than either app
//! depending on the other's private schema, both write into and read from
//! this small, neutral SQLite file at `%APPDATA%\AzDoSharedCache\cache.db`.
//! Neither app imports the other's crate or types; this module and its
//! counterpart in waypoint only agree on the table shapes below.
//!
//! Fields here are limited to raw Azure DevOps facts (title, status, the
//! author's identity, reviewers and their votes, ...). Per-viewer judgments
//! like "is this mine" are deliberately not stored — each consumer computes
//! that itself by comparing `created_by_id` / `reviewer_id` against its own
//! resolved identity. Anything specific to one app's own feature set (e.g.
//! DevDeck's CI-status enrichment or My Reviews votes) stays in that app's
//! private cache and is not part of this contract.
//!
//! Freshness is tracked per `(organization, project, kind)` in `sync_state`,
//! separately from the entry rows themselves, so a reader can check "is this
//! fresh enough" without touching the entry tables. How stale a caller is
//! willing to accept is that caller's own policy, not part of this schema.
//!
//! A `pull_requests` snapshot for a scope must be that project's complete
//! active PR list together with every reviewer of those PRs: a reader that
//! finds the scope fresh replaces its own rows with it. A writer whose fetch
//! was truncated must not mark the scope synced.

mod pull_requests;
mod work_items;

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, Result};

pub use pull_requests::{
    read_pull_requests, read_reviewers, write_pull_requests, SharedPullRequest, SharedReviewer,
};
pub use work_items::{upsert_work_items, write_work_items, SharedWorkItem};

#[cfg(not(test))]
const DIR_NAME: &str = "AzDoSharedCache";
#[cfg(not(test))]
const FILE_NAME: &str = "cache.db";

/// Identifies who most recently refreshed a scope, for debugging/visibility
/// only (never used in any freshness decision).
pub const SYNCED_BY: &str = "devdeck";

#[cfg(not(test))]
pub fn path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join(DIR_NAME).join(FILE_NAME))
}

/// Integration tests exercise real sync code paths (`do_sync_prs`,
/// `do_sync_work_items`) that write through `shared_cache::open()`. Without
/// this override, every `cargo test` run would write fixture data into the
/// real machine-wide `%APPDATA%\AzDoSharedCache\cache.db` that waypoint also
/// reads. Each test function runs on its own freshly spawned thread under
/// the default test harness, so a thread-local, once-per-thread temp path
/// keeps every test's shared cache isolated from both the real file and
/// from other tests.
#[cfg(test)]
pub fn path() -> Option<PathBuf> {
    use std::sync::atomic::{AtomicU64, Ordering};

    thread_local! {
        static PATH: PathBuf = {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let id = COUNTER.fetch_add(1, Ordering::Relaxed);
            std::env::temp_dir().join(format!(
                "devdeck-shared-cache-test-{}-{}.db",
                std::process::id(),
                id
            ))
        };
    }
    Some(PATH.with(PathBuf::clone))
}

pub fn open() -> Result<Connection> {
    open_at(path())
}

/// Opens the file at `path` (as returned by [`path`]). Callers that move the
/// I/O onto a blocking thread resolve the path first, on their own thread.
pub fn open_at(path: Option<PathBuf>) -> Result<Connection> {
    let path = path.ok_or_else(|| AppError::Database("APPDATA is unavailable".to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(3))?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pull_requests (
            organization      TEXT NOT NULL,
            project           TEXT NOT NULL,
            repository_id     TEXT NOT NULL,
            repository_name   TEXT NOT NULL,
            pull_request_id   INTEGER NOT NULL,
            title             TEXT NOT NULL,
            status            TEXT NOT NULL,
            created_by        TEXT,
            created_by_id     TEXT,
            creation_date     TEXT NOT NULL,
            source_ref_name   TEXT NOT NULL,
            target_ref_name   TEXT NOT NULL,
            is_draft          INTEGER NOT NULL DEFAULT 0,
            web_url           TEXT,
            PRIMARY KEY (organization, repository_id, pull_request_id)
        );

        CREATE TABLE IF NOT EXISTS pull_request_reviewers (
            organization     TEXT NOT NULL,
            project          TEXT NOT NULL,
            repository_id    TEXT NOT NULL,
            pull_request_id  INTEGER NOT NULL,
            reviewer_id      TEXT NOT NULL,
            vote             INTEGER NOT NULL,
            is_required      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organization, project, repository_id, pull_request_id, reviewer_id)
        );

        CREATE TABLE IF NOT EXISTS work_items (
            organization             TEXT NOT NULL,
            project                  TEXT NOT NULL,
            id                       INTEGER NOT NULL,
            title                    TEXT NOT NULL,
            work_item_type           TEXT,
            state                    TEXT,
            assigned_to              TEXT,
            assigned_to_unique_name  TEXT,
            changed_date             TEXT,
            web_url                  TEXT,
            tags                     TEXT,
            PRIMARY KEY (organization, id)
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            organization  TEXT NOT NULL,
            project       TEXT NOT NULL,
            kind          TEXT NOT NULL,
            synced_at     INTEGER NOT NULL,
            synced_by     TEXT NOT NULL,
            last_error    TEXT,
            PRIMARY KEY (organization, project, kind)
        );

        CREATE TABLE IF NOT EXISTS cache_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO cache_meta (key, value) VALUES ('schema_version', '1');",
    )?;
    check_schema_version(&conn)?;
    Ok(conn)
}

/// The table shapes this module reads and writes. Another app that migrates
/// the file to a newer shape bumps `cache_meta.schema_version`; this app then
/// stops touching it (readers fall back to the API, writes are skipped) rather
/// than misreading or clobbering rows it does not understand.
const SCHEMA_VERSION: &str = "1";

fn check_schema_version(conn: &Connection) -> Result<()> {
    let version: String = conn.query_row(
        "SELECT value FROM cache_meta WHERE key = 'schema_version'",
        [],
        |row| row.get(0),
    )?;
    if version != SCHEMA_VERSION {
        return Err(AppError::Database(format!(
            "shared cache schema version {version} is not supported (expected {SCHEMA_VERSION})"
        )));
    }
    Ok(())
}

/// `kind` values used in `sync_state`. Kept as string constants (not stored
/// in an enum) since this schema has no compile-time link to either app.
pub const KIND_PULL_REQUESTS: &str = "pull_requests";
pub const KIND_WORK_ITEMS: &str = "work_items";

/// Whether anyone (this app or the other one) refreshed `(organization,
/// project, kind)` within `max_age`. Missing rows are treated as stale.
pub fn is_fresh(
    conn: &Connection,
    organization: &str,
    project: &str,
    kind: &str,
    max_age: Duration,
) -> bool {
    let synced_at: Option<i64> = conn
        .query_row(
            "SELECT synced_at FROM sync_state WHERE organization = ?1 AND project = ?2 AND kind = ?3",
            params![organization, project, kind],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    // A timestamp in the future (clock moved back, or skew between writers) is
    // not trusted as fresh.
    synced_at.is_some_and(|synced_at| {
        let age = unix_now() - synced_at;
        (0..max_age.as_secs() as i64).contains(&age)
    })
}

pub fn mark_synced(
    conn: &Connection,
    organization: &str,
    project: &str,
    kind: &str,
    synced_by: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (organization, project, kind, synced_at, synced_by, last_error)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         ON CONFLICT(organization, project, kind) DO UPDATE SET
            synced_at = excluded.synced_at,
            synced_by = excluded.synced_by,
            last_error = NULL",
        params![organization, project, kind, unix_now(), synced_by],
    )?;
    Ok(())
}

/// Removes everything cached for `organization`. Called when a connection is
/// deleted so its PR / work item titles stop being readable by other apps.
pub fn delete_organization(conn: &Connection, organization: &str) -> Result<()> {
    for table in [
        "pull_request_reviewers",
        "pull_requests",
        "work_items",
        "sync_state",
    ] {
        conn.execute(
            &format!("DELETE FROM {table} WHERE organization = ?1"),
            params![organization],
        )?;
    }
    Ok(())
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sync_state (
                organization TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL,
                synced_at INTEGER NOT NULL, synced_by TEXT NOT NULL, last_error TEXT,
                PRIMARY KEY (organization, project, kind)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn delete_organization_removes_only_that_organizations_rows() {
        let conn = open().unwrap();
        for org in ["gone", "kept"] {
            conn.execute(
                "INSERT INTO pull_requests (organization, project, repository_id, repository_name,
                    pull_request_id, title, status, creation_date, source_ref_name, target_ref_name)
                 VALUES (?1, 'p', 'r', 'repo', 1, 't', 'active', '2026-01-01', 's', 't')",
                params![org],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO pull_request_reviewers (organization, project, repository_id,
                    pull_request_id, reviewer_id, vote)
                 VALUES (?1, 'p', 'r', 1, 'u', 0)",
                params![org],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO work_items (organization, project, id, title) VALUES (?1, 'p', 1, 't')",
                params![org],
            )
            .unwrap();
            mark_synced(&conn, org, "p", KIND_PULL_REQUESTS, "devdeck").unwrap();
        }

        delete_organization(&conn, "gone").unwrap();

        for table in [
            "pull_requests",
            "pull_request_reviewers",
            "work_items",
            "sync_state",
        ] {
            let orgs: Vec<String> = conn
                .prepare(&format!("SELECT organization FROM {table}"))
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<std::result::Result<_, _>>()
                .unwrap();
            assert_eq!(orgs, vec!["kept".to_string()], "{table}");
        }
    }

    #[test]
    fn path_stays_within_the_os_temp_directory_and_is_stable_per_thread() {
        let first = path().unwrap();
        assert!(first.starts_with(std::env::temp_dir()));
        assert_eq!(first, path().unwrap());
    }

    #[test]
    fn missing_scope_is_never_fresh() {
        let conn = memory_conn();
        assert!(!is_fresh(
            &conn,
            "org",
            "proj",
            KIND_PULL_REQUESTS,
            Duration::from_secs(120)
        ));
    }

    #[test]
    fn freshly_marked_scope_is_fresh_until_max_age_elapses() {
        let conn = memory_conn();
        mark_synced(&conn, "org", "proj", KIND_PULL_REQUESTS, "devdeck").unwrap();
        assert!(is_fresh(
            &conn,
            "org",
            "proj",
            KIND_PULL_REQUESTS,
            Duration::from_secs(120)
        ));
        // A different (organization, project, kind) scope is unaffected.
        assert!(!is_fresh(
            &conn,
            "org",
            "other",
            KIND_PULL_REQUESTS,
            Duration::from_secs(120)
        ));
        assert!(!is_fresh(
            &conn,
            "org",
            "proj",
            KIND_WORK_ITEMS,
            Duration::from_secs(120)
        ));
    }

    #[test]
    fn mark_synced_overwrites_the_previous_entry_for_the_same_scope() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO sync_state (organization, project, kind, synced_at, synced_by, last_error)
             VALUES ('org', 'proj', 'pull_requests', 0, 'waypoint', 'boom')",
            [],
        )
        .unwrap();
        mark_synced(&conn, "org", "proj", KIND_PULL_REQUESTS, "devdeck").unwrap();
        let (synced_by, last_error): (String, Option<String>) = conn
            .query_row(
                "SELECT synced_by, last_error FROM sync_state WHERE organization='org' AND project='proj' AND kind='pull_requests'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(synced_by, "devdeck");
        assert_eq!(last_error, None);
    }

    #[test]
    fn a_future_timestamp_is_not_fresh() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO sync_state (organization, project, kind, synced_at, synced_by)
             VALUES ('org', 'proj', 'pull_requests', ?1, 'waypoint')",
            params![unix_now() + 3600],
        )
        .unwrap();
        assert!(!is_fresh(
            &conn,
            "org",
            "proj",
            KIND_PULL_REQUESTS,
            Duration::from_secs(120)
        ));
    }

    #[test]
    fn an_unknown_schema_version_is_rejected() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO cache_meta VALUES ('schema_version', '1');",
        )
        .unwrap();
        assert!(check_schema_version(&conn).is_ok());
        conn.execute("UPDATE cache_meta SET value = '2'", [])
            .unwrap();
        assert!(check_schema_version(&conn).is_err());
    }
}
