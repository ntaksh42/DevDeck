use rusqlite::Connection;

use crate::error::{AppError, Result};

use super::SCHEMA_VERSION;

mod versions_1_6;
mod versions_7_19;

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "recursive_triggers", "ON")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(AppError::Database(format!(
            "database schema version {current} is newer than supported version {SCHEMA_VERSION}"
        )));
    }

    versions_1_6::migrate(conn, current)?;
    versions_7_19::migrate(conn, current)?;
    Ok(())
}
