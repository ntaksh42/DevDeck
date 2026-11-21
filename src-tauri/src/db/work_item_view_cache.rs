//! Last result of each Work Item view query, so a view opens with the rows it
//! showed last time while the query runs again against Azure DevOps.
//! Rows are keyed by the query signature (project, WIQL, limit, extra fields),
//! not by view id, so editing a view's WIQL never shows another query's rows.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;

use super::AppDatabase;

/// Older results beyond this many rows are dropped on every save.
const MAX_CACHED_VIEW_RESULTS: i64 = 100;

pub(super) fn migrate_v35(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS work_item_view_results(
            org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            signature     TEXT NOT NULL,
            results_json  TEXT NOT NULL,
            fetched_at    TEXT NOT NULL,
            PRIMARY KEY (org_id, signature)
        );
        PRAGMA user_version = 35;",
    )?;
    Ok(())
}

impl AppDatabase {
    pub fn save_work_item_view_result(
        &self,
        org_id: &str,
        signature: &str,
        results_json: &str,
        fetched_at: &str,
    ) -> Result<()> {
        let conn = self.open()?;
        save_work_item_view_result(&conn, org_id, signature, results_json, fetched_at)
    }

    /// `(results_json, fetched_at)` of the last run of this query, if any.
    pub fn get_work_item_view_result(
        &self,
        org_id: &str,
        signature: &str,
    ) -> Result<Option<(String, String)>> {
        let conn = self.open()?;
        get_work_item_view_result(&conn, org_id, signature)
    }
}

fn get_work_item_view_result(
    conn: &Connection,
    org_id: &str,
    signature: &str,
) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT results_json, fetched_at FROM work_item_view_results
             WHERE org_id = ?1 AND signature = ?2",
            params![org_id, signature],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

fn save_work_item_view_result(
    conn: &Connection,
    org_id: &str,
    signature: &str,
    results_json: &str,
    fetched_at: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO work_item_view_results(org_id, signature, results_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(org_id, signature) DO UPDATE SET
            results_json = excluded.results_json,
            fetched_at = excluded.fetched_at",
        params![org_id, signature, results_json, fetched_at],
    )?;
    conn.execute(
        "DELETE FROM work_item_view_results WHERE rowid NOT IN (
            SELECT rowid FROM work_item_view_results ORDER BY fetched_at DESC LIMIT ?1
        )",
        params![MAX_CACHED_VIEW_RESULTS],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::super::test_support::make_org_draft;
    use super::super::{migrate, upsert_organization};
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org")).unwrap();
        conn
    }

    #[test]
    fn saves_overwrites_and_reads_back_a_view_result() {
        let conn = conn();
        assert_eq!(
            get_work_item_view_result(&conn, "org", "sig").unwrap(),
            None
        );
        save_work_item_view_result(&conn, "org", "sig", "[1]", "2026-11-21T00:00:00Z").unwrap();
        save_work_item_view_result(&conn, "org", "sig", "[2]", "2026-11-21T00:01:00Z").unwrap();
        assert_eq!(
            get_work_item_view_result(&conn, "org", "sig").unwrap(),
            Some(("[2]".into(), "2026-11-21T00:01:00Z".into()))
        );
        assert_eq!(
            get_work_item_view_result(&conn, "org", "other").unwrap(),
            None
        );
    }

    #[test]
    fn keeps_only_the_newest_results() {
        let conn = conn();
        for i in 0..(MAX_CACHED_VIEW_RESULTS + 5) {
            let at = format!("2026-11-21T00:00:{i:03}Z");
            save_work_item_view_result(&conn, "org", &format!("sig-{i}"), "[]", &at).unwrap();
        }
        assert_eq!(
            get_work_item_view_result(&conn, "org", "sig-0").unwrap(),
            None
        );
        assert!(get_work_item_view_result(&conn, "org", "sig-104")
            .unwrap()
            .is_some());
    }
}
