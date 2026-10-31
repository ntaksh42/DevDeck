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
    pub work_item_result_folder_path: Option<String>,
    pub show_window_hotkey: Option<String>,
    /// Shell command that starts Claude Code on an item's notes (`{target}`,
    /// `{id}`, `{notes}` placeholders). Run from the result folder.
    pub agent_command: Option<String>,
    /// The same for Codex.
    pub codex_command: Option<String>,
    /// Agent a request goes to unless the composer picks another: `codex`, or
    /// unset for Claude Code.
    pub default_agent: Option<String>,
    /// Lets DevDeck post the (signed) comments an agent proposes without the
    /// user approving each one.
    pub agent_auto_post_enabled: bool,
    /// Model each agent starts with (unset: the agent's own setting), and the
    /// extra models the Agent panel offers, comma-separated.
    pub claude_model: Option<String>,
    pub codex_model: Option<String>,
    pub claude_model_choices: Option<String>,
    pub codex_model_choices: Option<String>,
    /// One folder holding the repository clones (`{workspace}\{repo}`). The
    /// agent runs in the clone of the pull request's repository when it exists,
    /// else here; unset, it runs in the result folder.
    pub agent_workspace_path: Option<String>,
    /// After each PR / work item sync, Claude Code writes a summary, a
    /// recommended action and (when needed) a read-only investigation for new
    /// Inbox items. Off by default: it sends comment text to the model.
    pub inbox_insight_enabled: bool,
    /// Model for those summaries; unset means `sonnet`.
    pub inbox_insight_model: Option<String>,
    /// After each sync, starts the agent (Agent notes `investigate`) on pull
    /// requests newly awaiting my review and work items newly assigned to me,
    /// up to three per organization and sync. Off by default.
    pub auto_agent_enabled: bool,
    /// When a watched pipeline's latest run fails, starts the agent on an
    /// `investigate` request about it (the frontend watches pipelines and
    /// starts it). Off by default.
    pub auto_agent_pipelines_enabled: bool,
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
    /// Master switch for the experimental section. Every `experimental_*` flag
    /// below is only in effect while this is true, so turning this off disables
    /// all experiments at once without losing the individual choices.
    pub experimental_features_enabled: bool,
    pub experimental_usage_stats: bool,
    pub experimental_retry_toasts: bool,
    pub experimental_diagnostics_export: bool,
    pub experimental_cross_org_summary: bool,
    pub experimental_auto_update_check: bool,
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
            work_item_result_folder_path: None,
            show_window_hotkey: None,
            agent_command: None,
            codex_command: None,
            default_agent: None,
            agent_auto_post_enabled: false,
            claude_model: None,
            codex_model: None,
            claude_model_choices: None,
            codex_model_choices: None,
            agent_workspace_path: None,
            inbox_insight_enabled: false,
            inbox_insight_model: None,
            auto_agent_enabled: false,
            auto_agent_pipelines_enabled: false,
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
            experimental_features_enabled: false,
            experimental_usage_stats: false,
            experimental_retry_toasts: false,
            experimental_diagnostics_export: false,
            experimental_cross_org_summary: false,
            experimental_auto_update_check: false,
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
}

pub(crate) fn get_app_settings(conn: &Connection) -> Result<AppSettings> {
    Ok(AppSettings {
        review_result_folder_path: get_setting(conn, "review_result_folder_path")?,
        work_item_result_folder_path: get_setting(conn, "work_item_result_folder_path")?,
        show_window_hotkey: get_setting(conn, "show_window_hotkey")?,
        agent_command: get_setting(conn, "agent_command")?,
        codex_command: get_setting(conn, "codex_command")?,
        default_agent: get_setting(conn, "default_agent")?,
        claude_model: get_setting(conn, "claude_model")?,
        codex_model: get_setting(conn, "codex_model")?,
        claude_model_choices: get_setting(conn, "claude_model_choices")?,
        codex_model_choices: get_setting(conn, "codex_model_choices")?,
        agent_workspace_path: get_setting(conn, "agent_workspace_path")?,
        agent_auto_post_enabled: get_bool_setting(conn, "agent_auto_post_enabled", false)?,
        inbox_insight_enabled: get_bool_setting(conn, "inbox_insight_enabled", false)?,
        inbox_insight_model: get_setting(conn, "inbox_insight_model")?,
        auto_agent_enabled: get_bool_setting(conn, "auto_agent_enabled", false)?,
        auto_agent_pipelines_enabled: get_bool_setting(
            conn,
            "auto_agent_pipelines_enabled",
            false,
        )?,
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
        experimental_features_enabled: get_bool_setting(
            conn,
            "experimental_features_enabled",
            false,
        )?,
        experimental_usage_stats: get_bool_setting(conn, "experimental_usage_stats", false)?,
        experimental_retry_toasts: get_bool_setting(conn, "experimental_retry_toasts", false)?,
        experimental_diagnostics_export: get_bool_setting(
            conn,
            "experimental_diagnostics_export",
            false,
        )?,
        experimental_cross_org_summary: get_bool_setting(
            conn,
            "experimental_cross_org_summary",
            false,
        )?,
        experimental_auto_update_check: get_bool_setting(
            conn,
            "experimental_auto_update_check",
            false,
        )?,
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
        "work_item_result_folder_path",
        settings.work_item_result_folder_path.as_deref(),
    )?;
    set_setting(
        conn,
        "show_window_hotkey",
        settings.show_window_hotkey.as_deref(),
    )?;
    set_setting(conn, "agent_command", settings.agent_command.as_deref())?;
    set_setting(conn, "codex_command", settings.codex_command.as_deref())?;
    set_setting(conn, "default_agent", settings.default_agent.as_deref())?;
    for (key, value) in [
        ("claude_model", &settings.claude_model),
        ("codex_model", &settings.codex_model),
        ("claude_model_choices", &settings.claude_model_choices),
        ("codex_model_choices", &settings.codex_model_choices),
        ("inbox_insight_model", &settings.inbox_insight_model),
    ] {
        set_setting(conn, key, value.as_deref())?;
    }
    set_setting(
        conn,
        "agent_workspace_path",
        settings.agent_workspace_path.as_deref(),
    )?;
    set_bool_setting(
        conn,
        "agent_auto_post_enabled",
        settings.agent_auto_post_enabled,
    )?;
    set_bool_setting(
        conn,
        "inbox_insight_enabled",
        settings.inbox_insight_enabled,
    )?;
    set_bool_setting(conn, "auto_agent_enabled", settings.auto_agent_enabled)?;
    set_bool_setting(
        conn,
        "auto_agent_pipelines_enabled",
        settings.auto_agent_pipelines_enabled,
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
    set_bool_setting(
        conn,
        "experimental_features_enabled",
        settings.experimental_features_enabled,
    )?;
    set_bool_setting(
        conn,
        "experimental_usage_stats",
        settings.experimental_usage_stats,
    )?;
    set_bool_setting(
        conn,
        "experimental_retry_toasts",
        settings.experimental_retry_toasts,
    )?;
    set_bool_setting(
        conn,
        "experimental_diagnostics_export",
        settings.experimental_diagnostics_export,
    )?;
    set_bool_setting(
        conn,
        "experimental_cross_org_summary",
        settings.experimental_cross_org_summary,
    )?;
    set_bool_setting(
        conn,
        "experimental_auto_update_check",
        settings.experimental_auto_update_check,
    )?;
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
