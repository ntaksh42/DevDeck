use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::{
    AppDatabase, AppSettings, NotificationRule, DEFAULT_QUIET_HOURS_END, DEFAULT_QUIET_HOURS_START,
    DEFAULT_REVIEW_STALE_THRESHOLD_DAYS, DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
    REVIEW_STALE_THRESHOLD_DAY_OPTIONS, WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
};
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
    pub quiet_hours_enabled: Option<bool>,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub review_stale_threshold_days: Option<i64>,
    pub work_item_stale_threshold_days: Option<i64>,
    pub notification_rules: Option<Vec<NotificationRule>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetReviewResultPreviewInput {
    pub pull_request_id: i64,
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
