use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

use super::pull_requests::{read_pull_requests, read_reviewers, replace_rows};
use super::{
    mark_synced, unix_now, SharedPullRequest, SharedReviewer, KIND_PULL_REQUESTS, SYNCED_BY,
};
use crate::error::Result;

/// Describes the project-wide, active-only request represented by the rows.
/// One limited snapshot may be reused for the same limit or, if complete,
/// for a larger limit.
pub(crate) struct ActivePrScope<'a> {
    pub organization: &'a str,
    pub project: &'a str,
    pub base_url: &'a str,
    pub project_id: &'a str,
    pub principal_id: Option<&'a str>,
    pub limit: u32,
}

pub(crate) struct ActivePrSnapshot {
    pub rows: Vec<SharedPullRequest>,
    pub reviewers: Vec<SharedReviewer>,
    pub capped: bool,
}

pub(super) fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS active_pr_snapshot_scope (
            organization TEXT NOT NULL,
            project TEXT NOT NULL,
            base_url TEXT NOT NULL,
            project_id TEXT NOT NULL,
            principal_id TEXT,
            fetch_limit INTEGER NOT NULL,
            capped INTEGER NOT NULL,
            synced_at INTEGER NOT NULL,
            PRIMARY KEY (organization, project)
        );",
    )?;
    // Older writers replace the shared rows without publishing scope metadata.
    // Invalidate the prior description inside their write transaction.
    for table in ["pull_requests", "pull_request_reviewers", "sync_state"] {
        for (action, references) in [
            ("INSERT", &["NEW"][..]),
            ("UPDATE", &["OLD", "NEW"][..]),
            ("DELETE", &["OLD"][..]),
        ] {
            let kind_check = |reference: &str| {
                if table == "sync_state" {
                    format!(" AND {reference}.kind = 'pull_requests'")
                } else {
                    String::new()
                }
            };
            let mut sql = format!(
                "CREATE TRIGGER IF NOT EXISTS active_pr_scope_{table}_{action}
                 AFTER {action} ON {table} BEGIN "
            );
            for reference in references {
                sql.push_str(&format!(
                    "DELETE FROM active_pr_snapshot_scope
                     WHERE organization = {reference}.organization AND project = {reference}.project{}; ", kind_check(reference)
                ));
            }
            sql.push_str("END;");
            conn.execute_batch(&sql)?;
        }
    }
    Ok(())
}

pub(crate) fn write_active_pr_snapshot(
    conn: &mut Connection,
    scope: &ActivePrScope<'_>,
    rows: &[SharedPullRequest],
    reviewers: &[SharedReviewer],
    capped: bool,
) -> Result<()> {
    let tx = conn.transaction()?;
    replace_rows(&tx, scope.organization, scope.project, rows, reviewers)?;
    if capped {
        // Older readers use this marker as proof that the entire project was
        // refreshed. They must fetch their own complete snapshot.
        tx.execute(
            "DELETE FROM sync_state WHERE organization = ?1 AND project = ?2 AND kind = ?3",
            params![scope.organization, scope.project, KIND_PULL_REQUESTS],
        )?;
    } else {
        mark_synced(
            &tx,
            scope.organization,
            scope.project,
            KIND_PULL_REQUESTS,
            SYNCED_BY,
        )?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO active_pr_snapshot_scope
            (organization, project, base_url, project_id, principal_id, fetch_limit, capped, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            scope.organization,
            scope.project,
            scope.base_url,
            scope.project_id,
            scope.principal_id,
            scope.limit,
            capped,
            unix_now(),
        ],
    )?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn read_active_pr_snapshot(
    conn: &mut Connection,
    scope: &ActivePrScope<'_>,
    max_age: Duration,
) -> Result<Option<ActivePrSnapshot>> {
    let tx = conn.transaction()?;
    let now = unix_now();
    let capped: Option<bool> = tx
        .query_row(
            "SELECT capped FROM active_pr_snapshot_scope
         WHERE organization = ?1 AND project = ?2 AND base_url = ?3 AND project_id = ?4
           AND principal_id IS ?5 AND (fetch_limit = ?6 OR (fetch_limit < ?6 AND capped = 0))
           AND synced_at > ?7 AND synced_at <= ?8",
            params![
                scope.organization,
                scope.project,
                scope.base_url,
                scope.project_id,
                scope.principal_id,
                scope.limit,
                now - max_age.as_secs() as i64,
                now,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(capped) = capped else {
        return Ok(None);
    };
    let rows = read_pull_requests(&tx, scope.organization, scope.project)?;
    let reviewers = read_reviewers(&tx, scope.organization, scope.project)?;
    tx.commit()?;
    Ok(Some(ActivePrSnapshot {
        rows,
        reviewers,
        capped,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capped_snapshot_requires_the_same_limit_and_is_never_fresh_for_legacy_readers() {
        let mut conn = super::super::open().unwrap();
        let project = ActivePrScope {
            organization: "org",
            project: "project",
            project_id: "project-id",
            base_url: "https://dev.azure.com/org",
            principal_id: Some("user"),
            limit: 100,
        };
        write_active_pr_snapshot(&mut conn, &project, &[], &[], true).unwrap();
        let age = Duration::from_secs(120);
        let same = read_active_pr_snapshot(&mut conn, &project, age)
            .unwrap()
            .unwrap();
        assert!(same.capped);
        assert!(!super::super::is_fresh(
            &conn,
            "org",
            "project",
            KIND_PULL_REQUESTS,
            age
        ));

        let larger = ActivePrScope {
            limit: 500,
            ..project
        };
        assert!(read_active_pr_snapshot(&mut conn, &larger, age)
            .unwrap()
            .is_none());

        write_active_pr_snapshot(&mut conn, &project, &[], &[], false).unwrap();
        assert!(super::super::is_fresh(
            &conn,
            "org",
            "project",
            KIND_PULL_REQUESTS,
            age
        ));
        let complete = read_active_pr_snapshot(&mut conn, &larger, age)
            .unwrap()
            .unwrap();
        assert!(!complete.capped);

        let other_user = ActivePrScope {
            principal_id: Some("other"),
            ..larger
        };
        assert!(read_active_pr_snapshot(&mut conn, &other_user, age)
            .unwrap()
            .is_none());
    }
}
