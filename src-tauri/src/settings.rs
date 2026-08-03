use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use chrono::Utc;

use crate::db::{
    AppDatabase, AppSettings, NotificationRule, DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
    DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS, REVIEW_STALE_THRESHOLD_DAY_OPTIONS,
    WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
};
use crate::diagnostics::{build_report, report_to_json, ConnectionFacts, DiagnosticsInput};
use crate::error::{AppError, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppSettingsInput {
    pub review_result_folder_path: Option<String>,
    pub show_window_hotkey: Option<String>,
    pub read_only_validation_mode_enabled: Option<bool>,
    pub desktop_notifications_enabled: Option<bool>,
    pub notification_content_preview_enabled: Option<bool>,
    pub notify_work_item_assignments: Option<bool>,
    pub notify_work_item_state_changes: Option<bool>,
    pub notify_pr_review_requests: Option<bool>,
    pub notify_pr_vote_resets: Option<bool>,
    pub notify_pr_comment_replies: Option<bool>,
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
}

fn normalize_path(value: Option<String>) -> Option<String> {
    value
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
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
}
