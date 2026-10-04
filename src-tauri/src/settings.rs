use std::fs;
use std::path::{Path, PathBuf};

mod result_files;
mod result_html;

use serde::{Deserialize, Serialize};

use chrono::Utc;

use crate::agent_notes::{ensure_guide, NoteTarget};

use crate::db::{
    AppDatabase, AppSettings, NotificationRule, DEFAULT_QUIET_HOURS_END, DEFAULT_QUIET_HOURS_START,
    DEFAULT_REVIEW_STALE_THRESHOLD_DAYS, DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
    REVIEW_STALE_THRESHOLD_DAY_OPTIONS, WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
};
use crate::diagnostics::{build_report, report_to_json, ConnectionFacts, DiagnosticsInput};
use crate::error::{AppError, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppSettingsInput {
    pub review_result_folder_path: Option<String>,
    pub work_item_result_folder_path: Option<String>,
    pub show_window_hotkey: Option<String>,
    #[serde(default)]
    pub agent_command: Option<String>,
    pub read_only_validation_mode_enabled: Option<bool>,
    pub desktop_notifications_enabled: Option<bool>,
    pub notification_content_preview_enabled: Option<bool>,
    pub notify_work_item_assignments: Option<bool>,
    pub notify_work_item_state_changes: Option<bool>,
    pub notify_pr_review_requests: Option<bool>,
    pub notify_pr_vote_resets: Option<bool>,
    pub notify_pr_comment_replies: Option<bool>,
    pub quiet_hours_enabled: Option<bool>,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub review_stale_threshold_days: Option<i64>,
    pub work_item_stale_threshold_days: Option<i64>,
    pub notification_rules: Option<Vec<NotificationRule>>,
    pub experimental_features_enabled: Option<bool>,
    pub experimental_usage_stats: Option<bool>,
    pub experimental_retry_toasts: Option<bool>,
    pub experimental_diagnostics_export: Option<bool>,
    pub experimental_cross_org_summary: Option<bool>,
    pub experimental_auto_update_check: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReviewResultPreviewInput {
    pub pull_request_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkItemResultPreviewInput {
    pub work_item_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsInput {
    /// Replace organization identifiers with `<org-N>` placeholders.
    #[serde(default)]
    pub redact_organizations: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    pub file_path: String,
    /// Returned so the user can see exactly what is being shared before
    /// attaching the file to a bug report.
    pub contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResultPreview {
    pub pull_request_id: i64,
    pub file_name: String,
    pub file_path: String,
    #[serde(flatten)]
    pub content: result_html::ResultHtml,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemResultPreview {
    pub work_item_id: i64,
    pub file_name: String,
    pub file_path: String,
    #[serde(flatten)]
    pub content: result_html::ResultHtml,
}

#[derive(Clone)]
pub struct SettingsService {
    db: AppDatabase,
}

impl SettingsService {
    pub fn new(db: AppDatabase) -> Self {
        Self { db }
    }

    pub fn get(&self) -> Result<AppSettings> {
        self.db.get_app_settings()
    }

    pub fn update_normalized(&self, settings: AppSettings) -> Result<AppSettings> {
        let saved = self.db.update_app_settings(settings)?;
        place_agent_guides(&saved);
        Ok(saved)
    }

    /// Writes a diagnostic report next to the review results, since that folder
    /// is already a user-chosen location the app is allowed to write to. Using
    /// it avoids taking a dialog-plugin dependency just for this.
    pub fn export_diagnostics(
        &self,
        input: ExportDiagnosticsInput,
        app_version: String,
    ) -> Result<DiagnosticsExport> {
        let settings = self.db.get_app_settings()?;
        let Some(folder_path) = settings.review_result_folder_path else {
            return Err(AppError::InvalidInput(
                "Set the review result folder in Settings before exporting diagnostics."
                    .to_string(),
            ));
        };
        let folder = PathBuf::from(&folder_path);
        if !folder.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "review result folder does not exist: {}",
                folder.display()
            )));
        }

        // Only the publishable fields are carried over; `credential_key` and the
        // authenticated user stay behind.
        let connections = self
            .db
            .list_organizations()?
            .into_iter()
            .map(|org| ConnectionFacts {
                id: org.id,
                provider_kind: org.provider_kind,
                auth_provider: org.auth_provider,
            })
            .collect();

        let report = build_report(DiagnosticsInput {
            app_version,
            os: std::env::consts::OS.to_string(),
            connections,
            sync_states: self.db.list_sync_states()?,
            redact_organizations: input.redact_organizations,
        });
        let contents = report_to_json(&report);

        let file_path = folder.join(format!(
            "devdeck-diagnostics-{}.json",
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        fs::write(&file_path, &contents)?;

        Ok(DiagnosticsExport {
            file_path: file_path.display().to_string(),
            contents,
        })
    }
}

/// Places or refreshes the agent notes guide in both result folders. Best
/// effort: a folder that cannot take the guide must not block saving the rest
/// of the settings or starting the app.
pub(crate) fn place_agent_guides(settings: &AppSettings) {
    for (folder, target) in [
        (&settings.work_item_result_folder_path, NoteTarget::WorkItem),
        (&settings.review_result_folder_path, NoteTarget::PullRequest),
    ] {
        if let Some(folder) = folder {
            if let Err(err) = ensure_guide(Path::new(folder), target) {
                tracing::warn!(%folder, error = %err, "could not place agent notes guide");
            }
        }
    }
}

pub fn normalize_app_settings(input: UpdateAppSettingsInput) -> AppSettings {
    AppSettings {
        review_result_folder_path: normalize_path(input.review_result_folder_path),
        work_item_result_folder_path: normalize_path(input.work_item_result_folder_path),
        show_window_hotkey: normalize_path(input.show_window_hotkey),
        agent_command: normalize_path(input.agent_command),
        read_only_validation_mode_enabled: input.read_only_validation_mode_enabled.unwrap_or(false),
        desktop_notifications_enabled: input.desktop_notifications_enabled.unwrap_or(false),
        notification_content_preview_enabled: input
            .notification_content_preview_enabled
            .unwrap_or(true),
        notify_work_item_assignments: input.notify_work_item_assignments.unwrap_or(true),
        notify_work_item_state_changes: input.notify_work_item_state_changes.unwrap_or(true),
        notify_pr_review_requests: input.notify_pr_review_requests.unwrap_or(true),
        notify_pr_vote_resets: input.notify_pr_vote_resets.unwrap_or(true),
        notify_pr_comment_replies: input.notify_pr_comment_replies.unwrap_or(true),
        quiet_hours_enabled: input.quiet_hours_enabled.unwrap_or(false),
        quiet_hours_start: normalize_quiet_hour(input.quiet_hours_start, DEFAULT_QUIET_HOURS_START),
        quiet_hours_end: normalize_quiet_hour(input.quiet_hours_end, DEFAULT_QUIET_HOURS_END),
        review_stale_threshold_days: input
            .review_stale_threshold_days
            .filter(|days| REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
            .unwrap_or(DEFAULT_REVIEW_STALE_THRESHOLD_DAYS),
        work_item_stale_threshold_days: input
            .work_item_stale_threshold_days
            .filter(|days| WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
            .unwrap_or(DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS),
        notification_rules: input
            .notification_rules
            .unwrap_or_default()
            .into_iter()
            .map(normalize_notification_rule)
            .filter(|rule| !rule.is_empty())
            .collect(),
        experimental_features_enabled: input.experimental_features_enabled.unwrap_or(false),
        experimental_usage_stats: input.experimental_usage_stats.unwrap_or(false),
        experimental_retry_toasts: input.experimental_retry_toasts.unwrap_or(false),
        experimental_diagnostics_export: input.experimental_diagnostics_export.unwrap_or(false),
        experimental_cross_org_summary: input.experimental_cross_org_summary.unwrap_or(false),
        experimental_auto_update_check: input.experimental_auto_update_check.unwrap_or(false),
    }
}

// Trim and drop blank entries so a half-filled rule row from the UI does not
// match every notification by accident.
fn normalize_notification_rule(rule: NotificationRule) -> NotificationRule {
    fn clean(values: Vec<String>) -> Vec<String> {
        values
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect()
    }
    NotificationRule {
        types: clean(rule.types),
        projects: clean(rule.projects),
        repositories: clean(rule.repositories),
        mute: rule.mute,
    }
}

impl SettingsService {
    pub fn review_result_preview(
        &self,
        input: GetReviewResultPreviewInput,
    ) -> Result<Option<ReviewResultPreview>> {
        if input.pull_request_id <= 0 {
            return Err(AppError::InvalidInput(
                "pullRequestId must be greater than zero".to_string(),
            ));
        }

        let settings = self.db.get_app_settings()?;
        let Some(folder_path) = settings.review_result_folder_path else {
            return Ok(None);
        };

        let folder = PathBuf::from(folder_path);
        if !folder.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "review result folder does not exist: {}",
                folder.display()
            )));
        }

        let Some(file_path) =
            result_files::find_review_result_file(&folder, input.pull_request_id)?
        else {
            return Ok(None);
        };
        let content = result_html::read_result_html(&file_path)?;
        Ok(Some(ReviewResultPreview {
            pull_request_id: input.pull_request_id,
            file_name: file_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            file_path: file_path.display().to_string(),
            content,
        }))
    }

    pub fn work_item_result_preview(
        &self,
        input: GetWorkItemResultPreviewInput,
    ) -> Result<Option<WorkItemResultPreview>> {
        if input.work_item_id <= 0 {
            return Err(AppError::InvalidInput(
                "workItemId must be greater than zero".to_string(),
            ));
        }

        let settings = self.db.get_app_settings()?;
        let Some(folder_path) = settings.work_item_result_folder_path else {
            return Ok(None);
        };

        let folder = PathBuf::from(folder_path);
        if !folder.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "work item result folder does not exist: {}",
                folder.display()
            )));
        }

        let Some(file_path) =
            result_files::find_work_item_result_file(&folder, input.work_item_id)?
        else {
            return Ok(None);
        };
        let content = result_html::read_result_html(&file_path)?;
        Ok(Some(WorkItemResultPreview {
            work_item_id: input.work_item_id,
            file_name: file_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            file_path: file_path.display().to_string(),
            content,
        }))
    }
}

fn normalize_path(value: Option<String>) -> Option<String> {
    value
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
}

// Accept a "HH:MM" time, normalizing to a zero-padded canonical form. Anything
// unparseable falls back to the provided default so a bad value never disables
// the window silently.
fn normalize_quiet_hour(value: Option<String>, fallback: &str) -> String {
    value
        .and_then(|raw| {
            let (h, m) = raw.trim().split_once(':')?;
            let hour: u32 = h.trim().parse().ok()?;
            let minute: u32 = m.trim().parse().ok()?;
            if hour < 24 && minute < 60 {
                Some(format!("{hour:02}:{minute:02}"))
            } else {
                None
            }
        })
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_quiet_hour;

    #[test]
    fn normalize_quiet_hour_pads_valid_times_and_falls_back_otherwise() {
        assert_eq!(normalize_quiet_hour(Some("7:5".into()), "22:00"), "07:05");
        assert_eq!(
            normalize_quiet_hour(Some(" 23:59 ".into()), "22:00"),
            "23:59"
        );
        assert_eq!(normalize_quiet_hour(Some("24:00".into()), "22:00"), "22:00");
        assert_eq!(normalize_quiet_hour(Some("12:60".into()), "22:00"), "22:00");
        assert_eq!(normalize_quiet_hour(Some("noon".into()), "22:00"), "22:00");
        assert_eq!(normalize_quiet_hour(None, "08:00"), "08:00");
    }
}
