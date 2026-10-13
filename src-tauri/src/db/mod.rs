use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::Result;

mod action_inbox;
mod migrate;
mod notifications;
mod organizations;
mod pr_comment_seen;
mod prs;
mod settings;
mod snooze;
mod sync_state;
mod util;
mod work_item_follows;
mod work_items;
mod work_items_query;

#[cfg(test)]
mod test_support;
#[cfg(test)]
#[cfg(test)]
mod tests_action_inbox;
#[cfg(test)]
mod tests_migrations;
#[cfg(test)]
mod tests_misc;
#[cfg(test)]
mod tests_notifications;
#[cfg(test)]
mod tests_prs;
#[cfg(test)]
mod tests_work_item_follows;
#[cfg(test)]
mod tests_work_items;

pub use action_inbox::*;
pub use migrate::migrate;
pub use notifications::*;
pub use organizations::*;
pub use prs::*;
pub use settings::*;
pub use sync_state::*;
pub use work_item_follows::*;
pub use work_items::*;

pub(crate) use work_items_query::*;

pub(crate) const SCHEMA_VERSION: i64 = 25;

// ── AppDatabase ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppDatabase {
    path: PathBuf,
}

impl AppDatabase {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// The folder holding the database file, where other app-private files
    /// live too.
    pub(crate) fn data_dir(&self) -> &Path {
        self.path.parent().unwrap_or(Path::new("."))
    }

    /// Identifies this database file, for process-wide caches that must not
    /// leak between databases (e.g. separate test databases).
    pub(crate) fn cache_key(&self) -> String {
        self.path.display().to_string()
    }

    pub fn initialize(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = self.open()?;
        // WAL is persistent in the file, so setting it once at startup also
        // upgrades a pre-existing rollback-journal DB, where synchronous=NORMAL
        // would weaken crash durability.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
        migrate(&conn)?;
        Ok(())
    }

    pub fn open(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "recursive_triggers", "ON")?;
        // Wait instead of failing with SQLITE_BUSY when a sync write overlaps
        // a UI read; NORMAL is durable enough under WAL and much faster.
        conn.busy_timeout(std::time::Duration::from_secs(3))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(conn)
    }
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn table_column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in columns {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}
