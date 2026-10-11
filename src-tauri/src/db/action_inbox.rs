//! Local state for the Inbox (action items the user has to respond to).
//!
//! Azure DevOps has no API to mark a mention as handled, so the lifecycle
//! (`open` / `snoozed` / `done`) lives only in this SQLite file. Rows are keyed
//! by the comment that raised them, so re-scanning the same thread is a no-op
//! and an item the user already finished never comes back on its own.

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;

use crate::error::{AppError, Result};

use super::AppDatabase;

/// Finished items are kept this long (for the Done count and undo-by-reopen),
/// then pruned on the next insert.
const DONE_RETENTION_DAYS: i64 = 30;
/// Upper bound for one list call; the Inbox is a to-do list, not an archive.
const MAX_LIST_ROWS: u32 = 500;

#[derive(Debug, Clone)]
pub struct NewInboxItem {
    pub organization_id: String,
    pub kind: String,
    pub subject_id: i64,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub thread_id: i64,
    pub comment_id: i64,
    pub title: String,
    pub author: Option<String>,
    pub snippet: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: i64,
    pub organization_id: String,
    pub kind: String,
    pub subject_id: i64,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub thread_id: i64,
    pub comment_id: i64,
    pub title: String,
    pub author: Option<String>,
    pub snippet: Option<String>,
    pub web_url: Option<String>,
    pub state: String,
    pub snoozed_until: Option<String>,
    pub detected_at: String,
    pub done_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxCounts {
    pub open: i64,
    pub snoozed: i64,
    pub done: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboxListState {
    Open,
    Snoozed,
    Done,
}

/// An open item as the resolution pass sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenInboxRef {
    pub id: i64,
    pub thread_id: i64,
    pub comment_id: i64,
}

impl AppDatabase {
    /// Inserts items that are not already present. Returns how many were new.
    pub fn insert_inbox_items(&self, items: &[NewInboxItem]) -> Result<usize> {
        if items.is_empty() {
            return Ok(0);
        }
        let conn = self.open()?;
        insert_inbox_items(&conn, items, Utc::now())
    }

    pub fn list_inbox_items(
        &self,
        organization_id: Option<&str>,
        state: InboxListState,
        limit: u32,
    ) -> Result<Vec<InboxItem>> {
        let conn = self.open()?;
        list_inbox_items(&conn, organization_id, state, limit, Utc::now())
    }

    pub fn inbox_counts(&self, organization_id: Option<&str>) -> Result<InboxCounts> {
        let conn = self.open()?;
        inbox_counts(&conn, organization_id, Utc::now())
    }

    /// Moves items to `open`, `done` or `snoozed`. `snoozed_until` is required
    /// for `snoozed` and must be in the future.
    pub fn set_inbox_item_state(
        &self,
        ids: &[i64],
        state: &str,
        snoozed_until: Option<&str>,
    ) -> Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let conn = self.open()?;
        set_inbox_item_state(&conn, ids, state, snoozed_until, Utc::now())
    }

    /// Items of one PR that still need the user (open, or snoozed past due).
    pub fn open_inbox_refs_for_pr(
        &self,
        organization_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<OpenInboxRef>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, comment_id FROM action_inbox_items \
             WHERE org_id = ?1 AND repository_id = ?2 AND subject_id = ?3 \
               AND kind IN ('pr_mention', 'pr_reply') AND state != 'done'",
        )?;
        let rows = stmt.query_map(
            params![organization_id, repository_id, pull_request_id],
            |row| {
                Ok(OpenInboxRef {
                    id: row.get(0)?,
                    thread_id: row.get(1)?,
                    comment_id: row.get(2)?,
                })
            },
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_inbox_comment_cursor(
        &self,
        organization_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Option<i64>> {
        let conn = self.open()?;
        let value = conn
            .query_row(
                "SELECT last_seen_comment_id FROM action_inbox_cursor \
                 WHERE org_id = ?1 AND repository_id = ?2 AND subject_id = ?3",
                params![organization_id, repository_id, pull_request_id],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(value)
    }

    pub fn set_inbox_comment_cursor(
        &self,
        organization_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        last_seen_comment_id: i64,
    ) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO action_inbox_cursor(org_id, repository_id, subject_id, last_seen_comment_id) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(org_id, repository_id, subject_id) \
             DO UPDATE SET last_seen_comment_id = MAX(last_seen_comment_id, excluded.last_seen_comment_id)",
            params![organization_id, repository_id, pull_request_id, last_seen_comment_id],
        )?;
        Ok(())
    }
}

fn format_time(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn insert_inbox_items(
    conn: &Connection,
    items: &[NewInboxItem],
    now: DateTime<Utc>,
) -> Result<usize> {
    let detected_at = format_time(now);
    let mut inserted = 0;
    {
        let mut stmt = conn.prepare_cached(
            "INSERT OR IGNORE INTO action_inbox_items( \
                 org_id, kind, subject_id, project_id, project_name, repository_id, \
                 repository_name, thread_id, comment_id, title, author, snippet, web_url, \
                 state, detected_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'open', ?14)",
        )?;
        for item in items {
            inserted += stmt.execute(params![
                item.organization_id,
                item.kind,
                item.subject_id,
                item.project_id,
                item.project_name,
                item.repository_id,
                item.repository_name,
                item.thread_id,
                item.comment_id,
                item.title,
                item.author,
                item.snippet,
                item.web_url,
                detected_at,
            ])?;
        }
    }
    let cutoff = format_time(now - Duration::days(DONE_RETENTION_DAYS));
    conn.execute(
        "DELETE FROM action_inbox_items WHERE state = 'done' AND done_at < ?1",
        params![cutoff],
    )?;
    Ok(inserted)
}

fn list_inbox_items(
    conn: &Connection,
    organization_id: Option<&str>,
    state: InboxListState,
    limit: u32,
    now: DateTime<Utc>,
) -> Result<Vec<InboxItem>> {
    // A snoozed item whose deadline passed counts as open again; no background
    // job is needed to wake it.
    let state_clause = match state {
        InboxListState::Open => "(state = 'open' OR (state = 'snoozed' AND snoozed_until <= ?1))",
        InboxListState::Snoozed => "(state = 'snoozed' AND snoozed_until > ?1)",
        InboxListState::Done => "(state = 'done' AND ?1 IS NOT NULL)",
    };
    let mut sql = format!(
        "SELECT id, org_id, kind, subject_id, project_id, project_name, repository_id, \
                repository_name, thread_id, comment_id, title, author, snippet, web_url, \
                state, snoozed_until, detected_at, done_at \
         FROM action_inbox_items WHERE {state_clause}"
    );
    let mut bind: Vec<String> = vec![format_time(now)];
    if let Some(org_id) = organization_id {
        bind.push(org_id.to_string());
        sql.push_str(&format!(" AND org_id = ?{}", bind.len()));
    }
    let order = match state {
        InboxListState::Done => "done_at DESC, id DESC",
        InboxListState::Snoozed => "snoozed_until ASC, id ASC",
        InboxListState::Open => "detected_at DESC, id DESC",
    };
    let limit = limit.clamp(1, MAX_LIST_ROWS);
    sql.push_str(&format!(" ORDER BY {order} LIMIT {limit}"));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(bind.iter()), map_inbox_item)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn inbox_counts(
    conn: &Connection,
    organization_id: Option<&str>,
    now: DateTime<Utc>,
) -> Result<InboxCounts> {
    let now = format_time(now);
    let mut bind: Vec<String> = vec![now];
    let mut org_clause = String::new();
    if let Some(org_id) = organization_id {
        bind.push(org_id.to_string());
        org_clause = " AND org_id = ?2".to_string();
    }
    let sql = format!(
        "SELECT \
            COALESCE(SUM(CASE WHEN state = 'open' OR (state = 'snoozed' AND snoozed_until <= ?1) THEN 1 ELSE 0 END), 0), \
            COALESCE(SUM(CASE WHEN state = 'snoozed' AND snoozed_until > ?1 THEN 1 ELSE 0 END), 0), \
            COALESCE(SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END), 0) \
         FROM action_inbox_items WHERE 1 = 1{org_clause}"
    );
    Ok(conn.query_row(&sql, params_from_iter(bind.iter()), |row| {
        Ok(InboxCounts {
            open: row.get(0)?,
            snoozed: row.get(1)?,
            done: row.get(2)?,
        })
    })?)
}

fn set_inbox_item_state(
    conn: &Connection,
    ids: &[i64],
    state: &str,
    snoozed_until: Option<&str>,
    now: DateTime<Utc>,
) -> Result<usize> {
    let (snooze_value, done_value): (Option<String>, Option<String>) = match state {
        "open" => (None, None),
        "done" => (None, Some(format_time(now))),
        "snoozed" => {
            let raw = snoozed_until.ok_or_else(|| {
                AppError::InvalidInput("snoozedUntil is required to snooze an item".to_string())
            })?;
            let until = DateTime::parse_from_rfc3339(raw)
                .map_err(|_| AppError::InvalidInput(format!("invalid snoozedUntil: {raw}")))?
                .with_timezone(&Utc);
            if until <= now {
                return Err(AppError::InvalidInput(
                    "snoozedUntil must be in the future".to_string(),
                ));
            }
            (Some(format_time(until)), None)
        }
        other => {
            return Err(AppError::InvalidInput(format!(
                "unknown inbox state: {other}"
            )))
        }
    };
    let placeholders = (0..ids.len())
        .map(|i| format!("?{}", i + 4))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "UPDATE action_inbox_items SET state = ?1, snoozed_until = ?2, done_at = ?3 \
         WHERE id IN ({placeholders})"
    );
    let mut values: Vec<rusqlite::types::Value> = vec![
        state.to_string().into(),
        snooze_value.into(),
        done_value.into(),
    ];
    values.extend(ids.iter().map(|id| rusqlite::types::Value::from(*id)));
    Ok(conn.execute(&sql, params_from_iter(values))?)
}

fn map_inbox_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: row.get(0)?,
        organization_id: row.get(1)?,
        kind: row.get(2)?,
        subject_id: row.get(3)?,
        project_id: row.get(4)?,
        project_name: row.get(5)?,
        repository_id: row.get(6)?,
        repository_name: row.get(7)?,
        thread_id: row.get(8)?,
        comment_id: row.get(9)?,
        title: row.get(10)?,
        author: row.get(11)?,
        snippet: row.get(12)?,
        web_url: row.get(13)?,
        state: row.get(14)?,
        snoozed_until: row.get(15)?,
        detected_at: row.get(16)?,
        done_at: row.get(17)?,
    })
}

/// A not-yet-finished item as the state-condition pass sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateInboxRef {
    pub id: i64,
    pub kind: String,
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
            "SELECT id, kind, repository_id, subject_id, comment_id FROM action_inbox_items \
             WHERE org_id = ?1 AND state != 'done' AND kind IN ({placeholders})"
        );
        let mut values: Vec<String> = vec![organization_id.to_string()];
        values.extend(kinds.iter().map(|kind| (*kind).to_string()));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(values.iter()), |row| {
            Ok(StateInboxRef {
                id: row.get(0)?,
                kind: row.get(1)?,
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

    /// Finishes every item of one kind for one subject (e.g. the "review
    /// requested" row of a PR that came back as "returned").
    pub fn finish_inbox_subject(
        &self,
        organization_id: &str,
        kind: &str,
        repository_id: &str,
        subject_id: i64,
    ) -> Result<usize> {
        let conn = self.open()?;
        let now = format_time(Utc::now());
        Ok(conn.execute(
            "UPDATE action_inbox_items SET state = 'done', snoozed_until = NULL, done_at = ?1 \
             WHERE org_id = ?2 AND kind = ?3 AND repository_id = ?4 AND subject_id = ?5 \
               AND state != 'done'",
            params![now, organization_id, kind, repository_id, subject_id],
        )?)
    }
}
