//! Key-value helpers behind `app_settings`, split from `settings.rs` to keep
//! files under 500 lines.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;

use super::settings::{
    NotificationRule, DEFAULT_REVIEW_STALE_THRESHOLD_DAYS, DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
    REVIEW_STALE_THRESHOLD_DAY_OPTIONS, WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
};

pub(super) fn get_review_stale_threshold_days(conn: &Connection) -> Result<i64> {
    let value = get_setting(conn, "review_stale_threshold_days")?
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|days| REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
        .unwrap_or(DEFAULT_REVIEW_STALE_THRESHOLD_DAYS);
    Ok(value)
}

// Accepts a zero-padded "HH:MM" string with valid hour/minute ranges. Used to
// reject corrupt or legacy values read back from the key-value store.
pub(super) fn is_valid_hh_mm(value: &str) -> bool {
    let Some((h, m)) = value.trim().split_once(':') else {
        return false;
    };
    matches!((h.parse::<u32>(), m.parse::<u32>()), (Ok(hour), Ok(minute)) if hour < 24 && minute < 60)
}

pub(super) fn get_work_item_stale_threshold_days(conn: &Connection) -> Result<i64> {
    let value = get_setting(conn, "work_item_stale_threshold_days")?
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|days| WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
        .unwrap_or(DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS);
    Ok(value)
}

// Stored as a JSON array string. Corrupt or absent JSON falls back to an empty
// rule set, which preserves the legacy per-toggle notification behaviour.
pub(super) fn get_notification_rules(conn: &Connection) -> Result<Vec<NotificationRule>> {
    match get_setting(conn, "notification_rules")? {
        Some(raw) if !raw.trim().is_empty() => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        _ => Ok(Vec::new()),
    }
}

pub(super) fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

pub(super) fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => {
            conn.execute(
                r#"
                INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                "#,
                params![key, v, Utc::now().to_rfc3339()],
            )?;
        }
        None => {
            conn.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
        }
    }
    Ok(())
}

pub(super) fn get_bool_setting(conn: &Connection, key: &str, default_value: bool) -> Result<bool> {
    Ok(get_setting(conn, key)?
        .as_deref()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "yes"
            )
        })
        .unwrap_or(default_value))
}

pub(super) fn set_bool_setting(conn: &Connection, key: &str, value: bool) -> Result<()> {
    set_setting(conn, key, Some(if value { "true" } else { "false" }))
}
