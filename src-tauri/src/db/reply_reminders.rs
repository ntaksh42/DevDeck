//! "Remind me if no one replies": a local reminder on a conversation the user
//! wrote in. Nothing is posted to Azure DevOps.
//!
//! No extra requests are needed to know whether someone replied: the sync
//! already files every new comment addressed to the user as an Inbox row of
//! the same conversation, so a comment row detected after the reminder was set
//! clears it. When the deadline passes first, the reminder becomes an Inbox row
//! of kind `pr_waiting` / `wi_waiting` (shown as "Waiting") and is not raised
//! again.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

use super::action_inbox::format_time;
use super::inbox_threads::COMMENT_KINDS_SQL;
use super::AppDatabase;

/// Inbox kinds of an overdue reminder. They keep the `pr_` / `wi_` prefix the
/// Inbox uses to tell pull requests from work items.
const WAITING_KINDS_SQL: &str = "('pr_waiting', 'wi_waiting')";

fn waiting_kind(reminder_kind: &str) -> String {
    format!("{reminder_kind}_waiting")
}

pub(super) fn migrate_v31(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reply_reminders(
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL,
            subject_id      INTEGER NOT NULL,
            project_id      TEXT NOT NULL,
            project_name    TEXT NOT NULL,
            repository_id   TEXT NOT NULL DEFAULT '',
            repository_name TEXT NOT NULL DEFAULT '',
            thread_id       INTEGER NOT NULL DEFAULT 0,
            title           TEXT NOT NULL,
            web_url         TEXT,
            created_at      TEXT NOT NULL,
            due_at          TEXT NOT NULL,
            state           TEXT NOT NULL DEFAULT 'waiting',
            UNIQUE (org_id, kind, repository_id, subject_id, thread_id)
        );
        PRAGMA user_version = 31;",
    )?;
    Ok(())
}

/// The conversation to watch: a PR thread (`kind` = `pr`) or a work item
/// (`kind` = `wi`, with an empty repository and thread 0).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyReminderInput {
    pub organization_id: String,
    pub kind: String,
    pub subject_id: i64,
    pub project_id: String,
    pub project_name: String,
    #[serde(default)]
    pub repository_id: String,
    #[serde(default)]
    pub repository_name: String,
    #[serde(default)]
    pub thread_id: i64,
    pub title: String,
    #[serde(default)]
    pub web_url: Option<String>,
    /// RFC 3339; must be in the future.
    pub due_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplyReminder {
    pub id: i64,
    pub organization_id: String,
    pub kind: String,
    pub subject_id: i64,
    pub repository_id: String,
    pub thread_id: i64,
    pub due_at: String,
    pub created_at: String,
}

/// A reminder whose deadline passed without a reply.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FiredReplyReminder {
    pub kind: String,
    pub subject_id: i64,
    pub title: String,
    pub project_name: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReminderOutcome {
    pub cleared: usize,
    pub fired: Vec<FiredReplyReminder>,
}

/// SQL: `a` and `b` (table aliases) are rows of the same conversation.
fn same_conversation(a: &str, b: &str) -> String {
    format!(
        "{a}.org_id = {b}.org_id AND {a}.repository_id = {b}.repository_id \
         AND {a}.subject_id = {b}.subject_id AND {a}.thread_id = {b}.thread_id"
    )
}

fn set_reminder(
    conn: &Connection,
    input: &ReplyReminderInput,
    now: DateTime<Utc>,
) -> Result<ReplyReminder> {
    if input.kind != "pr" && input.kind != "wi" {
        return Err(AppError::InvalidInput(format!(
            "unknown reminder kind: {}",
            input.kind
        )));
    }
    let due = DateTime::parse_from_rfc3339(&input.due_at)
        .map_err(|_| AppError::InvalidInput(format!("invalid dueAt: {}", input.due_at)))?
        .with_timezone(&Utc);
    if due <= now {
        return Err(AppError::InvalidInput(
            "dueAt must be in the future".to_string(),
        ));
    }
    let (created_at, due_at) = (format_time(now), format_time(due));
    conn.execute(
        "INSERT INTO reply_reminders( \
             org_id, kind, subject_id, project_id, project_name, repository_id, \
             repository_name, thread_id, title, web_url, created_at, due_at, state) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'waiting') \
         ON CONFLICT(org_id, kind, repository_id, subject_id, thread_id) DO UPDATE SET \
             title = excluded.title, web_url = excluded.web_url, \
             created_at = excluded.created_at, due_at = excluded.due_at, state = 'waiting'",
        params![
            input.organization_id,
            input.kind,
            input.subject_id,
            input.project_id,
            input.project_name,
            input.repository_id,
            input.repository_name,
            input.thread_id,
            input.title,
            input.web_url,
            created_at,
            due_at,
        ],
    )?;
    let id = conn.query_row(
        "SELECT id FROM reply_reminders \
         WHERE org_id = ?1 AND kind = ?2 AND repository_id = ?3 AND subject_id = ?4 \
           AND thread_id = ?5",
        params![
            input.organization_id,
            input.kind,
            input.repository_id,
            input.subject_id,
            input.thread_id
        ],
        |row| row.get(0),
    )?;
    Ok(ReplyReminder {
        id,
        organization_id: input.organization_id.clone(),
        kind: input.kind.clone(),
        subject_id: input.subject_id,
        repository_id: input.repository_id.clone(),
        thread_id: input.thread_id,
        due_at,
        created_at,
    })
}

/// An overdue reminder with what its Inbox row needs.
struct DueReminder {
    id: i64,
    project_id: String,
    repository_id: String,
    repository_name: String,
    thread_id: i64,
    fired: FiredReplyReminder,
}

pub(super) fn reconcile(
    conn: &Connection,
    org_id: &str,
    now: DateTime<Utc>,
) -> Result<ReminderOutcome> {
    let now_text = format_time(now);
    let tx = conn.unchecked_transaction()?;
    // A comment row detected after the reminder was set means someone replied.
    let answered = format!(
        "org_id = ?1 AND state = 'waiting' AND EXISTS ( \
             SELECT 1 FROM action_inbox_items i WHERE {} \
               AND i.kind IN {COMMENT_KINDS_SQL} AND i.detected_at > reply_reminders.created_at)",
        same_conversation("i", "reply_reminders")
    );
    // A "Waiting" row is answered by a comment row that came after it.
    tx.execute(
        &format!(
            "UPDATE action_inbox_items SET state = 'done', snoozed_until = NULL, done_at = ?2 \
             WHERE org_id = ?1 AND kind IN {WAITING_KINDS_SQL} AND state != 'done' \
               AND EXISTS (SELECT 1 FROM action_inbox_items i WHERE {} \
                 AND i.kind IN {COMMENT_KINDS_SQL} \
                 AND i.detected_at > action_inbox_items.detected_at)",
            same_conversation("i", "action_inbox_items")
        ),
        params![org_id, now_text],
    )?;
    let cleared = tx.execute(
        &format!("UPDATE reply_reminders SET state = 'cleared' WHERE {answered}"),
        params![org_id],
    )?;
    let due: Vec<DueReminder> = {
        let mut stmt = tx.prepare(
            "SELECT id, kind, subject_id, title, project_name, web_url, project_id, \
                    repository_id, repository_name, thread_id \
             FROM reply_reminders WHERE org_id = ?1 AND state = 'waiting' AND due_at <= ?2 \
             ORDER BY due_at",
        )?;
        let rows = stmt.query_map(params![org_id, now_text], |row| {
            Ok(DueReminder {
                id: row.get(0)?,
                fired: FiredReplyReminder {
                    kind: row.get(1)?,
                    subject_id: row.get(2)?,
                    title: row.get(3)?,
                    project_name: row.get(4)?,
                    web_url: row.get(5)?,
                },
                project_id: row.get(6)?,
                repository_id: row.get(7)?,
                repository_name: row.get(8)?,
                thread_id: row.get(9)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut fired = Vec::new();
    for reminder in due {
        tx.execute(
            "INSERT OR IGNORE INTO action_inbox_items( \
                 org_id, kind, subject_id, project_id, project_name, repository_id, \
                 repository_name, thread_id, comment_id, title, author, snippet, web_url, \
                 state, detected_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, 'open', ?13)",
            params![
                org_id,
                waiting_kind(&reminder.fired.kind),
                reminder.fired.subject_id,
                reminder.project_id,
                reminder.fired.project_name,
                reminder.repository_id,
                reminder.repository_name,
                reminder.thread_id,
                reminder.id,
                reminder.fired.title,
                "No reply yet. You asked to be reminded.",
                reminder.fired.web_url,
                now_text,
            ],
        )?;
        tx.execute(
            "UPDATE reply_reminders SET state = 'fired' WHERE id = ?1",
            params![reminder.id],
        )?;
        fired.push(reminder.fired);
    }
    tx.commit()?;
    Ok(ReminderOutcome { cleared, fired })
}

impl AppDatabase {
    pub fn set_reply_reminder(&self, input: &ReplyReminderInput) -> Result<ReplyReminder> {
        set_reminder(&self.open()?, input, Utc::now())
    }

    /// Reminders still waiting for a reply.
    pub fn list_reply_reminders(&self) -> Result<Vec<ReplyReminder>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, org_id, kind, subject_id, repository_id, thread_id, due_at, created_at \
             FROM reply_reminders WHERE state = 'waiting' ORDER BY due_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ReplyReminder {
                id: row.get(0)?,
                organization_id: row.get(1)?,
                kind: row.get(2)?,
                subject_id: row.get(3)?,
                repository_id: row.get(4)?,
                thread_id: row.get(5)?,
                due_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn clear_reply_reminder(&self, id: i64) -> Result<usize> {
        Ok(self
            .open()?
            .execute("DELETE FROM reply_reminders WHERE id = ?1", params![id])?)
    }

    /// Clears reminders that were answered and raises the ones now overdue.
    /// Run after the sync stored the new comments.
    pub fn reconcile_reply_reminders(&self, org_id: &str) -> Result<ReminderOutcome> {
        reconcile(&self.open()?, org_id, Utc::now())
    }
}
