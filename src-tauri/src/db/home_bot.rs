//! Schema of the Home Bot (Look around runs, suggestions, the Orchestrator
//! chat and the workers it started). The queries live in `crate::home_bot::store`.
//! Times are Unix milliseconds.

use rusqlite::Connection;

use crate::error::Result;

pub(super) fn migrate_v32(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_runs(
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger     TEXT NOT NULL,
            slot_at     INTEGER,
            started_at  INTEGER NOT NULL,
            ended_at    INTEGER,
            outcome     TEXT,
            error       TEXT,
            brief_json  TEXT,
            agent       TEXT NOT NULL,
            model       TEXT
        );
        CREATE TABLE IF NOT EXISTS bot_suggestions(
            id           TEXT PRIMARY KEY,
            run_id       INTEGER NOT NULL,
            dedupe_key   TEXT NOT NULL,
            title        TEXT NOT NULL,
            why          TEXT NOT NULL,
            ask          TEXT NOT NULL,
            target       TEXT,
            target_label TEXT,
            web_url      TEXT,
            status       TEXT NOT NULL,
            created_at   INTEGER NOT NULL,
            resolved_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_bot_suggestions_open ON bot_suggestions(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bot_suggestions_key ON bot_suggestions(dedupe_key, status);
        CREATE TABLE IF NOT EXISTS home_chat_messages(
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id     TEXT NOT NULL,
            author      TEXT NOT NULL,
            body        TEXT NOT NULL,
            worker_ids  TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_home_chat_messages_chat ON home_chat_messages(chat_id, id);
        CREATE TABLE IF NOT EXISTS home_dispatches(
            id            TEXT PRIMARY KEY,
            chat_id       TEXT NOT NULL,
            target        TEXT NOT NULL,
            target_label  TEXT NOT NULL,
            repository    TEXT,
            ask_id        INTEGER NOT NULL,
            agent         TEXT NOT NULL,
            model         TEXT,
            spec          TEXT NOT NULL,
            status        TEXT NOT NULL,
            result_state  TEXT,
            created_at    INTEGER NOT NULL,
            started_at    INTEGER,
            ended_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_home_dispatches_active ON home_dispatches(status, created_at);
        PRAGMA user_version = 32;",
    )?;
    Ok(())
}

/// Workers on a pull request or work item run in that item's own notes
/// (`pr-{id}` / `wi-{id}`) when its result folder is set, so their result
/// HTML lands there; `note_id` is the note the worker answers in.
pub(super) fn migrate_v33(conn: &Connection) -> Result<()> {
    if !super::table_column_exists(conn, "home_dispatches", "note_target")? {
        conn.execute_batch(
            "ALTER TABLE home_dispatches ADD COLUMN note_target TEXT NOT NULL DEFAULT 'ask';",
        )?;
    }
    if !super::table_column_exists(conn, "home_dispatches", "note_id")? {
        conn.execute_batch("ALTER TABLE home_dispatches ADD COLUMN note_id TEXT;")?;
    }
    conn.execute_batch("PRAGMA user_version = 33;")?;
    Ok(())
}
