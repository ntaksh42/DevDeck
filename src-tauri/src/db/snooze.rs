use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::Result;

use super::AppDatabase;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnoozedItem {
    pub item_type: String,
    pub item_key: String,
    pub snooze_until: String,
    /// Activity marker captured when the item was snoozed. For pull requests
    /// this is the last-seen comment id (decimal string); for work items it is
    /// the `System.ChangedDate` timestamp. Compared against the live value
    /// during sync to revive items that saw new activity.
    pub baseline_activity: Option<String>,
    pub created_at: String,
}

impl AppDatabase {
    pub fn upsert_snoozed_item(
        &self,
        org_id: &str,
        item_type: &str,
        item_key: &str,
        snooze_until: &str,
        baseline_activity: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        upsert_snoozed_item(
            &conn,
            org_id,
            item_type,
            item_key,
            snooze_until,
            baseline_activity,
        )
    }

    pub fn delete_snoozed_item(&self, org_id: &str, item_type: &str, item_key: &str) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM snoozed_items \
             WHERE organization_id = ?1 AND item_type = ?2 AND item_key = ?3",
            params![org_id, item_type, item_key],
        )?;
        Ok(())
    }

    pub fn list_snoozed_items(&self, org_id: &str, item_type: &str) -> Result<Vec<SnoozedItem>> {
        let conn = self.open()?;
        list_snoozed_items(&conn, org_id, item_type)
    }
}

pub(crate) fn upsert_snoozed_item(
    conn: &Connection,
    org_id: &str,
    item_type: &str,
    item_key: &str,
    snooze_until: &str,
    baseline_activity: Option<&str>,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO snoozed_items(organization_id, item_type, item_key, snooze_until, baseline_activity, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(organization_id, item_type, item_key)
        DO UPDATE SET snooze_until = excluded.snooze_until, baseline_activity = excluded.baseline_activity
        "#,
        params![
            org_id,
            item_type,
            item_key,
            snooze_until,
            baseline_activity,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

pub(crate) fn list_snoozed_items(
    conn: &Connection,
    org_id: &str,
    item_type: &str,
) -> Result<Vec<SnoozedItem>> {
    let mut stmt = conn.prepare(
        "SELECT item_type, item_key, snooze_until, baseline_activity, created_at \
         FROM snoozed_items WHERE organization_id = ?1 AND item_type = ?2 \
         ORDER BY snooze_until ASC",
    )?;
    let rows = stmt.query_map(params![org_id, item_type], |row| {
        Ok(SnoozedItem {
            item_type: row.get(0)?,
            item_key: row.get(1)?,
            snooze_until: row.get(2)?,
            baseline_activity: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}
