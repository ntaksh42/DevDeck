use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::Result;

use super::AppDatabase;

/// A single notification-routing rule. An empty list in a field means "any":
/// e.g. empty `types` matches every notification kind. A notification is
/// delivered when there are no rules at all, or when it matches at least one
/// rule. `repositories` only applies to pull-request notifications; a rule with
/// a non-empty `repositories` never matches a work-item notification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRule {
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(default)]
    pub repositories: Vec<String>,
    /// When true this rule mutes (suppresses) matching notifications instead of
    /// allowing them. Mute rules take precedence over allow rules, so a noisy
    /// repository/project can be silenced without having to allow-list every
    /// other scope.
    #[serde(default)]
    pub mute: bool,
}

impl NotificationRule {
    /// A rule with no conditions at all would match every notification; treat it
    /// as a blank row so it can be dropped rather than silently disabling all
    /// other rules (or, for a mute rule, silencing everything).
    pub fn is_empty(&self) -> bool {
        self.types.is_empty() && self.projects.is_empty() && self.repositories.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub review_result_folder_path: Option<String>,
    pub show_window_hotkey: Option<String>,
    pub read_only_validation_mode_enabled: bool,
    pub desktop_notifications_enabled: bool,
    pub notification_content_preview_enabled: bool,
    pub notify_work_item_assignments: bool,
    pub notify_work_item_state_changes: bool,
    pub notify_pr_review_requests: bool,
    pub notify_pr_vote_resets: bool,
    pub notify_pr_comment_replies: bool,
    /// When enabled, desktop notifications are suppressed during the local-time
    /// window [quiet_hours_start, quiet_hours_end). The in-app cache still
    /// refreshes, so badges and views stay current.
    pub quiet_hours_enabled: bool,
    /// Local wall-clock window bounds as "HH:MM". A window whose start is later
    /// than its end (e.g. 22:00-08:00) wraps across midnight.
    pub quiet_hours_start: String,
    pub quiet_hours_end: String,
    pub review_stale_threshold_days: i64,
    pub work_item_stale_threshold_days: i64,
    pub notification_rules: Vec<NotificationRule>,
}

pub const DEFAULT_REVIEW_STALE_THRESHOLD_DAYS: i64 = 3;
pub const REVIEW_STALE_THRESHOLD_DAY_OPTIONS: [i64; 4] = [2, 3, 5, 7];
pub const DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS: i64 = 7;
pub const WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS: [i64; 3] = [7, 14, 30];
pub const DEFAULT_QUIET_HOURS_START: &str = "22:00";
pub const DEFAULT_QUIET_HOURS_END: &str = "08:00";

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            review_result_folder_path: None,
            show_window_hotkey: None,
            read_only_validation_mode_enabled: false,
            desktop_notifications_enabled: false,
            notification_content_preview_enabled: true,
            notify_work_item_assignments: true,
            notify_work_item_state_changes: true,
            notify_pr_review_requests: true,
            notify_pr_vote_resets: true,
            notify_pr_comment_replies: true,
            quiet_hours_enabled: false,
            quiet_hours_start: DEFAULT_QUIET_HOURS_START.to_string(),
            quiet_hours_end: DEFAULT_QUIET_HOURS_END.to_string(),
            review_stale_threshold_days: DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
            work_item_stale_threshold_days: DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
            notification_rules: Vec::new(),
        }
    }
}

impl AppDatabase {
    pub fn get_app_settings(&self) -> Result<AppSettings> {
        let conn = self.open()?;
        get_app_settings(&conn)
    }

    pub fn update_app_settings(&self, settings: AppSettings) -> Result<AppSettings> {
        let conn = self.open()?;
        update_app_settings(&conn, settings)
    }

    /// The id of the connection the app is currently pointed at. `None` until one
    /// is chosen (the app then defaults to the first connection).
    pub fn get_active_organization_id(&self) -> Result<Option<String>> {
        let conn = self.open()?;
        get_setting(&conn, "active_organization_id")
    }

    pub fn set_active_organization_id(&self, id: Option<&str>) -> Result<()> {
        let conn = self.open()?;
        set_setting(&conn, "active_organization_id", id)
    }

    pub fn get_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Option<i64>> {
        let conn = self.open()?;
        get_pr_comment_seen(&conn, org_id, repository_id, pull_request_id)
    }

    pub fn set_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        last_seen_comment_id: i64,
    ) -> Result<()> {
        let conn = self.open()?;
        set_pr_comment_seen(
            &conn,
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
        )
    }
}

pub(crate) fn get_app_settings(conn: &Connection) -> Result<AppSettings> {
    Ok(AppSettings {
        review_result_folder_path: get_setting(conn, "review_result_folder_path")?,
        show_window_hotkey: get_setting(conn, "show_window_hotkey")?,
        read_only_validation_mode_enabled: get_bool_setting(
            conn,
            "read_only_validation_mode_enabled",
            false,
        )?,
        desktop_notifications_enabled: get_bool_setting(
            conn,
            "desktop_notifications_enabled",
            false,
        )?,
        notification_content_preview_enabled: get_bool_setting(
            conn,
            "notification_content_preview_enabled",
            true,
        )?,
        notify_work_item_assignments: get_bool_setting(conn, "notify_work_item_assignments", true)?,
        notify_work_item_state_changes: get_bool_setting(
            conn,
            "notify_work_item_state_changes",
            true,
        )?,
        notify_pr_review_requests: get_bool_setting(conn, "notify_pr_review_requests", true)?,
        notify_pr_vote_resets: get_bool_setting(conn, "notify_pr_vote_resets", true)?,
        notify_pr_comment_replies: get_bool_setting(conn, "notify_pr_comment_replies", true)?,
        quiet_hours_enabled: get_bool_setting(conn, "quiet_hours_enabled", false)?,
        quiet_hours_start: get_setting(conn, "quiet_hours_start")?
            .filter(|raw| is_valid_hh_mm(raw))
            .unwrap_or_else(|| DEFAULT_QUIET_HOURS_START.to_string()),
        quiet_hours_end: get_setting(conn, "quiet_hours_end")?
            .filter(|raw| is_valid_hh_mm(raw))
            .unwrap_or_else(|| DEFAULT_QUIET_HOURS_END.to_string()),
        review_stale_threshold_days: get_review_stale_threshold_days(conn)?,
        work_item_stale_threshold_days: get_work_item_stale_threshold_days(conn)?,
        notification_rules: get_notification_rules(conn)?,
    })
}

fn get_review_stale_threshold_days(conn: &Connection) -> Result<i64> {
    let value = get_setting(conn, "review_stale_threshold_days")?
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|days| REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
        .unwrap_or(DEFAULT_REVIEW_STALE_THRESHOLD_DAYS);
    Ok(value)
}

// Accepts a zero-padded "HH:MM" string with valid hour/minute ranges. Used to
// reject corrupt or legacy values read back from the key-value store.
fn is_valid_hh_mm(value: &str) -> bool {
    let Some((h, m)) = value.trim().split_once(':') else {
        return false;
    };
    matches!((h.parse::<u32>(), m.parse::<u32>()), (Ok(hour), Ok(minute)) if hour < 24 && minute < 60)
}

fn get_work_item_stale_threshold_days(conn: &Connection) -> Result<i64> {
    let value = get_setting(conn, "work_item_stale_threshold_days")?
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|days| WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
        .unwrap_or(DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS);
    Ok(value)
}

// Stored as a JSON array string. Corrupt or absent JSON falls back to an empty
// rule set, which preserves the legacy per-toggle notification behaviour.
fn get_notification_rules(conn: &Connection) -> Result<Vec<NotificationRule>> {
    match get_setting(conn, "notification_rules")? {
        Some(raw) if !raw.trim().is_empty() => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        _ => Ok(Vec::new()),
    }
}

pub(crate) fn update_app_settings(conn: &Connection, settings: AppSettings) -> Result<AppSettings> {
    set_setting(
        conn,
        "review_result_folder_path",
        settings.review_result_folder_path.as_deref(),
    )?;
    set_setting(
        conn,
        "show_window_hotkey",
        settings.show_window_hotkey.as_deref(),
    )?;
    set_bool_setting(
        conn,
        "read_only_validation_mode_enabled",
        settings.read_only_validation_mode_enabled,
    )?;
    set_bool_setting(
        conn,
        "desktop_notifications_enabled",
        settings.desktop_notifications_enabled,
    )?;
    set_bool_setting(
        conn,
        "notification_content_preview_enabled",
        settings.notification_content_preview_enabled,
    )?;
    set_bool_setting(
        conn,
        "notify_work_item_assignments",
        settings.notify_work_item_assignments,
    )?;
    set_bool_setting(
        conn,
        "notify_work_item_state_changes",
        settings.notify_work_item_state_changes,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_review_requests",
        settings.notify_pr_review_requests,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_vote_resets",
        settings.notify_pr_vote_resets,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_comment_replies",
        settings.notify_pr_comment_replies,
    )?;
    set_bool_setting(conn, "quiet_hours_enabled", settings.quiet_hours_enabled)?;
    set_setting(conn, "quiet_hours_start", Some(&settings.quiet_hours_start))?;
    set_setting(conn, "quiet_hours_end", Some(&settings.quiet_hours_end))?;
    let stale_days =
        if REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(&settings.review_stale_threshold_days) {
            settings.review_stale_threshold_days
        } else {
            DEFAULT_REVIEW_STALE_THRESHOLD_DAYS
        };
    set_setting(
        conn,
        "review_stale_threshold_days",
        Some(&stale_days.to_string()),
    )?;
    let work_item_stale_days = if WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS
        .contains(&settings.work_item_stale_threshold_days)
    {
        settings.work_item_stale_threshold_days
    } else {
        DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS
    };
    set_setting(
        conn,
        "work_item_stale_threshold_days",
        Some(&work_item_stale_days.to_string()),
    )?;
    let rules_json =
        serde_json::to_string(&settings.notification_rules).unwrap_or_else(|_| "[]".to_string());
    set_setting(conn, "notification_rules", Some(&rules_json))?;
    get_app_settings(conn)
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
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

pub(crate) fn get_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT last_seen_comment_id FROM pr_comment_seen \
             WHERE organization_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id],
            |row| row.get(0),
        )
        .optional()?)
}

pub(crate) fn set_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
    last_seen_comment_id: i64,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO pr_comment_seen(organization_id, repository_id, pull_request_id, last_seen_comment_id, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(organization_id, repository_id, pull_request_id)
        DO UPDATE SET last_seen_comment_id = excluded.last_seen_comment_id, updated_at = excluded.updated_at
        "#,
        params![
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn get_bool_setting(conn: &Connection, key: &str, default_value: bool) -> Result<bool> {
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

fn set_bool_setting(conn: &Connection, key: &str, value: bool) -> Result<()> {
    set_setting(conn, key, Some(if value { "true" } else { "false" }))
}
