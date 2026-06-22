use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::db::{AppDatabase, CachedReviewPr, CachedWorkItem};
use crate::error::{AppError, Result};

pub const ITEM_TYPE_PULL_REQUEST: &str = "pull_request";
pub const ITEM_TYPE_WORK_ITEM: &str = "work_item";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeItemInput {
    pub organization_id: Option<String>,
    pub item_type: String,
    pub item_key: String,
    /// UTC ISO8601 instant at which the item should return to the normal list.
    pub snooze_until: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsnoozeItemInput {
    pub organization_id: Option<String>,
    pub item_type: String,
    pub item_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSnoozedItemsInput {
    pub organization_id: Option<String>,
    pub item_type: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnoozedItemSummary {
    pub item_type: String,
    pub item_key: String,
    pub snooze_until: String,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub web_url: Option<String>,
}

/// Outcome of reconciling snoozed items against a fresh sync: keys that returned
/// to the normal list and keys that remain hidden.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SnoozeReconcile {
    pub revived: Vec<String>,
    pub still_snoozed: Vec<String>,
}

#[derive(Clone)]
pub struct SnoozeService {
    db: AppDatabase,
}

impl SnoozeService {
    pub fn new(db: AppDatabase) -> Self {
        Self { db }
    }

    pub fn snooze_item(&self, input: SnoozeItemInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let item_type = validate_item_type(&input.item_type)?;
        if input.item_key.trim().is_empty() {
            return Err(AppError::InvalidInput("item_key is required".to_string()));
        }
        let baseline = self.current_baseline(&organization.id, item_type, &input.item_key)?;
        self.db.upsert_snoozed_item(
            &organization.id,
            item_type,
            &input.item_key,
            &input.snooze_until,
            baseline.as_deref(),
        )?;
        Ok(())
    }

    pub fn unsnooze_item(&self, input: UnsnoozeItemInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let item_type = validate_item_type(&input.item_type)?;
        self.db
            .delete_snoozed_item(&organization.id, item_type, &input.item_key)?;
        Ok(())
    }

    pub fn list_snoozed_items(
        &self,
        input: ListSnoozedItemsInput,
    ) -> Result<Vec<SnoozedItemSummary>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let item_type = validate_item_type(&input.item_type)?;
        let rows = self.db.list_snoozed_items(&organization.id, item_type)?;
        if rows.is_empty() {
            return Ok(Vec::new());
        }

        let summaries = match item_type {
            ITEM_TYPE_PULL_REQUEST => {
                let prs = self.db.list_review_pull_requests(&organization.id)?;
                let by_key: HashMap<String, &CachedReviewPr> =
                    prs.iter().map(|pr| (pr_item_key(pr), pr)).collect();
                rows.into_iter()
                    .map(|row| {
                        let pr = by_key.get(&row.item_key).copied();
                        SnoozedItemSummary {
                            item_type: row.item_type,
                            item_key: row.item_key,
                            snooze_until: row.snooze_until,
                            title: pr.map(|pr| pr.title.clone()),
                            subtitle: pr.map(|pr| pr.repository_name.clone()),
                            web_url: pr.and_then(|pr| pr.web_url.clone()),
                        }
                    })
                    .collect()
            }
            _ => {
                let items = self.db.list_my_work_items(&organization.id)?;
                let by_key: HashMap<String, &CachedWorkItem> = items
                    .iter()
                    .map(|item| (item.id.to_string(), item))
                    .collect();
                rows.into_iter()
                    .map(|row| {
                        let item = by_key.get(&row.item_key).copied();
                        SnoozedItemSummary {
                            item_type: row.item_type,
                            item_key: row.item_key,
                            snooze_until: row.snooze_until,
                            title: item.map(|item| item.title.clone()),
                            subtitle: item.and_then(|item| item.state.clone()),
                            web_url: item.and_then(|item| item.web_url.clone()),
                        }
                    })
                    .collect()
            }
        };
        Ok(summaries)
    }

    /// Evaluates snoozed pull requests against the freshly synced cache. Items
    /// past their deadline or with new comment activity are removed from the
    /// snooze table; their keys are returned so the caller can emit revival
    /// notifications. The set of keys still snoozed is returned for filtering
    /// out their notifications.
    pub fn reconcile_pull_requests(&self, org_id: &str, now: &str) -> Result<SnoozeReconcile> {
        let rows = self.db.list_snoozed_items(org_id, ITEM_TYPE_PULL_REQUEST)?;
        let mut result = SnoozeReconcile::default();
        for row in rows {
            // `live_comment` is the `pr_comment_seen` cursor, which only advances
            // when comment-reply notifications are processed (requires both
            // `desktop_notifications_enabled` and `notify_pr_comment_replies`).
            // With notifications off the cursor stays put, so `new_activity` is
            // always false and the PR revives by deadline only — see the note on
            // `current_baseline`.
            let live_comment = parse_pr_key(&row.item_key).and_then(|(repo, pr_id)| {
                self.db
                    .get_pr_comment_seen(org_id, &repo, pr_id)
                    .ok()
                    .flatten()
            });
            let new_activity = pr_activity_advanced(row.baseline_activity.as_deref(), live_comment);
            if should_revive(now, &row.snooze_until, new_activity) {
                self.db
                    .delete_snoozed_item(org_id, ITEM_TYPE_PULL_REQUEST, &row.item_key)?;
                result.revived.push(row.item_key);
            } else {
                result.still_snoozed.push(row.item_key);
            }
        }
        Ok(result)
    }

    /// Work item counterpart to [`reconcile_pull_requests`], using ChangedDate as
    /// the activity marker.
    pub fn reconcile_work_items(
        &self,
        org_id: &str,
        current: &[CachedWorkItem],
        now: &str,
    ) -> Result<SnoozeReconcile> {
        let rows = self.db.list_snoozed_items(org_id, ITEM_TYPE_WORK_ITEM)?;
        let by_key: HashMap<String, &CachedWorkItem> = current
            .iter()
            .map(|item| (item.id.to_string(), item))
            .collect();
        let mut result = SnoozeReconcile::default();
        for row in rows {
            let live_changed = by_key
                .get(&row.item_key)
                .and_then(|item| item.changed_date.as_deref());
            let new_activity =
                work_item_activity_advanced(row.baseline_activity.as_deref(), live_changed);
            if should_revive(now, &row.snooze_until, new_activity) {
                self.db
                    .delete_snoozed_item(org_id, ITEM_TYPE_WORK_ITEM, &row.item_key)?;
                result.revived.push(row.item_key);
            } else {
                result.still_snoozed.push(row.item_key);
            }
        }
        Ok(result)
    }

    /// Captures the current activity marker so a later sync can tell whether the
    /// item saw new activity while snoozed. For PRs that is the last-seen comment
    /// id; for work items it is the cached `System.ChangedDate`.
    ///
    /// NOTE (PRs): the marker is the `pr_comment_seen` cursor, which only advances
    /// while `collect_pr_comment_notifications` runs — i.e. when BOTH
    /// `desktop_notifications_enabled` and `notify_pr_comment_replies` are on (see
    /// `sync.rs`). With those off, the cursor never moves, so comment-activity
    /// revival cannot trigger; only the deadline revives the item. Decoupling the
    /// snooze activity marker from the notification cursor (so a new comment
    /// revives a PR regardless of notification settings) would require fetching
    /// the live thread state for snoozed PRs during sync independently of the
    /// notification path; tracked as a follow-up.
    fn current_baseline(
        &self,
        org_id: &str,
        item_type: &str,
        item_key: &str,
    ) -> Result<Option<String>> {
        match item_type {
            ITEM_TYPE_PULL_REQUEST => {
                let Some((repository_id, pull_request_id)) = parse_pr_key(item_key) else {
                    return Ok(None);
                };
                let seen = self
                    .db
                    .get_pr_comment_seen(org_id, &repository_id, pull_request_id)?;
                Ok(seen.map(|id| id.to_string()))
            }
            _ => {
                let id: i64 = item_key
                    .parse()
                    .map_err(|_| AppError::InvalidInput("invalid work item key".to_string()))?;
                let changed = self
                    .db
                    .list_my_work_items(org_id)?
                    .into_iter()
                    .find(|item| item.id == id)
                    .and_then(|item| item.changed_date);
                Ok(changed)
            }
        }
    }
}

/// Decides whether a snoozed item should return to the normal list. An item
/// revives when its deadline has passed or when its live activity marker has
/// moved past the baseline captured at snooze time.
///
/// `now` and `snooze_until` are ISO8601 strings; `baseline` and `current` are
/// the activity markers (PR: comment id; work item: ChangedDate). Both marker
/// kinds compare correctly with a plain string comparison: zero-padded decimals
/// are not used for comment ids, so callers pass numeric comparison results for
/// PRs via [`pr_activity_advanced`]; ChangedDate is ISO8601 and orders
/// lexicographically.
pub fn should_revive(now: &str, snooze_until: &str, new_activity: bool) -> bool {
    new_activity || now >= snooze_until
}

/// True while a snooze is still in effect at `now`. The read paths (My Reviews /
/// My Work Items) use this to hide only items whose deadline is still in the
/// future; an expired — or unparseable — deadline is treated as inactive so the
/// item returns to the list immediately, without waiting for the periodic
/// reconcile to delete the row (which only runs on a successful sync, so it can
/// lag during sync backoff or before the first sync after startup).
///
/// `snooze_until` (frontend `Date.toISOString()` → `...Z`) and `now`
/// (`Utc::now()`) are parsed to `DateTime<Utc>` so the comparison is correct
/// regardless of RFC3339 spelling (`Z` vs `+00:00`, millis vs nanos).
pub fn snooze_is_active(now: DateTime<Utc>, snooze_until: &str) -> bool {
    DateTime::parse_from_rfc3339(snooze_until)
        .map(|until| now < until.with_timezone(&Utc))
        .unwrap_or(false)
}

/// Comment ids are integers; compare numerically rather than as strings so that
/// e.g. "100" counts as newer than "99".
pub fn pr_activity_advanced(baseline: Option<&str>, current: Option<i64>) -> bool {
    match (baseline.and_then(|b| b.parse::<i64>().ok()), current) {
        (Some(base), Some(now)) => now > base,
        // No baseline recorded but activity now exists: treat as new.
        (None, Some(_)) => true,
        _ => false,
    }
}

/// ChangedDate is ISO8601; lexicographic comparison matches chronological order.
pub fn work_item_activity_advanced(baseline: Option<&str>, current: Option<&str>) -> bool {
    match (baseline, current) {
        (Some(base), Some(now)) => now > base,
        (None, Some(_)) => true,
        _ => false,
    }
}

fn validate_item_type(item_type: &str) -> Result<&'static str> {
    match item_type {
        ITEM_TYPE_PULL_REQUEST => Ok(ITEM_TYPE_PULL_REQUEST),
        ITEM_TYPE_WORK_ITEM => Ok(ITEM_TYPE_WORK_ITEM),
        other => Err(AppError::InvalidInput(format!(
            "unsupported snooze item type: {other}"
        ))),
    }
}

pub fn pr_item_key(pr: &CachedReviewPr) -> String {
    format!("{}:{}", pr.repository_id, pr.pull_request_id)
}

fn parse_pr_key(item_key: &str) -> Option<(String, i64)> {
    let (repo, pr) = item_key.rsplit_once(':')?;
    let pr_id: i64 = pr.parse().ok()?;
    Some((repo.to_string(), pr_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pr_key_splits_repo_and_id() {
        assert_eq!(
            parse_pr_key("repo-id:42"),
            Some(("repo-id".to_string(), 42))
        );
        // repository ids can themselves be guids without colons; the last colon wins.
        assert_eq!(parse_pr_key("a:b:7"), Some(("a:b".to_string(), 7)));
        assert_eq!(parse_pr_key("nocolon"), None);
        assert_eq!(parse_pr_key("repo:notanumber"), None);
    }

    #[test]
    fn should_revive_on_deadline_or_activity() {
        let now = "2026-06-17T12:00:00Z";
        // Deadline passed, no new activity.
        assert!(should_revive(now, "2026-06-17T09:00:00Z", false));
        // Deadline in the future, no activity: stay snoozed.
        assert!(!should_revive(now, "2026-06-20T09:00:00Z", false));
        // Deadline in the future but new activity: revive early.
        assert!(should_revive(now, "2026-06-20T09:00:00Z", true));
    }

    #[test]
    fn snooze_is_active_parses_mixed_rfc3339_spellings() {
        let now = DateTime::parse_from_rfc3339("2026-06-17T12:00:00+00:00")
            .unwrap()
            .with_timezone(&Utc);
        // Future deadline (millis + Z, as the frontend emits): still snoozed.
        assert!(snooze_is_active(now, "2026-06-17T12:00:00.500Z"));
        // Past deadline: no longer snoozed even if reconcile has not run.
        assert!(!snooze_is_active(now, "2026-06-17T09:00:00Z"));
        // Exactly now is not "in the future": treated as expired.
        assert!(!snooze_is_active(now, "2026-06-17T12:00:00Z"));
        // Garbage deadline never keeps an item hidden.
        assert!(!snooze_is_active(now, "not-a-date"));
    }

    #[test]
    fn pr_activity_advanced_compares_numerically() {
        assert!(pr_activity_advanced(Some("99"), Some(100)));
        assert!(!pr_activity_advanced(Some("100"), Some(100)));
        assert!(!pr_activity_advanced(Some("100"), Some(50)));
        assert!(pr_activity_advanced(None, Some(1)));
        assert!(!pr_activity_advanced(Some("5"), None));
    }

    #[test]
    fn work_item_activity_advanced_compares_timestamps() {
        assert!(work_item_activity_advanced(
            Some("2026-06-10T00:00:00Z"),
            Some("2026-06-11T00:00:00Z")
        ));
        assert!(!work_item_activity_advanced(
            Some("2026-06-11T00:00:00Z"),
            Some("2026-06-11T00:00:00Z")
        ));
        assert!(work_item_activity_advanced(
            None,
            Some("2026-06-11T00:00:00Z")
        ));
    }

    #[test]
    fn validate_item_type_rejects_unknown() {
        assert!(validate_item_type("pull_request").is_ok());
        assert!(validate_item_type("work_item").is_ok());
        assert!(validate_item_type("commit").is_err());
    }
}
