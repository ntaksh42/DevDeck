use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use crate::auth::client_for_organization;
use crate::commits::sync_commits_for_org;
use crate::db::{AppDatabase, AppSettings, CachedReviewPr, CachedWorkItem, MY_WORK_ITEMS_LIMIT};
use crate::prs::sync_prs_for_org;
use crate::secrets::SecretStore;
use crate::snooze::SnoozeService;
use crate::work_items::sync_work_items_for_org;

pub struct SyncRunner {
    db: AppDatabase,
    secrets: SecretStore,
}

pub struct SyncTrigger {
    pub scope: SyncScope,
    pub done: oneshot::Sender<()>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncScope {
    All,
    Hot,
    MyReviews,
    MyWorkItems,
    Commits,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncUpdatedEvent {
    pub org_id: String,
    pub scopes: Vec<SyncScope>,
}

/// Emitted when automatic sync has failed `consecutive_failures` passes in a
/// row, so the frontend can surface an explicit "sync is failing" notification
/// instead of leaving the user to infer it from a stale last-synced time.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailedEvent {
    pub consecutive_failures: u32,
    pub retry_in_secs: u64,
    pub last_error: Option<String>,
}

/// Base automatic sync interval; also the backoff floor.
const BASE_INTERVAL_SECS: u64 = 300;
/// Backoff ceiling so a long outage still retries roughly every 30 minutes.
const MAX_BACKOFF_SECS: u64 = 1800;
/// Notify the user once this many consecutive automatic passes have failed.
const FAILURE_NOTIFY_THRESHOLD: u32 = 3;

/// Reports whether an automatic sync pass made any progress. A pass counts as
/// failed only when every org sync attempt errored and none succeeded, so a
/// single flaky org does not trip the backoff/notification path.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SyncPassOutcome {
    succeeded: bool,
    failed: bool,
}

impl SyncPassOutcome {
    fn record_success(&mut self) {
        self.succeeded = true;
    }

    fn record_failure(&mut self) {
        self.failed = true;
    }

    /// A pass is a failure only when it errored without any success. A pass
    /// that attempted nothing (no orgs / scope skipped) is not a failure.
    fn is_failure(&self) -> bool {
        self.failed && !self.succeeded
    }
}

/// Exponential backoff: 5min, 10min, 20min, … capped at `MAX_BACKOFF_SECS`.
fn backoff_secs(consecutive_failures: u32) -> u64 {
    if consecutive_failures == 0 {
        return BASE_INTERVAL_SECS;
    }
    let shift = consecutive_failures.saturating_sub(1).min(8);
    BASE_INTERVAL_SECS
        .saturating_mul(1u64 << shift)
        .min(MAX_BACKOFF_SECS)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkItemNotificationEvent {
    organization_id: String,
    organization_name: String,
    items: Vec<WorkItemNotificationItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkItemNotificationItem {
    kind: WorkItemNotificationKind,
    id: i64,
    title: String,
    project_name: String,
    state: Option<String>,
    previous_state: Option<String>,
    assigned_to: Option<String>,
    web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum WorkItemNotificationKind {
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

fn pr_review_item(pr: &CachedReviewPr, kind: PrNotificationKind) -> PrNotificationItem {
    PrNotificationItem {
        kind,
        pull_request_id: pr.pull_request_id,
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
    let prev_by_id: HashMap<i64, &CachedReviewPr> =
        previous.iter().map(|pr| (pr.pull_request_id, pr)).collect();
    let first_snapshot = previous.is_empty();
    let mut items = Vec::new();
    for pr in current {
        match prev_by_id.get(&pr.pull_request_id) {
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

impl SyncRunner {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    // bounded(1) keeps manual sync requests ordered without letting the queue grow.
    pub fn channel() -> (mpsc::Sender<SyncTrigger>, mpsc::Receiver<SyncTrigger>) {
        mpsc::channel(1)
    }

    pub async fn run(self, handle: AppHandle, mut trigger_rx: mpsc::Receiver<SyncTrigger>) {
        let mut interval = interval_at(Instant::now(), Duration::from_secs(BASE_INTERVAL_SECS));
        // A sync pass can outlast the interval; don't burst-fire missed ticks.
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        // Consecutive automatic-pass failures. Manual triggers run immediately
        // regardless, but their outcome still feeds the backoff so the timer
        // recovers as soon as connectivity returns.
        let mut consecutive_failures: u32 = 0;
        // Suppress repeat notifications within a single failure streak.
        let mut failure_notified = false;
        loop {
            let mut waiters = Vec::new();
            tokio::select! {
                _ = interval.tick() => {},
                Some(trigger) = trigger_rx.recv() => {
                    waiters.push(trigger);
                    while let Ok(trigger) = trigger_rx.try_recv() {
                        waiters.push(trigger);
                    }
                }
            }
            let scope = combined_scope(&waiters);
            let outcome = self.sync_once(&handle, scope).await;
            if outcome.is_failure() {
                consecutive_failures = consecutive_failures.saturating_add(1);
                let retry_in = backoff_secs(consecutive_failures);
                // Reset the periodic timer so the next automatic tick honors the
                // backed-off delay instead of firing again in BASE_INTERVAL.
                interval = interval_at(
                    Instant::now() + Duration::from_secs(retry_in),
                    Duration::from_secs(retry_in),
                );
                interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
                if consecutive_failures >= FAILURE_NOTIFY_THRESHOLD && !failure_notified {
                    failure_notified = true;
                    let event = SyncFailedEvent {
                        consecutive_failures,
                        retry_in_secs: retry_in,
                        last_error: self.latest_sync_error(),
                    };
                    if let Err(e) = handle.emit("notifications:sync-failed", event) {
                        tracing::warn!(error = ?e, "sync: failed to emit sync-failed event");
                    }
                }
            } else if outcome.succeeded {
                // Recovered: drop back to the base cadence and re-arm notifications.
                if consecutive_failures > 0 {
                    consecutive_failures = 0;
                    failure_notified = false;
                    interval = interval_at(
                        Instant::now() + Duration::from_secs(BASE_INTERVAL_SECS),
                        Duration::from_secs(BASE_INTERVAL_SECS),
                    );
                    interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
                }
            }
            if matches!(scope, SyncScope::All) {
                if let Err(e) = handle.emit(
                    "sync:updated",
                    SyncUpdatedEvent {
                        org_id: "*".to_string(),
                        scopes: vec![SyncScope::All],
                    },
                ) {
                    tracing::warn!(error = ?e, "failed to emit sync:updated");
                }
            }
            for trigger in waiters {
                let _ = trigger.done.send(());
            }
        }
    }

    /// Reads the most recent persisted sync error across scopes so the failure
    /// notification can carry a human-readable reason.
    fn latest_sync_error(&self) -> Option<String> {
        self.db
            .list_sync_states()
            .ok()?
            .into_iter()
            .filter(|state| state.error_count > 0)
            .filter_map(|state| state.last_error)
            .next()
    }

    async fn sync_once(&self, handle: &AppHandle, scope: SyncScope) -> SyncPassOutcome {
        let mut outcome = SyncPassOutcome::default();
        let settings = match self.db.get_app_settings() {
            Ok(settings) => settings,
            Err(e) => {
                tracing::warn!(error = ?e, "sync: failed to load notification settings");
                AppSettings::default()
            }
        };
        let should_collect_work_item_notifications = settings.desktop_notifications_enabled
            && (settings.notify_work_item_assignments || settings.notify_work_item_state_changes);
        let should_collect_pr_notifications = settings.desktop_notifications_enabled
            && (settings.notify_pr_review_requests
                || settings.notify_pr_vote_resets
                || settings.notify_pr_comment_replies);

        let orgs = match self.db.list_organizations() {
            Ok(orgs) => orgs,
            Err(e) => {
                tracing::error!(error = ?e, "sync: failed to load organizations");
                outcome.record_failure();
                return outcome;
            }
        };
        let snooze = SnoozeService::new(self.db.clone());
        let now = chrono::Utc::now().to_rfc3339();
        for org in orgs {
            let client = match client_for_organization(&org, &self.secrets) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(org = %org.name, error = ?e, "sync: failed to create client");
                    outcome.record_failure();
                    continue;
                }
            };
            if matches!(
                scope,
                SyncScope::All | SyncScope::Hot | SyncScope::MyReviews
            ) {
                let previous_reviews = if should_collect_pr_notifications {
                    self.db
                        .list_review_pull_requests(&org.id)
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };
                if let Err(e) = sync_prs_for_org(&self.db, &client, &org).await {
                    tracing::error!(org = %org.name, error = ?e, "sync: PR sync failed");
                    outcome.record_failure();
                } else {
                    outcome.record_success();
                    emit_sync_updated(handle, &org.id, vec![SyncScope::MyReviews]);
                    let current_reviews = self
                        .db
                        .list_review_pull_requests(&org.id)
                        .unwrap_or_default();
                    // Collect comment notifications first: the call advances the
                    // comment-seen markers that snooze revival then reads.
                    let mut items = Vec::new();
                    if should_collect_pr_notifications {
                        items = pr_review_notification_items(
                            &previous_reviews,
                            &current_reviews,
                            &settings,
                        );
                        if settings.notify_pr_comment_replies {
                            items.extend(
                                crate::prs::collect_pr_comment_notifications(
                                    &self.db, &client, &org,
                                )
                                .await,
                            );
                        }
                    }
                    // Revive snoozed PRs past their deadline or with new activity,
                    // and learn which PRs remain snoozed so their notifications
                    // can be suppressed.
                    let snoozed_pr_ids = match snooze.reconcile_pull_requests(&org.id, &now) {
                        Ok(reconcile) => still_snoozed_pr_ids(&reconcile.still_snoozed),
                        Err(e) => {
                            tracing::warn!(org = %org.name, error = ?e, "sync: PR snooze reconcile failed");
                            HashSet::new()
                        }
                    };
                    if should_collect_pr_notifications {
                        items.retain(|item| !snoozed_pr_ids.contains(&item.pull_request_id));
                        if !items.is_empty() {
                            let event = PullRequestNotificationEvent {
                                organization_id: org.id.clone(),
                                organization_name: org.name.clone(),
                                items,
                            };
                            if let Err(e) = handle.emit("notifications:pull-requests", event) {
                                tracing::warn!(org = %org.name, error = ?e, "sync: failed to emit PR notification event");
                            }
                        }
                    }
                }
            }
            let previous_my_work_items = if should_collect_work_item_notifications {
                match self.db.list_my_work_items(&org.id) {
                    Ok(items) => items,
                    Err(e) => {
                        tracing::warn!(org = %org.name, error = ?e, "sync: failed to snapshot work items before sync");
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };

            if matches!(
                scope,
                SyncScope::All | SyncScope::Hot | SyncScope::MyWorkItems
            ) {
                if let Err(e) = sync_work_items_for_org(&self.db, &client, &org).await {
                    tracing::error!(org = %org.name, error = ?e, "sync: WI sync failed");
                    outcome.record_failure();
                } else {
                    outcome.record_success();
                    emit_sync_updated(handle, &org.id, vec![SyncScope::MyWorkItems]);
                    match self.db.list_my_work_items(&org.id) {
                        Ok(current_my_work_items) => {
                            // Revive snoozed work items past their deadline or with a
                            // newer ChangedDate; remember which stay snoozed.
                            let snoozed_ids = match snooze.reconcile_work_items(
                                &org.id,
                                &current_my_work_items,
                                &now,
                            ) {
                                Ok(reconcile) => {
                                    still_snoozed_work_item_ids(&reconcile.still_snoozed)
                                }
                                Err(e) => {
                                    tracing::warn!(org = %org.name, error = ?e, "sync: WI snooze reconcile failed");
                                    HashSet::new()
                                }
                            };
                            if should_collect_work_item_notifications {
                                let mut items = work_item_notification_items(
                                    &previous_my_work_items,
                                    &current_my_work_items,
                                    &settings,
                                );
                                items.retain(|item| !snoozed_ids.contains(&item.id));
                                if !items.is_empty() {
                                    let event = WorkItemNotificationEvent {
                                        organization_id: org.id.clone(),
                                        organization_name: org.name.clone(),
                                        items,
                                    };
                                    if let Err(e) = handle.emit("notifications:work-items", event) {
                                        tracing::warn!(org = %org.name, error = ?e, "sync: failed to emit work item notification event");
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(org = %org.name, error = ?e, "sync: failed to snapshot work items after sync");
                        }
                    }
                }
            }
            if matches!(scope, SyncScope::All | SyncScope::Commits) {
                if let Err(e) = sync_commits_for_org(&self.db, &client, &org).await {
                    tracing::error!(org = %org.name, error = ?e, "sync: commit sync failed");
                    outcome.record_failure();
                } else {
                    outcome.record_success();
                    emit_sync_updated(handle, &org.id, vec![SyncScope::Commits]);
                }
            }
        }
        outcome
    }
}

fn combined_scope(triggers: &[SyncTrigger]) -> SyncScope {
    if triggers.is_empty()
        || triggers
            .iter()
            .any(|trigger| trigger.scope == SyncScope::All)
    {
        return SyncScope::All;
    }
    let first = triggers[0].scope;
    if triggers.iter().all(|trigger| trigger.scope == first) {
        return first;
    }
    if triggers.len() > 1 {
        return SyncScope::All;
    }
    first
}

/// Maps still-snoozed PR keys (`{repo}:{pr_id}`) to their pull request ids so
/// notification items, which only carry the id, can be filtered.
fn still_snoozed_pr_ids(keys: &[String]) -> HashSet<i64> {
    keys.iter()
        .filter_map(|key| key.rsplit_once(':').and_then(|(_, id)| id.parse().ok()))
        .collect()
}

fn still_snoozed_work_item_ids(keys: &[String]) -> HashSet<i64> {
    keys.iter().filter_map(|key| key.parse().ok()).collect()
}

fn emit_sync_updated(handle: &AppHandle, org_id: &str, scopes: Vec<SyncScope>) {
    if let Err(e) = handle.emit(
        "sync:updated",
        SyncUpdatedEvent {
            org_id: org_id.to_string(),
            scopes,
        },
    ) {
        tracing::warn!(error = ?e, "failed to emit sync:updated");
    }
}

fn work_item_notification_items(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_exponentially_and_caps() {
        assert_eq!(backoff_secs(0), BASE_INTERVAL_SECS);
        assert_eq!(backoff_secs(1), 300);
        assert_eq!(backoff_secs(2), 600);
        assert_eq!(backoff_secs(3), 1200);
        // 4th failure would be 2400s, clamped to the 1800s ceiling.
        assert_eq!(backoff_secs(4), MAX_BACKOFF_SECS);
        assert_eq!(backoff_secs(50), MAX_BACKOFF_SECS);
    }

    #[test]
    fn pass_is_failure_only_when_no_success() {
        let mut all_failed = SyncPassOutcome::default();
        all_failed.record_failure();
        assert!(all_failed.is_failure());

        let mut mixed = SyncPassOutcome::default();
        mixed.record_failure();
        mixed.record_success();
        assert!(
            !mixed.is_failure(),
            "a partial success should not trip backoff"
        );

        // A pass that attempted nothing is not a failure.
        assert!(!SyncPassOutcome::default().is_failure());
    }

    #[test]
    fn work_item_notification_items_skips_assignment_on_first_snapshot() {
        let settings = AppSettings {
            desktop_notifications_enabled: true,
            ..AppSettings::default()
        };
        let current = vec![work_item(1, "New item", Some("To Do"))];

        assert!(work_item_notification_items(&[], &current, &settings).is_empty());
    }

    fn review_pr(pr_id: i64, my_vote: i32) -> CachedReviewPr {
        CachedReviewPr {
            org_id: "o".into(),
            project_id: "p".into(),
            project_name: "Proj".into(),
            repository_id: "r".into(),
            repository_name: "Repo".into(),
            pull_request_id: pr_id,
            title: format!("PR {pr_id}"),
            created_by: None,
            creation_date: "2026-06-01T00:00:00Z".into(),
            target_ref_name: "main".into(),
            web_url: Some("https://x/pr".into()),
            my_vote,
            my_vote_label: String::new(),
            my_is_required: true,
            is_draft: false,
            merge_status: None,
        }
    }

    fn pr_settings(review: bool, reset: bool) -> AppSettings {
        AppSettings {
            desktop_notifications_enabled: true,
            notify_pr_review_requests: review,
            notify_pr_vote_resets: reset,
            ..AppSettings::default()
        }
    }

    #[test]
    fn pr_review_items_flags_new_review_and_vote_reset() {
        let prev = vec![review_pr(1, 10), review_pr(2, 0)];
        let curr = vec![review_pr(1, 0), review_pr(2, 0), review_pr(3, 0)];
        let items = pr_review_notification_items(&prev, &curr, &pr_settings(true, true));
        assert!(items
            .iter()
            .any(|i| i.pull_request_id == 1 && i.kind == PrNotificationKind::VoteReset));
        assert!(items
            .iter()
            .any(|i| i.pull_request_id == 3 && i.kind == PrNotificationKind::ReviewRequested));
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn pr_review_items_suppressed_on_first_snapshot() {
        let curr = vec![review_pr(1, 0), review_pr(2, 0)];
        let items = pr_review_notification_items(&[], &curr, &pr_settings(true, true));
        assert!(items.is_empty());
    }

    #[test]
    fn pr_review_items_respect_toggles() {
        let prev = vec![review_pr(1, 10)];
        let curr = vec![review_pr(1, 0), review_pr(2, 0)];
        let items = pr_review_notification_items(&prev, &curr, &pr_settings(false, false));
        assert!(items.is_empty());
    }

    #[test]
    fn work_item_notification_items_reports_assignment_and_state_changes() {
        let settings = AppSettings {
            desktop_notifications_enabled: true,
            ..AppSettings::default()
        };
        let previous = vec![
            work_item(1, "Existing", Some("To Do")),
            work_item(2, "Unchanged", Some("Doing")),
        ];
        let current = vec![
            work_item(1, "Existing", Some("Done")),
            work_item(2, "Unchanged", Some("Doing")),
            work_item(3, "Assigned", Some("To Do")),
        ];

        let notifications = work_item_notification_items(&previous, &current, &settings);

        assert_eq!(notifications.len(), 2);
        assert_eq!(
            notifications[0].kind,
            WorkItemNotificationKind::StateChanged
        );
        assert_eq!(notifications[0].previous_state.as_deref(), Some("To Do"));
        assert_eq!(notifications[0].state.as_deref(), Some("Done"));
        assert_eq!(notifications[1].kind, WorkItemNotificationKind::Assigned);
        assert_eq!(notifications[1].id, 3);
    }

    #[test]
    fn work_item_notification_items_skips_items_reentering_full_window() {
        let settings = AppSettings {
            desktop_notifications_enabled: true,
            ..AppSettings::default()
        };
        // Previous snapshot is at the cap; its oldest change is 2026-06-02.
        let previous: Vec<CachedWorkItem> = (1..=MY_WORK_ITEMS_LIMIT as i64)
            .map(|id| work_item_changed(id, "Existing", Some("To Do"), "2026-06-02T00:00:00Z"))
            .collect();
        let mut current = previous.clone();
        current.pop();
        // Older than the window edge: re-entered, not newly assigned.
        current.push(work_item_changed(
            9001,
            "Re-entered",
            Some("To Do"),
            "2026-06-01T00:00:00Z",
        ));
        // Exactly at the window edge: also treated as re-entered.
        current.push(work_item_changed(
            9003,
            "At edge",
            Some("To Do"),
            "2026-06-02T00:00:00Z",
        ));
        // Newer than the window edge: genuinely new assignment.
        current.push(work_item_changed(
            9002,
            "Fresh",
            Some("To Do"),
            "2026-06-03T00:00:00Z",
        ));

        let notifications = work_item_notification_items(&previous, &current, &settings);

        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].id, 9002);
    }

    fn work_item_changed(
        id: i64,
        title: &str,
        state: Option<&str>,
        changed_date: &str,
    ) -> CachedWorkItem {
        CachedWorkItem {
            changed_date: Some(changed_date.to_string()),
            ..work_item(id, title, state)
        }
    }

    fn work_item(id: i64, title: &str, state: Option<&str>) -> CachedWorkItem {
        CachedWorkItem {
            org_id: "org".to_string(),
            project_id: "project".to_string(),
            project_name: "Project".to_string(),
            id,
            title: title.to_string(),
            work_item_type: Some("Issue".to_string()),
            state: state.map(str::to_string),
            assigned_to: Some("Test User".to_string()),
            assigned_to_unique_name: None,
            changed_date: Some("2026-06-03T00:00:00Z".to_string()),
            web_url: Some(format!(
                "https://dev.azure.com/org/project/_workitems/edit/{id}"
            )),
        }
    }
}
