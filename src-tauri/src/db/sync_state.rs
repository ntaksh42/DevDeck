use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

use super::AppDatabase;

#[derive(Debug, Clone)]
pub struct MentionHistoryEntry {
    pub unique_name: String,
    pub display_name: String,
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub scope: String,
    pub org_id: String,
    pub last_synced_at: Option<String>,
    pub error_count: i64,
    pub last_error: Option<String>,
    pub last_warning: Option<String>,
}

impl AppDatabase {
    pub fn get_sync_state(&self, scope: &str) -> Result<Option<SyncState>> {
        let conn = self.open()?;
        Ok(conn
            .query_row(
                "SELECT scope, org_id, last_synced_at, error_count, last_error, last_warning FROM sync_state WHERE scope = ?1",
                [scope],
                map_sync_state,
            )
            .optional()?)
    }

    pub fn list_sync_states(&self) -> Result<Vec<SyncState>> {
        let conn = self.open()?;
        // `internal:` scopes are bookkeeping (e.g. last full work item sync)
        // and are hidden from the settings UI.
        let mut stmt = conn.prepare(
            "SELECT scope, org_id, last_synced_at, error_count, last_error, last_warning FROM sync_state \
             WHERE scope NOT LIKE 'internal:%' \
             ORDER BY org_id, scope",
        )?;
        let rows = stmt.query_map([], map_sync_state)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn update_sync_state(
        &self,
        scope: &str,
        org_id: &str,
        last_synced_at: Option<&str>,
        error_count: i64,
        last_error: Option<&str>,
        last_warning: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            r#"
            INSERT INTO sync_state(scope, org_id, last_synced_at, error_count, last_error, last_warning)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(scope) DO UPDATE SET
                last_synced_at = COALESCE(excluded.last_synced_at, last_synced_at),
                error_count = excluded.error_count,
                last_error = excluded.last_error,
                last_warning = excluded.last_warning
            "#,
            params![
                scope,
                org_id,
                last_synced_at,
                error_count,
                last_error,
                last_warning
            ],
        )?;
        Ok(())
    }

    pub fn list_mention_history(
        &self,
        org_id: &str,
        limit: usize,
    ) -> Result<Vec<MentionHistoryEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT unique_name, display_name, user_id FROM mention_history \
             WHERE org_id = ?1 \
             ORDER BY interaction_count DESC, last_used_at DESC \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![org_id, limit as i64], |row| {
            Ok(MentionHistoryEntry {
                unique_name: row.get(0)?,
                display_name: row.get(1)?,
                user_id: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_mention_interaction(
        &self,
        org_id: &str,
        unique_name: &str,
        display_name: &str,
        user_id: Option<&str>,
        now: &str,
    ) -> Result<()> {
        let unique_name_lower = unique_name.to_lowercase();
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO mention_history(org_id, unique_name, display_name, user_id, interaction_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)
             ON CONFLICT(org_id, unique_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 user_id = COALESCE(excluded.user_id, user_id),
                 interaction_count = interaction_count + 1,
                 last_used_at = excluded.last_used_at",
            params![org_id, unique_name_lower, display_name, user_id, now],
        )?;
        Ok(())
    }

    pub fn list_assignee_history(
        &self,
        org_id: &str,
        limit: usize,
    ) -> Result<Vec<MentionHistoryEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT unique_name, display_name, user_id FROM assignee_history \
             WHERE org_id = ?1 \
             ORDER BY interaction_count DESC, last_used_at DESC \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![org_id, limit as i64], |row| {
            Ok(MentionHistoryEntry {
                unique_name: row.get(0)?,
                display_name: row.get(1)?,
                user_id: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_assignee_interaction(
        &self,
        org_id: &str,
        unique_name: &str,
        display_name: &str,
        user_id: Option<&str>,
        now: &str,
    ) -> Result<()> {
        let unique_name_lower = unique_name.to_lowercase();
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO assignee_history(org_id, unique_name, display_name, user_id, interaction_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)
             ON CONFLICT(org_id, unique_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 user_id = COALESCE(excluded.user_id, user_id),
                 interaction_count = interaction_count + 1,
                 last_used_at = excluded.last_used_at",
            params![org_id, unique_name_lower, display_name, user_id, now],
        )?;
        Ok(())
    }
}

fn map_sync_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncState> {
    Ok(SyncState {
        scope: row.get(0)?,
        org_id: row.get(1)?,
        last_synced_at: row.get(2)?,
        error_count: row.get(3)?,
        last_error: row.get(4)?,
        last_warning: row.get(5)?,
    })
}
