use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use chrono::Utc;

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
    pub html: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemResultPreview {
    pub work_item_id: i64,
    pub file_name: String,
    pub file_path: String,
    pub html: String,
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
        self.db.update_app_settings(settings)
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

pub fn normalize_app_settings(input: UpdateAppSettingsInput) -> AppSettings {
    AppSettings {
        review_result_folder_path: normalize_path(input.review_result_folder_path),
        work_item_result_folder_path: normalize_path(input.work_item_result_folder_path),
        show_window_hotkey: normalize_path(input.show_window_hotkey),
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

        let Some(file_path) = find_review_result_file(&folder, input.pull_request_id)? else {
            return Ok(None);
        };
        let html = fs::read_to_string(&file_path)?;
        Ok(Some(ReviewResultPreview {
            pull_request_id: input.pull_request_id,
            file_name: file_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            file_path: file_path.display().to_string(),
            html,
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

        let Some(file_path) = find_work_item_result_file(&folder, input.work_item_id)? else {
            return Ok(None);
        };
        let html = fs::read_to_string(&file_path)?;
        Ok(Some(WorkItemResultPreview {
            work_item_id: input.work_item_id,
            file_name: file_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            file_path: file_path.display().to_string(),
            html,
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

fn find_review_result_file(folder: &Path, pull_request_id: i64) -> Result<Option<PathBuf>> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !is_html_file(&path) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name_matches_pr(file_name, pull_request_id) {
            matches.push(path);
        }
    }

    matches.sort_by_key(|path| {
        path.file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default()
    });
    Ok(matches.into_iter().next())
}

fn find_work_item_result_file(folder: &Path, work_item_id: i64) -> Result<Option<PathBuf>> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !is_html_file(&path) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name_matches_work_item(file_name, work_item_id) {
            matches.push(path);
        }
    }

    matches.sort_by_key(|path| {
        path.file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default()
    });
    Ok(matches.into_iter().next())
}

/// Unlike `file_name_matches_pr`, this matches on the work item id alone (no
/// "WIT"/"WI" prefix required) since result files are not guaranteed to carry
/// one. A match requires the id to appear as a standalone digit run, so id 42
/// does not match "1042" or "422".
fn file_name_matches_work_item(file_name: &str, work_item_id: i64) -> bool {
    let needle = work_item_id.to_string();
    let bytes = file_name.as_bytes();
    let mut index = 0;

    while let Some(relative) = file_name[index..].find(needle.as_str()) {
        let start = index + relative;
        let end = start + needle.len();
        let before_is_digit = start > 0 && bytes[start - 1].is_ascii_digit();
        let after_is_digit = bytes.get(end).is_some_and(|value| value.is_ascii_digit());
        if !before_is_digit && !after_is_digit {
            return true;
        }
        index = start + 1;
    }

    false
}

fn is_html_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "html" | "htm"))
        .unwrap_or(false)
}

fn file_name_matches_pr(file_name: &str, pull_request_id: i64) -> bool {
    let needle = pull_request_id.to_string();
    let upper = file_name.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    let mut index = 0;

    while let Some(relative) = upper[index..].find("PR") {
        let start = index + relative + 2;
        let mut number_start = start;
        while bytes.get(number_start) == Some(&b'0') {
            number_start += 1;
        }

        if upper[number_start..].starts_with(&needle) {
            let end = number_start + needle.len();
            if !bytes.get(end).is_some_and(|value| value.is_ascii_digit()) {
                return true;
            }
        }

        index = start;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_matches_pr_token_with_optional_zero_padding() {
        assert!(file_name_matches_pr("review-PR1234.html", 1234));
        assert!(file_name_matches_pr("PR0007-result.htm", 7));
        assert!(file_name_matches_pr("prefix-pr42-suffix.html", 42));
        assert!(!file_name_matches_pr("review-PR12345.html", 1234));
        assert!(!file_name_matches_pr("review-1234.html", 1234));
    }

    #[test]
    fn find_review_result_file_returns_first_matching_html_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("notes-PR42.txt"), "ignored").unwrap();
        fs::write(temp.path().join("b-PR42.html"), "<html>b</html>").unwrap();
        fs::write(temp.path().join("a-PR42.htm"), "<html>a</html>").unwrap();

        let found = find_review_result_file(temp.path(), 42).unwrap().unwrap();
        assert_eq!(found.file_name().unwrap(), "a-PR42.htm");
    }

    #[test]
    fn file_name_matches_work_item_on_standalone_digit_run() {
        assert!(file_name_matches_work_item("WIT1234.html", 1234));
        assert!(file_name_matches_work_item("1234-result.html", 1234));
        assert!(file_name_matches_work_item("result-1234.html", 1234));
        assert!(!file_name_matches_work_item("result-11234.html", 1234));
        assert!(!file_name_matches_work_item("result-12345.html", 1234));
        assert!(!file_name_matches_work_item("result-999.html", 1234));
    }

    #[test]
    fn find_work_item_result_file_returns_first_matching_html_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("notes-1234.txt"), "ignored").unwrap();
        fs::write(temp.path().join("b-1234.html"), "<html>b</html>").unwrap();
        fs::write(temp.path().join("a-1234.htm"), "<html>a</html>").unwrap();

        let found = find_work_item_result_file(temp.path(), 1234)
            .unwrap()
            .unwrap();
        assert_eq!(found.file_name().unwrap(), "a-1234.htm");
    }
}
