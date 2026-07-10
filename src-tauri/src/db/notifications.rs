use chrono::{Duration, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

use crate::error::Result;

use super::util::push_in_clause;
use super::AppDatabase;

/// Max rows kept in the notification history; older rows beyond this count are
/// pruned after each insert batch.
const MAX_NOTIFICATIONS: i64 = 1000;
/// Rows older than this many days are pruned regardless of the row-count cap.
const MAX_NOTIFICATION_AGE_DAYS: i64 = 30;

#[derive(Debug, Clone)]
pub struct NewNotification {
    /// `None` for notifications not tied to a specific organization (e.g. a
    /// sync failure, which can precede any organization being resolved).
    pub organization_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecord {
    pub id: i64,
    pub created_at: String,
    pub organization_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub payload: Value,
    pub is_read: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPage {
    pub items: Vec<NotificationRecord>,
    pub has_more: bool,
}

impl AppDatabase {
    pub fn insert_notifications(&self, records: &[NewNotification]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        insert_notifications(&conn, records)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn list_notifications(
        &self,
        limit: u32,
        before_id: Option<i64>,
        unread_only: bool,
        kinds: Option<&[String]>,
        organization_id: Option<&str>,
    ) -> Result<NotificationPage> {
        let conn = self.open()?;
        list_notifications(&conn, limit, before_id, unread_only, kinds, organization_id)
    }

    pub fn unread_notifications_count(&self) -> Result<i64> {
        let conn = self.open()?;
        unread_notifications_count(&conn)
    }

    pub fn mark_notifications_read(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        mark_notifications_read(&conn, ids)
    }

    pub fn mark_all_notifications_read(&self) -> Result<()> {
        let conn = self.open()?;
        mark_all_notifications_read(&conn)
    }
}

fn insert_notifications(conn: &Connection, records: &[NewNotification]) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    {
        let mut stmt = conn.prepare_cached(
            "INSERT INTO notifications(created_at, organization_id, kind, title, body, payload, is_read) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        )?;
        for record in records {
            let payload =
                serde_json::to_string(&record.payload).unwrap_or_else(|_| "null".to_string());
            stmt.execute(params![
                now,
                record.organization_id,
                record.kind,
                record.title,
                record.body,
                payload,
            ])?;
        }
    }
    prune_notifications(conn)
}

/// Keeps the notification history bounded: rows older than
/// `MAX_NOTIFICATION_AGE_DAYS` and rows beyond `MAX_NOTIFICATIONS` (keeping the
/// newest) are deleted after every insert batch.
fn prune_notifications(conn: &Connection) -> Result<()> {
    let cutoff = (Utc::now() - Duration::days(MAX_NOTIFICATION_AGE_DAYS)).to_rfc3339();
    conn.execute(
        "DELETE FROM notifications WHERE created_at < ?1",
        params![cutoff],
    )?;
    conn.execute(
        "DELETE FROM notifications WHERE id NOT IN ( \
             SELECT id FROM notifications ORDER BY id DESC LIMIT ?1 \
         )",
        params![MAX_NOTIFICATIONS],
    )?;
    Ok(())
}

fn list_notifications(
    conn: &Connection,
    limit: u32,
    before_id: Option<i64>,
    unread_only: bool,
    kinds: Option<&[String]>,
    organization_id: Option<&str>,
) -> Result<NotificationPage> {
    let limit = i64::from(limit.max(1));
    let mut sql = String::from(
        "SELECT id, created_at, organization_id, kind, title, body, payload, is_read \
         FROM notifications WHERE 1=1",
    );
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if unread_only {
        sql.push_str(" AND is_read = 0");
    }
    if let Some(org_id) = organization_id {
        sql.push_str(&format!(" AND organization_id = ?{}", bind.len() + 1));
        bind.push(Box::new(org_id.to_string()));
    }
    push_in_clause(&mut sql, &mut bind, "kind", kinds);
    if let Some(before_id) = before_id {
        sql.push_str(&format!(" AND id < ?{}", bind.len() + 1));
        bind.push(Box::new(before_id));
    }
    // Fetch one extra row to determine whether more pages remain.
    sql.push_str(&format!(" ORDER BY id DESC LIMIT ?{}", bind.len() + 1));
    bind.push(Box::new(limit + 1));

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|value| value.as_ref()).collect();
    let rows = stmt.query_map(params.as_slice(), map_notification_record)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    let has_more = items.len() as i64 > limit;
    items.truncate(limit as usize);
    Ok(NotificationPage { items, has_more })
}

fn unread_notifications_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM notifications WHERE is_read = 0",
        [],
        |row| row.get(0),
    )?)
}

fn mark_notifications_read(conn: &Connection, ids: &[i64]) -> Result<()> {
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let placeholders: Vec<String> = ids
        .iter()
        .map(|id| {
            bind.push(Box::new(*id));
            format!("?{}", bind.len())
        })
        .collect();
    let sql = format!(
        "UPDATE notifications SET is_read = 1 WHERE id IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|value| value.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;
    Ok(())
}

fn mark_all_notifications_read(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0", [])?;
    Ok(())
}

fn map_notification_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationRecord> {
    let payload_raw: String = row.get(6)?;
    let is_read: i64 = row.get(7)?;
    Ok(NotificationRecord {
        id: row.get(0)?,
        created_at: row.get(1)?,
        organization_id: row.get(2)?,
        kind: row.get(3)?,
        title: row.get(4)?,
        body: row.get(5)?,
        payload: serde_json::from_str(&payload_raw).unwrap_or(Value::Null),
        is_read: is_read != 0,
    })
}
