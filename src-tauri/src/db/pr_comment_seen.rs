//! Last PR comment id seen per pull request, for comment-reply notifications.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;

use super::AppDatabase;

impl AppDatabase {
    pub fn get_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Option<i64>> {
        let conn = self.open()?;
        get_pr_comment_seen(&conn, org_id, repository_id, pull_request_id)
    }

    pub fn set_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        last_seen_comment_id: i64,
    ) -> Result<()> {
        let conn = self.open()?;
        set_pr_comment_seen(
            &conn,
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
        )
    }
}

pub(crate) fn get_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT last_seen_comment_id FROM pr_comment_seen \
             WHERE organization_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id],
            |row| row.get(0),
        )
        .optional()?)
}

pub(crate) fn set_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
    last_seen_comment_id: i64,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO pr_comment_seen(organization_id, repository_id, pull_request_id, last_seen_comment_id, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(organization_id, repository_id, pull_request_id)
        DO UPDATE SET last_seen_comment_id = excluded.last_seen_comment_id, updated_at = excluded.updated_at
        "#,
        params![
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}
