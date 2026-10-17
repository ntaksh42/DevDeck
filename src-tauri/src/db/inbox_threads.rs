//! One Inbox row per conversation: a PR comment thread, or the comments of a
//! work item. A newer comment addressed to the user updates that row (and
//! brings it back if it was done or snoozed) instead of adding another row, so
//! a busy thread shows up once with the number of comments waiting.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;

use super::action_inbox::format_time;
use super::{AppDatabase, NewInboxItem};

/// Kinds raised by a comment. They are kept one row per conversation; other
/// (retired) kinds keep one row per raising event.
pub(super) const COMMENT_KINDS_SQL: &str = "('pr_mention', 'pr_reply', 'wi_mention')";
const COMMENT_KINDS: [&str; 3] = ["pr_mention", "pr_reply", "wi_mention"];

/// Inserts new items or folds them into the row of their conversation.
/// Returns how many rows were added or updated.
pub(super) fn insert_inbox_items(
    conn: &Connection,
    items: &[NewInboxItem],
    now: DateTime<Utc>,
) -> Result<usize> {
    let detected_at = format_time(now);
    // Oldest first, so a later comment of the same scan updates the row.
    let mut ordered: Vec<&NewInboxItem> = items.iter().collect();
    ordered.sort_by_key(|item| item.comment_id);
    let mut changed = 0;
    for item in ordered {
        changed += if COMMENT_KINDS.contains(&item.kind.as_str()) {
            upsert_conversation_item(conn, item, &detected_at)?
        } else {
            insert_row(conn, item, &detected_at)?
        };
    }
    Ok(changed)
}

fn insert_row(conn: &Connection, item: &NewInboxItem, detected_at: &str) -> Result<usize> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR IGNORE INTO action_inbox_items( \
             org_id, kind, subject_id, project_id, project_name, repository_id, \
             repository_name, thread_id, comment_id, title, author, snippet, web_url, \
             state, detected_at, file_path, line) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'open', ?14, ?15, ?16)",
    )?;
    Ok(stmt.execute(params![
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
        item.file_path,
        item.line,
    ])?)
}

fn upsert_conversation_item(
    conn: &Connection,
    item: &NewInboxItem,
    detected_at: &str,
) -> Result<usize> {
    let existing: Option<(i64, i64, String, String)> = conn
        .query_row(
            &format!(
                "SELECT id, comment_id, kind, state FROM action_inbox_items \
                 WHERE org_id = ?1 AND repository_id = ?2 AND subject_id = ?3 \
                   AND thread_id = ?4 AND kind IN {COMMENT_KINDS_SQL}"
            ),
            params![
                item.organization_id,
                item.repository_id,
                item.subject_id,
                item.thread_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((id, comment_id, kind, state)) = existing else {
        return insert_row(conn, item, detected_at);
    };
    if item.comment_id <= comment_id {
        return Ok(0);
    }
    // A mention still waiting stays a mention when a plain reply follows it.
    let kind = if state != "done" && kind == "pr_mention" {
        kind
    } else {
        item.kind.clone()
    };
    conn.execute(
        "UPDATE action_inbox_items SET kind = ?2, comment_id = ?3, title = ?4, author = ?5, \
             snippet = ?6, web_url = COALESCE(?7, web_url), file_path = COALESCE(?8, file_path), \
             line = COALESCE(?9, line), detected_at = ?10, \
             hit_count = CASE WHEN state = 'done' THEN 1 ELSE hit_count + 1 END, \
             state = 'open', snoozed_until = NULL, done_at = NULL \
         WHERE id = ?1",
        params![
            id,
            kind,
            item.comment_id,
            item.title,
            item.author,
            item.snippet,
            item.web_url,
            item.file_path,
            item.line,
            detected_at,
        ],
    )?;
    // The notes were about the earlier comment; the next sync writes new ones.
    conn.execute(
        "DELETE FROM action_inbox_insights WHERE item_id = ?1",
        params![id],
    )?;
    Ok(1)
}

impl AppDatabase {
    /// Finishes PR comment items whose PR is no longer active: it is in neither
    /// the active PR cache nor the review PR cache. Both caches keep the rows
    /// of a project whose last fetch failed or was capped, so an item is only
    /// finished when a complete fetch no longer lists its PR.
    pub fn finish_inbox_items_of_closed_prs(&self, organization_id: &str) -> Result<usize> {
        let conn = self.open()?;
        Ok(conn.execute(
            "UPDATE action_inbox_items SET state = 'done', snoozed_until = NULL, done_at = ?2 \
             WHERE org_id = ?1 AND state != 'done' AND kind IN ('pr_mention', 'pr_reply') \
               AND NOT EXISTS (SELECT 1 FROM pull_requests p WHERE p.org_id = ?1 \
                   AND p.repository_id = action_inbox_items.repository_id \
                   AND p.pull_request_id = action_inbox_items.subject_id \
                   AND p.status = 'active') \
               AND NOT EXISTS (SELECT 1 FROM review_pull_requests r WHERE r.org_id = ?1 \
                   AND r.repository_id = action_inbox_items.repository_id \
                   AND r.pull_request_id = action_inbox_items.subject_id)",
            params![organization_id, format_time(Utc::now())],
        )?)
    }
}

/// Adds `hit_count` and folds the per-comment rows of each conversation into
/// one: the newest comment's row is kept, open if any of the rows still was
/// (else snoozed, else done), counting the rows that were not done.
pub(super) fn migrate_v27(conn: &Connection) -> Result<()> {
    if !super::table_column_exists(conn, "action_inbox_items", "hit_count")? {
        conn.execute_batch(
            "ALTER TABLE action_inbox_items ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 1;",
        )?;
    }
    type Row = (i64, String, String, Option<String>, Option<String>);
    let mut groups: HashMap<(String, String, i64, i64), Vec<Row>> = HashMap::new();
    {
        let mut stmt = conn.prepare(&format!(
            "SELECT org_id, repository_id, subject_id, thread_id, id, kind, state, \
                    snoozed_until, done_at \
             FROM action_inbox_items WHERE kind IN {COMMENT_KINDS_SQL} \
             ORDER BY comment_id DESC, id DESC"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok((
                (row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?),
                (
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ),
            ))
        })?;
        for row in rows {
            let (key, value) = row?;
            groups.entry(key).or_default().push(value);
        }
    }
    for rows in groups.values().filter(|rows| rows.len() > 1) {
        let keeper = rows[0].0;
        let waiting: Vec<&Row> = rows.iter().filter(|row| row.2 != "done").collect();
        let (state, snoozed_until, done_at) = if waiting.iter().any(|row| row.2 == "open") {
            ("open", None, None)
        } else if !waiting.is_empty() {
            (
                "snoozed",
                waiting.iter().filter_map(|row| row.3.clone()).max(),
                None,
            )
        } else {
            (
                "done",
                None,
                rows.iter().filter_map(|row| row.4.clone()).max(),
            )
        };
        let kind = if waiting.iter().any(|row| row.1 == "pr_mention") {
            "pr_mention".to_string()
        } else {
            rows[0].1.clone()
        };
        conn.execute(
            "UPDATE action_inbox_items SET kind = ?2, state = ?3, snoozed_until = ?4, \
                 done_at = ?5, hit_count = ?6 WHERE id = ?1",
            params![
                keeper,
                kind,
                state,
                snoozed_until,
                done_at,
                waiting.len().max(1) as i64
            ],
        )?;
        for row in &rows[1..] {
            conn.execute(
                "DELETE FROM action_inbox_insights WHERE item_id = ?1",
                params![row.0],
            )?;
            conn.execute(
                "DELETE FROM action_inbox_items WHERE id = ?1",
                params![row.0],
            )?;
        }
    }
    conn.execute_batch(&format!(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_action_inbox_conversation \
             ON action_inbox_items(org_id, repository_id, subject_id, thread_id) \
             WHERE kind IN {COMMENT_KINDS_SQL};"
    ))?;
    Ok(())
}
