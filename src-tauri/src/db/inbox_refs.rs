//! Inbox scan bookkeeping: the unfinished items a sync pass re-checks, and the
//! per-subject cursors that remember the newest comment already scanned.

use rusqlite::{params, params_from_iter};

use crate::error::Result;

use super::AppDatabase;

/// A not-yet-finished item as the state-condition pass sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateInboxRef {
    pub id: i64,
    pub kind: String,
    pub project_id: String,
    pub repository_id: String,
    pub subject_id: i64,
    pub comment_id: i64,
}

/// Repository key under which work item scans keep their cursor.
pub const WORK_ITEM_CURSOR_KEY: &str = "work-item";

/// A scan cursor: the newest comment seen and an optional scan marker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxCursor {
    pub last_seen_comment_id: i64,
    pub marker: Option<String>,
}

impl AppDatabase {
    /// Open or snoozed items of the given kinds. State items (review requests,
    /// assignments, ...) are closed by the sync when their condition ends.
    pub fn unfinished_inbox_refs(
        &self,
        organization_id: &str,
        kinds: &[&str],
    ) -> Result<Vec<StateInboxRef>> {
        if kinds.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.open()?;
        let placeholders = (0..kinds.len())
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, kind, repository_id, subject_id, comment_id, project_id FROM action_inbox_items \
             WHERE org_id = ?1 AND state != 'done' AND kind IN ({placeholders})"
        );
        let mut values: Vec<String> = vec![organization_id.to_string()];
        values.extend(kinds.iter().map(|kind| (*kind).to_string()));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values.iter()), |row| {
            Ok(StateInboxRef {
                id: row.get(0)?,
                kind: row.get(1)?,
                project_id: row.get(5)?,
                repository_id: row.get(2)?,
                subject_id: row.get(3)?,
                comment_id: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_inbox_cursor(
        &self,
        organization_id: &str,
        repository_id: &str,
        subject_id: i64,
    ) -> Result<Option<InboxCursor>> {
        let conn = self.open()?;
        let found = conn.query_row(
            "SELECT last_seen_comment_id, marker FROM action_inbox_cursor WHERE org_id = ?1 AND repository_id = ?2 AND subject_id = ?3",
            params![organization_id, repository_id, subject_id],
            |row| {
                Ok(InboxCursor {
                    last_seen_comment_id: row.get(0)?,
                    marker: row.get(1)?,
                })
            },
        );
        match found {
            Ok(cursor) => Ok(Some(cursor)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set_inbox_cursor(
        &self,
        organization_id: &str,
        repository_id: &str,
        subject_id: i64,
        last_seen_comment_id: i64,
        marker: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO action_inbox_cursor(org_id, repository_id, subject_id, last_seen_comment_id, marker) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(org_id, repository_id, subject_id) DO UPDATE SET last_seen_comment_id = MAX(last_seen_comment_id, excluded.last_seen_comment_id), marker = excluded.marker",
            params![organization_id, repository_id, subject_id, last_seen_comment_id, marker],
        )?;
        Ok(())
    }
}
