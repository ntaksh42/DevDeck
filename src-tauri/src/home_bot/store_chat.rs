//! The Orchestrator chat and the workers it started, in SQLite.

use rusqlite::{params, Connection, OptionalExtension};

use super::store::{get_kv, set_kv};
use super::types::{from_ms, HomeChatMessage, HomeWorker};
use crate::error::Result;

const CURRENT_CHAT_KEY: &str = "home_bot_chat";

/// The chat new messages go to, made on first use.
pub(crate) fn current_chat(conn: &Connection, now: i64) -> Result<String> {
    if let Some(chat) = get_kv(conn, CURRENT_CHAT_KEY)?.filter(|c| !c.is_empty()) {
        return Ok(chat);
    }
    new_chat(conn, now)
}

pub(crate) fn new_chat(conn: &Connection, now: i64) -> Result<String> {
    let chat = format!("chat-{}", from_ms(now).format("%Y%m%d%H%M%S%3f"));
    set_kv(conn, CURRENT_CHAT_KEY, &chat)?;
    Ok(chat)
}

pub(crate) fn add_message(
    conn: &Connection,
    chat_id: &str,
    author: &str,
    body: &str,
    worker_ids: &[String],
    now: i64,
) -> Result<i64> {
    let workers = (!worker_ids.is_empty()).then(|| worker_ids.join(","));
    conn.execute(
        "INSERT INTO home_chat_messages(chat_id, author, body, worker_ids, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![chat_id, author, body, workers, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// The chat's latest `limit` messages, oldest first.
pub(crate) fn messages(
    conn: &Connection,
    chat_id: &str,
    limit: i64,
) -> Result<Vec<HomeChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, author, body, worker_ids, created_at FROM (
            SELECT * FROM home_chat_messages WHERE chat_id = ?1 ORDER BY id DESC LIMIT ?2
         ) ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![chat_id, limit], |row| {
        let workers: Option<String> = row.get(3)?;
        Ok(HomeChatMessage {
            id: row.get(0)?,
            author: row.get(1)?,
            body: row.get(2)?,
            worker_ids: workers
                .map(|w| {
                    w.split(',')
                        .filter(|id| !id.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            created_at: from_ms(row.get(4)?),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ── Workers ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DispatchRow {
    pub id: String,
    pub chat_id: String,
    pub target: String,
    pub target_label: String,
    pub repository: Option<String>,
    pub ask_id: i64,
    pub agent: String,
    pub model: Option<String>,
    pub spec: String,
    pub status: String,
    pub result_state: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    /// `ask`, `pull-request` or `work-item`: whose notes the worker answers in.
    pub note_target: String,
    /// The note the worker answers in, once it is created.
    pub note_id: Option<String>,
}

impl DispatchRow {
    pub(crate) fn view(&self) -> HomeWorker {
        HomeWorker {
            id: self.id.clone(),
            target_label: self.target_label.clone(),
            title: self
                .spec
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(120)
                .collect(),
            agent: self.agent.clone(),
            model: self.model.clone(),
            status: self.status.clone(),
            ask_id: self.ask_id,
            created_at: from_ms(self.created_at),
            started_at: self.started_at.map(from_ms),
            ended_at: self.ended_at.map(from_ms),
            note_target: self.note_target.clone(),
            subject: None,
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        matches!(self.status.as_str(), "queued" | "running")
    }
}

const DISPATCH_COLUMNS: &str = "id, chat_id, target, target_label, repository, ask_id, agent, model, spec, status, result_state, created_at, started_at, ended_at, note_target, note_id";

fn map_dispatch(row: &rusqlite::Row<'_>) -> rusqlite::Result<DispatchRow> {
    Ok(DispatchRow {
        id: row.get(0)?,
        chat_id: row.get(1)?,
        target: row.get(2)?,
        target_label: row.get(3)?,
        repository: row.get(4)?,
        ask_id: row.get(5)?,
        agent: row.get(6)?,
        model: row.get(7)?,
        spec: row.get(8)?,
        status: row.get(9)?,
        result_state: row.get(10)?,
        created_at: row.get(11)?,
        started_at: row.get(12)?,
        ended_at: row.get(13)?,
        note_target: row.get(14)?,
        note_id: row.get(15)?,
    })
}

pub(crate) fn insert_dispatch(conn: &Connection, row: &DispatchRow) -> Result<()> {
    conn.execute(
        &format!("INSERT INTO home_dispatches({DISPATCH_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"),
        params![
            row.id,
            row.chat_id,
            row.target,
            row.target_label,
            row.repository,
            row.ask_id,
            row.agent,
            row.model,
            row.spec,
            row.status,
            row.result_state,
            row.created_at,
            row.started_at,
            row.ended_at,
            row.note_target,
            row.note_id
        ],
    )?;
    Ok(())
}

pub(crate) fn get_dispatch(conn: &Connection, id: &str) -> Result<Option<DispatchRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {DISPATCH_COLUMNS} FROM home_dispatches WHERE id = ?1"),
            [id],
            map_dispatch,
        )
        .optional()?)
}

/// The chat's workers, newest first.
pub(crate) fn dispatches(conn: &Connection, chat_id: &str) -> Result<Vec<DispatchRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DISPATCH_COLUMNS} FROM home_dispatches WHERE chat_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 100"
    ))?;
    let rows = stmt.query_map([chat_id], map_dispatch)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Every worker in a state, oldest first (the queue order).
pub(crate) fn dispatches_with_status(conn: &Connection, status: &str) -> Result<Vec<DispatchRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DISPATCH_COLUMNS} FROM home_dispatches WHERE status = ?1 ORDER BY created_at ASC, rowid ASC"
    ))?;
    let rows = stmt.query_map([status], map_dispatch)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The running or queued worker on the same target in this chat.
pub(crate) fn active_on_target(
    conn: &Connection,
    chat_id: &str,
    target: &str,
) -> Result<Option<DispatchRow>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {DISPATCH_COLUMNS} FROM home_dispatches
                 WHERE chat_id = ?1 AND target = ?2 AND status IN ('queued', 'running', 'needs_you')
                 ORDER BY created_at DESC LIMIT 1"
            ),
            params![chat_id, target],
            map_dispatch,
        )
        .optional()?)
}

pub(crate) fn set_status(conn: &Connection, id: &str, status: &str, now: i64) -> Result<()> {
    let (started, ended, result) = match status {
        "running" => (Some(now), None, None),
        "needs_you" | "done" | "failed" => (None, Some(now), Some("pending")),
        "stopped" => (None, Some(now), None),
        _ => (None, None, None),
    };
    conn.execute(
        "UPDATE home_dispatches SET status = ?2,
            started_at = COALESCE(?3, started_at),
            ended_at = CASE WHEN ?2 IN ('queued', 'running') THEN NULL ELSE COALESCE(?4, ended_at) END,
            result_state = COALESCE(?5, result_state)
         WHERE id = ?1",
        params![id, status, started, ended, result],
    )?;
    Ok(())
}

/// Finished workers whose result the Orchestrator has not summarized yet.
pub(crate) fn pending_results(conn: &Connection, chat_id: &str) -> Result<Vec<DispatchRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DISPATCH_COLUMNS} FROM home_dispatches WHERE chat_id = ?1 AND result_state = 'pending'
         ORDER BY ended_at ASC"
    ))?;
    let rows = stmt.query_map([chat_id], map_dispatch)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn mark_reported(conn: &Connection, ids: &[String]) -> Result<()> {
    for id in ids {
        conn.execute(
            "UPDATE home_dispatches SET result_state = 'reported' WHERE id = ?1",
            [id],
        )?;
    }
    Ok(())
}

/// Workers a previous exit left running cannot be followed any more.
pub(crate) fn fail_orphaned_workers(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE home_dispatches SET status = 'failed', ended_at = ?1, result_state = 'pending'
         WHERE status = 'running'",
        [now],
    )?;
    Ok(())
}
