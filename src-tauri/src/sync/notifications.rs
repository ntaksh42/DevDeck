use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::db::{
    AppSettings, CachedReviewPr, CachedWorkItem, NotificationRule, MY_WORK_ITEMS_LIMIT,
};

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
}

impl WorkItemNotificationKind {
    pub(super) fn rule_key(self) -> &'static str {
        match self {
            WorkItemNotificationKind::Assigned => "assigned",
            WorkItemNotificationKind::StateChanged => "stateChanged",
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
