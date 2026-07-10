use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::json;

use crate::db::{
    AppSettings, CachedReviewPr, CachedWorkItem, NewNotification, NotificationRule,
    MY_WORK_ITEMS_LIMIT,
};

use super::SyncFailedEvent;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkItemNotificationEvent {
    pub(super) organization_id: String,
    pub(super) organization_name: String,
    pub(super) items: Vec<WorkItemNotificationItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkItemNotificationItem {
    pub(super) kind: WorkItemNotificationKind,
    pub(super) id: i64,
    pub(super) title: String,
    pub(super) project_name: String,
    pub(super) state: Option<String>,
    pub(super) previous_state: Option<String>,
    pub(super) assigned_to: Option<String>,
    pub(super) web_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) enum WorkItemNotificationKind {
    Assigned,
    StateChanged,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestNotificationEvent {
    pub organization_id: String,
    pub organization_name: String,
    pub items: Vec<PrNotificationItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrNotificationItem {
    pub kind: PrNotificationKind,
    pub pull_request_id: i64,
    /// Repository id, so a PR is identified by (repository, id) rather than id
    /// alone — two repositories can share a PR number.
    pub repository_id: String,
    pub title: String,
    pub repository_name: String,
    pub project_name: String,
    pub web_url: Option<String>,
    pub comment_author: Option<String>,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrNotificationKind {
    ReviewRequested,
    VoteReset,
    CommentReply,
}

impl PrNotificationKind {
    // Stable key used to match against NotificationRule.types (matches the
    // camelCase serde representation the frontend stores).
    pub(super) fn rule_key(self) -> &'static str {
        match self {
            PrNotificationKind::ReviewRequested => "reviewRequested",
            PrNotificationKind::VoteReset => "voteReset",
            PrNotificationKind::CommentReply => "commentReply",
        }
    }

    // Kind stored in the notification history table.
    fn history_kind(self) -> &'static str {
        match self {
            PrNotificationKind::ReviewRequested => "prReviewRequested",
            PrNotificationKind::VoteReset => "prVoteReset",
            PrNotificationKind::CommentReply => "prCommentReply",
        }
    }
}

impl WorkItemNotificationKind {
    pub(super) fn rule_key(self) -> &'static str {
        match self {
            WorkItemNotificationKind::Assigned => "assigned",
            WorkItemNotificationKind::StateChanged => "stateChanged",
        }
    }

    // Kind stored in the notification history table.
    fn history_kind(self) -> &'static str {
        match self {
            WorkItemNotificationKind::Assigned => "wiAssigned",
            WorkItemNotificationKind::StateChanged => "wiStateChanged",
        }
    }
}

/// Decides whether a collected notification survives the user's routing rules.
/// With no rules configured the legacy per-toggle behaviour is preserved (all
/// collected items pass). Otherwise an item must match at least one rule.
pub(super) fn notification_allowed(
    rules: &[NotificationRule],
    kind: &str,
    project: &str,
    repository: Option<&str>,
) -> bool {
    // A matching mute rule suppresses the notification outright, taking
    // precedence over allow rules (so one noisy repo/project can be silenced
    // without allow-listing everything else).
    if rules
        .iter()
        .filter(|rule| rule.mute)
        .any(|rule| notification_rule_matches(rule, kind, project, repository))
    {
        return false;
    }
    // Allow rules: with none configured everything (not muted) passes; otherwise
    // at least one allow rule must match.
    let mut allow_rules = rules.iter().filter(|rule| !rule.mute).peekable();
    allow_rules.peek().is_none()
        || allow_rules.any(|rule| notification_rule_matches(rule, kind, project, repository))
}

fn notification_rule_matches(
    rule: &NotificationRule,
    kind: &str,
    project: &str,
    repository: Option<&str>,
) -> bool {
    if !rule.types.is_empty() && !rule.types.iter().any(|t| t == kind) {
        return false;
    }
    if !rule.projects.is_empty() && !rule.projects.iter().any(|p| p == project) {
        return false;
    }
    if !rule.repositories.is_empty() {
        match repository {
            Some(repo) if rule.repositories.iter().any(|r| r == repo) => {}
            // A repository condition is pull-request specific: a work item (no
            // repository) can never satisfy it.
            _ => return false,
        }
    }
    true
}

/// Whether PR notification items should be collected this pass. Deliberately
/// independent of `desktop_notifications_enabled`: that setting only gates
/// whether the frontend shows a toast (see `desktopNotifications.ts`), while
/// the persisted notification history is recorded whenever at least one PR
/// notification type is enabled.
pub(super) fn should_collect_pr_notifications(settings: &AppSettings) -> bool {
    settings.notify_pr_review_requests
        || settings.notify_pr_vote_resets
        || settings.notify_pr_comment_replies
}

/// Whether work item notification items should be collected this pass. Same
/// independence from `desktop_notifications_enabled` as
/// `should_collect_pr_notifications`.
pub(super) fn should_collect_work_item_notifications(settings: &AppSettings) -> bool {
    settings.notify_work_item_assignments || settings.notify_work_item_state_changes
}

fn pr_review_item(pr: &CachedReviewPr, kind: PrNotificationKind) -> PrNotificationItem {
    PrNotificationItem {
        kind,
        pull_request_id: pr.pull_request_id,
        repository_id: pr.repository_id.clone(),
        title: pr.title.clone(),
        repository_name: pr.repository_name.clone(),
        project_name: pr.project_name.clone(),
        web_url: pr.web_url.clone(),
        comment_author: None,
        snippet: None,
    }
}

/// Diffs the review-PR cache snapshots taken before and after a sync to find new
/// review requests (a PR newly present) and vote resets (a reviewer's vote moving
/// from non-zero back to zero). Comment replies are handled separately because
/// they require fetching threads. On the very first snapshot (`previous` empty)
/// review requests are suppressed to avoid backfilling every existing PR.
pub fn pr_review_notification_items(
    previous: &[CachedReviewPr],
    current: &[CachedReviewPr],
    settings: &AppSettings,
) -> Vec<PrNotificationItem> {
    // Key by (repository, id): a PR number is only unique within a repository,
    // so keying by id alone would let two repositories' PRs collide.
    let prev_by_key: HashMap<(&str, i64), &CachedReviewPr> = previous
        .iter()
        .map(|pr| ((pr.repository_id.as_str(), pr.pull_request_id), pr))
        .collect();
    let first_snapshot = previous.is_empty();
    let mut items = Vec::new();
    for pr in current {
        match prev_by_key.get(&(pr.repository_id.as_str(), pr.pull_request_id)) {
            None => {
                if settings.notify_pr_review_requests && !first_snapshot {
                    items.push(pr_review_item(pr, PrNotificationKind::ReviewRequested));
                }
            }
            Some(prev) => {
                if settings.notify_pr_vote_resets && prev.my_vote != 0 && pr.my_vote == 0 {
                    items.push(pr_review_item(pr, PrNotificationKind::VoteReset));
                }
            }
        }
    }
    items
}

/// Maps still-snoozed PR keys (`{repo}:{pr_id}`) to their pull request ids so
/// notification items, which only carry the id, can be filtered.
/// Snooze keys for PRs are `repository_id:pull_request_id`; return them whole so
/// suppression is per (repository, id), not by id alone.
pub(super) fn still_snoozed_pr_keys(keys: &[String]) -> HashSet<String> {
    keys.iter().cloned().collect()
}

pub(super) fn still_snoozed_work_item_ids(keys: &[String]) -> HashSet<i64> {
    keys.iter().filter_map(|key| key.parse().ok()).collect()
}

pub(super) fn work_item_notification_items(
    previous: &[CachedWorkItem],
    current: &[CachedWorkItem],
    settings: &AppSettings,
) -> Vec<WorkItemNotificationItem> {
    if current.is_empty() {
        return Vec::new();
    }

    let previous_by_id: HashMap<i64, &CachedWorkItem> =
        previous.iter().map(|item| (item.id, item)).collect();
    let can_notify_assignments = settings.notify_work_item_assignments && !previous.is_empty();
    // The snapshots are capped at MY_WORK_ITEMS_LIMIT rows. When the previous
    // snapshot was full, an old item can re-enter the window without being
    // newly assigned; only treat items changed after the window edge as new.
    let previous_window_edge = if previous.len() >= MY_WORK_ITEMS_LIMIT {
        previous
            .iter()
            .filter_map(|item| item.changed_date.as_deref())
            .min()
    } else {
        None
    };

    current
        .iter()
        .filter_map(|item| {
            if let Some(previous_item) = previous_by_id.get(&item.id).copied() {
                if settings.notify_work_item_state_changes && previous_item.state != item.state {
                    return Some(work_item_notification_item(
                        item,
                        WorkItemNotificationKind::StateChanged,
                        previous_item.state.clone(),
                    ));
                }
                return None;
            }

            if can_notify_assignments {
                // <= because an item changed exactly at the window edge is
                // indistinguishable from one that re-entered; prefer missing
                // that rare notification over a false "Assigned" alert.
                let reentered_window = match (item.changed_date.as_deref(), previous_window_edge) {
                    (Some(changed), Some(edge)) => changed <= edge,
                    _ => false,
                };
                if !reentered_window {
                    return Some(work_item_notification_item(
                        item,
                        WorkItemNotificationKind::Assigned,
                        None,
                    ));
                }
            }
            None
        })
        .take(20)
        .collect()
}

fn work_item_notification_item(
    item: &CachedWorkItem,
    kind: WorkItemNotificationKind,
    previous_state: Option<String>,
) -> WorkItemNotificationItem {
    WorkItemNotificationItem {
        kind,
        id: item.id,
        title: item.title.clone(),
        project_name: item.project_name.clone(),
        state: item.state.clone(),
        previous_state,
        assigned_to: item.assigned_to.clone(),
        web_url: item.web_url.clone(),
    }
}

/// Builds notification-history rows for a batch of PR notification items,
/// mirroring the toast copy the frontend shows (`desktopNotifications.ts`) so
/// the persisted history reads the same as what the user saw.
pub(super) fn pr_notification_records(
    org_id: &str,
    org_name: &str,
    items: &[PrNotificationItem],
) -> Vec<NewNotification> {
    items
        .iter()
        .map(|item| pr_notification_record(org_id, org_name, item))
        .collect()
}

fn pr_notification_record(
    org_id: &str,
    org_name: &str,
    item: &PrNotificationItem,
) -> NewNotification {
    let title = match item.kind {
        PrNotificationKind::ReviewRequested => {
            format!("Review requested: !{}", item.pull_request_id)
        }
        PrNotificationKind::VoteReset => format!("Vote reset: !{}", item.pull_request_id),
        PrNotificationKind::CommentReply => format!("New reply: !{}", item.pull_request_id),
    };
    let body = if matches!(item.kind, PrNotificationKind::CommentReply) {
        let author = item.comment_author.as_deref().unwrap_or("Someone");
        let snippet_line = item
            .snippet
            .as_deref()
            .map(|snippet| format!("\n{snippet}"))
            .unwrap_or_default();
        format!(
            "{author} on \"{}\"{snippet_line}\n{} / {org_name}",
            item.title, item.repository_name
        )
    } else {
        format!("{}\n{} / {org_name}", item.title, item.repository_name)
    };
    NewNotification {
        organization_id: Some(org_id.to_string()),
        kind: item.kind.history_kind().to_string(),
        title,
        body: Some(body),
        payload: json!({
            "pullRequestId": item.pull_request_id,
            "repositoryId": item.repository_id,
            "repositoryName": item.repository_name,
            "projectName": item.project_name,
            "webUrl": item.web_url,
            "commentAuthor": item.comment_author,
            "snippet": item.snippet,
        }),
    }
}

/// Builds notification-history rows for a batch of work item notification
/// items, mirroring the toast copy in `desktopNotifications.ts`.
pub(super) fn work_item_notification_records(
    org_id: &str,
    org_name: &str,
    items: &[WorkItemNotificationItem],
) -> Vec<NewNotification> {
    items
        .iter()
        .map(|item| work_item_notification_record(org_id, org_name, item))
        .collect()
}

fn work_item_notification_record(
    org_id: &str,
    org_name: &str,
    item: &WorkItemNotificationItem,
) -> NewNotification {
    let title = match item.kind {
        WorkItemNotificationKind::Assigned => format!("Assigned: #{}", item.id),
        WorkItemNotificationKind::StateChanged => format!("State changed: #{}", item.id),
    };
    let body = match item.kind {
        WorkItemNotificationKind::StateChanged => {
            let from = item.previous_state.as_deref().unwrap_or("Unknown");
            let to = item.state.as_deref().unwrap_or("Unknown");
            format!("{}\n{from} -> {to} / {org_name}", item.title)
        }
        WorkItemNotificationKind::Assigned => {
            format!("{}\n{} / {org_name}", item.title, item.project_name)
        }
    };
    NewNotification {
        organization_id: Some(org_id.to_string()),
        kind: item.kind.history_kind().to_string(),
        title,
        body: Some(body),
        payload: json!({
            "workItemId": item.id,
            "projectName": item.project_name,
            "state": item.state,
            "previousState": item.previous_state,
            "webUrl": item.web_url,
        }),
    }
}

/// Builds the notification-history row for a sync-failure alert, mirroring the
/// toast copy in `desktopNotifications.ts::showSyncFailedNotificationEvent`.
pub(super) fn sync_failed_notification_record(event: &SyncFailedEvent) -> NewNotification {
    let retry_minutes = ((event.retry_in_secs as f64) / 60.0).round().max(1.0) as u64;
    let error_suffix = event
        .last_error
        .as_deref()
        .map(|error| format!("\n{error}"))
        .unwrap_or_default();
    NewNotification {
        organization_id: None,
        kind: "syncFailed".to_string(),
        title: "Sync is failing".to_string(),
        body: Some(format!(
            "DevDeck could not sync after {} attempts. Retrying in about {retry_minutes} min.{error_suffix}",
            event.consecutive_failures
        )),
        payload: json!({
            "consecutiveFailures": event.consecutive_failures,
            "retryInSecs": event.retry_in_secs,
            "lastError": event.last_error,
        }),
    }
}
