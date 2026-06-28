use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;

use crate::error::Result;

mod commits;
mod commits_query;
mod migrate;
mod organizations;
mod prs;
mod settings;
mod snooze;
mod sync_state;
mod util;
mod work_items;
mod work_items_query;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests_commits;
#[cfg(test)]
mod tests_migrations;
#[cfg(test)]
mod tests_misc;
#[cfg(test)]
mod tests_prs;
#[cfg(test)]
mod tests_work_items;

pub use commits::*;
pub use migrate::migrate;
pub use organizations::*;
pub use prs::*;
pub use settings::*;
pub use sync_state::*;
pub use work_items::*;

pub(crate) use commits_query::*;
pub(crate) use work_items_query::*;

pub(crate) const SCHEMA_VERSION: i64 = 16;

/// Max rows kept in the my_work_items snapshot queries; sync notification
/// diffing must know this cap to avoid treating re-entering rows as new.
pub const MY_WORK_ITEMS_LIMIT: usize = 200;

// ── AppDatabase ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppDatabase {
    path: PathBuf,
}

impl AppDatabase {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn initialize(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = self.open()?;
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
        // Ensure WAL is applied on every open, not just first-run migration, so
        // a pre-existing non-WAL DB is upgraded rather than left on a rollback
        // journal where synchronous=NORMAL weakens crash durability.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
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
