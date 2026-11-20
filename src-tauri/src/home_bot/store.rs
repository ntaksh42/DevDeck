//! Look around runs, suggestions and the Home settings in SQLite.

use rusqlite::{params, Connection, OptionalExtension};

use super::types::{from_ms, HomeBotSettings, HomeSuggestion, HomeSuggestionAsk};
use crate::error::Result;

const SETTINGS_KEY: &str = "home_bot";

static ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A process-unique id such as `s-1790000000000-3`.
pub(crate) fn next_id(prefix: &str, now: i64) -> String {
    let n = ID_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{prefix}-{now}-{n}")
}
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// An open suggestion no look repeated is dropped after this long.
pub(crate) const OPEN_FOR_MS: i64 = 3 * DAY_MS;
/// Started suggestions are shown to the next looks this long, as what the user acts on.
pub(crate) const STARTED_RECALL_MS: i64 = 14 * DAY_MS;
/// A dismissed suggestion is never made again for this long.
pub(crate) const DISMISSED_FOR_MS: i64 = 30 * DAY_MS;

pub(crate) fn get_kv(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

pub(crate) fn set_kv(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn get_kv_ms(conn: &Connection, key: &str) -> Result<Option<i64>> {
    Ok(get_kv(conn, key)?.and_then(|v| v.parse().ok()))
}

pub(crate) fn load_settings(conn: &Connection) -> Result<HomeBotSettings> {
    Ok(get_kv(conn, SETTINGS_KEY)?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

pub(crate) fn save_settings(conn: &Connection, settings: &HomeBotSettings) -> Result<()> {
    set_kv(
        conn,
        SETTINGS_KEY,
        &serde_json::to_string(settings).unwrap_or_default(),
    )
}

// ── Runs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunRow {
    pub id: i64,
    pub slot_at: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: Option<String>,
    pub error: Option<String>,
    pub brief: Vec<String>,
}

pub(crate) fn begin_run(
    conn: &Connection,
    trigger: &str,
    slot_at: Option<i64>,
    agent: &str,
    model: Option<&str>,
    now: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO bot_runs(trigger, slot_at, started_at, agent, model) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![trigger, slot_at, now, agent, model],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn end_run(
    conn: &Connection,
    id: i64,
    outcome: &str,
    error: Option<&str>,
    brief: &[String],
    now: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE bot_runs SET ended_at = ?2, outcome = ?3, error = ?4, brief_json = ?5 WHERE id = ?1",
        params![id, now, outcome, error, serde_json::to_string(brief).unwrap_or_default()],
    )?;
    Ok(())
}

/// Runs a previous exit cut short are recorded as failed.
pub(crate) fn close_unfinished_runs(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE bot_runs SET ended_at = ?1, outcome = 'failed', error = 'DevDeck closed during the look'
         WHERE ended_at IS NULL",
        [now],
    )?;
    Ok(())
}

/// The newest runs first.
pub(crate) fn recent_runs(conn: &Connection, limit: i64) -> Result<Vec<RunRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, slot_at, started_at, ended_at, outcome, error, brief_json
         FROM bot_runs ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        let brief: Option<String> = row.get(6)?;
        Ok(RunRow {
            id: row.get(0)?,
            slot_at: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
            outcome: row.get(4)?,
            error: row.get(5)?,
            brief: brief
                .and_then(|b| serde_json::from_str(&b).ok())
                .unwrap_or_default(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Failed looks since the last success; a usage limit or a sleep counts as neither.
pub(crate) fn failures_in_a_row(runs: &[RunRow]) -> i64 {
    runs.iter()
        .filter(|run| run.ended_at.is_some())
        .take_while(|run| run.outcome.as_deref() != Some("ok"))
        .filter(|run| run.outcome.as_deref() == Some("failed"))
        .count() as i64
}

// ── Suggestions ──────────────────────────────────────────────────────────────

pub(crate) struct NewSuggestion {
    pub title: String,
    pub why: String,
    pub ask: String,
    pub target: Option<String>,
    pub target_label: Option<String>,
    pub web_url: Option<String>,
}

/// What makes two suggestions the same: their target, else their title
/// (ignoring case and spacing).
pub(crate) fn dedupe_key(title: &str, target: Option<&str>) -> String {
    match target {
        Some(target) => format!("target:{target}"),
        None => format!(
            "title:{}",
            title
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        ),
    }
}

pub(crate) enum SuggestOutcome {
    Added,
    Updated,
    Dismissed,
}

/// Adds a suggestion from run `run_id`, or refreshes the open one it repeats.
/// One dismissed in the last 30 days is not made again.
pub(crate) fn suggest(
    conn: &Connection,
    run_id: i64,
    input: &NewSuggestion,
    now: i64,
) -> Result<SuggestOutcome> {
    let key = dedupe_key(&input.title, input.target.as_deref());
    let dismissed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM bot_suggestions WHERE dedupe_key = ?1 AND status = 'dismissed' AND resolved_at > ?2)",
        params![key, now - DISMISSED_FOR_MS],
        |row| row.get(0),
    )?;
    if dismissed {
        return Ok(SuggestOutcome::Dismissed);
    }
    let updated = conn.execute(
        "UPDATE bot_suggestions SET run_id = ?2, title = ?3, why = ?4, ask = ?5, target_label = ?6, web_url = ?7
         WHERE dedupe_key = ?1 AND status = 'open'",
        params![key, run_id, input.title, input.why, input.ask, input.target_label, input.web_url],
    )?;
    if updated > 0 {
        return Ok(SuggestOutcome::Updated);
    }
    conn.execute(
        "INSERT INTO bot_suggestions(id, run_id, dedupe_key, title, why, ask, target, target_label, web_url, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10)",
        params![
            next_id("s", now),
            run_id,
            key,
            input.title,
            input.why,
            input.ask,
            input.target,
            input.target_label,
            input.web_url,
            now
        ],
    )?;
    Ok(SuggestOutcome::Added)
}

/// After a successful look: open suggestions it did not repeat are replaced,
/// and rows past their keep time are deleted.
pub(crate) fn settle_after_look(conn: &Connection, run_id: i64, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE bot_suggestions SET status = 'replaced', resolved_at = ?2 WHERE status = 'open' AND run_id <> ?1",
        params![run_id, now],
    )?;
    expire(conn, now)
}

pub(crate) fn expire(conn: &Connection, now: i64) -> Result<()> {
    conn.execute(
        "UPDATE bot_suggestions SET status = 'replaced', resolved_at = ?1 WHERE status = 'open' AND created_at < ?2",
        params![now, now - OPEN_FOR_MS],
    )?;
    conn.execute(
        "DELETE FROM bot_suggestions WHERE status <> 'open' AND resolved_at < ?1",
        [now - DISMISSED_FOR_MS],
    )?;
    Ok(())
}

pub(crate) fn open_suggestions(conn: &Connection, seen_at: i64) -> Result<Vec<HomeSuggestion>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, why, ask, target, target_label, web_url, created_at
         FROM bot_suggestions WHERE status = 'open' ORDER BY created_at ASC, rowid ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let target: Option<String> = row.get(4)?;
        let created_at: i64 = row.get(7)?;
        let kind = match target
            .as_deref()
            .and_then(|t| t.split_once(':'))
            .map(|(k, _)| k)
        {
            Some("pr") => "pr",
            Some("wi") => "wi",
            _ => "other",
        };
        Ok(HomeSuggestion {
            id: row.get(0)?,
            title: row.get(1)?,
            why: row.get(2)?,
            ask: row.get(3)?,
            target,
            target_label: row.get(5)?,
            web_url: row.get(6)?,
            kind: kind.into(),
            is_new: created_at > seen_at,
            created_at: from_ms(created_at),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Moves an open suggestion to `started` or `dismissed`; false when it is no longer open.
pub(crate) fn resolve(conn: &Connection, id: &str, status: &str, now: i64) -> Result<bool> {
    Ok(conn.execute(
        "UPDATE bot_suggestions SET status = ?2, resolved_at = ?3 WHERE id = ?1 AND status = 'open'",
        params![id, status, now],
    )? > 0)
}

pub(crate) fn get_ask(conn: &Connection, id: &str) -> Result<Option<HomeSuggestionAsk>> {
    Ok(conn
        .query_row(
            "SELECT ask, target, target_label FROM bot_suggestions WHERE id = ?1 AND status = 'open'",
            [id],
            |row| {
                Ok(HomeSuggestionAsk {
                    ask: row.get(0)?,
                    target: row.get(1)?,
                    target_label: row.get(2)?,
                })
            },
        )
        .optional()?)
}

/// Titles for the look's prompt: still listed, recently started, dismissed.
pub(crate) fn history_titles(
    conn: &Connection,
    now: i64,
) -> Result<(Vec<String>, Vec<String>, Vec<String>)> {
    let titles = |status: &str, within: i64| -> Result<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT title FROM bot_suggestions WHERE status = ?1 AND COALESCE(resolved_at, created_at) > ?2
             ORDER BY created_at DESC LIMIT 20",
        )?;
        let rows = stmt.query_map(params![status, now - within], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
    };
    Ok((
        titles("open", OPEN_FOR_MS)?,
        titles("started", STARTED_RECALL_MS)?,
        titles("dismissed", DISMISSED_FOR_MS)?,
    ))
}

pub(crate) fn clear_dismissed(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM bot_suggestions WHERE status = 'dismissed'", [])?)
}

pub(crate) fn dismissed_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM bot_suggestions WHERE status = 'dismissed'",
        [],
        |r| r.get(0),
    )?)
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
