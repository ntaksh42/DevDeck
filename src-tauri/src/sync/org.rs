use std::collections::HashSet;
use std::sync::Arc;

use azdo_client::TeamProject;
use tauri::{AppHandle, Emitter};

use crate::auth::client_for_organization;
use crate::commits::sync_commits_for_org;
use crate::db::{AppSettings, NewNotification, Organization};
use crate::prs::sync_prs_for_org;
use crate::secrets::SecretStore;
use crate::snooze::SnoozeService;
use crate::work_items::sync_work_items_for_org;

use super::notifications::{
    notification_allowed, pr_notification_records, pr_review_notification_items,
    should_collect_pr_notifications, should_collect_work_item_notifications, still_snoozed_pr_keys,
    still_snoozed_work_item_ids, work_item_notification_items, work_item_notification_records,
    PullRequestNotificationEvent, WorkItemNotificationEvent,
};
use super::*;

/// Syncs one organization. Fetches the project list once (shared across the
/// three sync kinds) and runs the PR, work-item, and commit passes concurrently.
#[allow(clippy::too_many_arguments)]
pub(super) async fn sync_org(
    db: AppDatabase,
    secrets: SecretStore,
    handle: AppHandle,
    org: Organization,
    scope: SyncScope,
    settings: Arc<AppSettings>,
    budget: SyncBudget,
    now: String,
) -> SyncPassOutcome {
    let mut outcome = SyncPassOutcome::default();
    let client = match client_for_organization(&org, &secrets) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(org = %org.name, error = ?e, "sync: failed to create client");
            outcome.record_failure();
            return outcome;
        }
    };
    // One project listing feeds PRs, work items, and commits, instead of each
    // sync kind issuing its own identical request.
    let projects = match client.list_projects().await {
        Ok(projects) => projects,
        Err(e) => {
            tracing::error!(org = %org.name, error = ?e, "sync: failed to list projects");
            outcome.record_failure();
            return outcome;
        }
    };
    let snooze = SnoozeService::new(db.clone());

    let (pr_outcome, wi_outcome, commit_outcome) = tokio::join!(
        sync_org_prs(
            &db, &client, &handle, &org, scope, &settings, &snooze, &budget, &now, &projects,
        ),
        sync_org_work_items(
            &db, &client, &handle, &org, scope, &settings, &snooze, &budget, &now, &projects,
        ),
        sync_org_commits(&db, &client, &handle, &org, scope, &budget, &projects),
    );
    outcome.merge(pr_outcome);
    outcome.merge(wi_outcome);
    outcome.merge(commit_outcome);
    outcome
}

#[allow(clippy::too_many_arguments)]
async fn sync_org_prs(
    db: &AppDatabase,
    client: &azdo_client::AdoClient,
    handle: &AppHandle,
    org: &Organization,
    scope: SyncScope,
    settings: &AppSettings,
    snooze: &SnoozeService,
    budget: &SyncBudget,
    now: &str,
    projects: &[TeamProject],
) -> SyncPassOutcome {
    let mut outcome = SyncPassOutcome::default();
    if !matches!(
        scope,
        SyncScope::All | SyncScope::Hot | SyncScope::MyReviews
    ) {
        return outcome;
    }
    let should_collect = should_collect_pr_notifications(settings);
    let previous_reviews = if should_collect {
        db.list_review_pull_requests(&org.id).unwrap_or_default()
    } else {
        Vec::new()
    };
    if let Err(e) = sync_prs_for_org(db, client, org, projects, budget).await {
        tracing::error!(org = %org.name, error = ?e, "sync: PR sync failed");
        outcome.record_failure();
        return outcome;
    }
    outcome.record_success();
    emit_sync_updated(handle, &org.id, vec![SyncScope::MyReviews]);
    let current_reviews = db.list_review_pull_requests(&org.id).unwrap_or_default();
    // Collect comment notifications first: the call advances the comment-seen
    // markers that snooze revival then reads.
    let mut items = Vec::new();
    if should_collect {
        items = pr_review_notification_items(&previous_reviews, &current_reviews, settings);
        if settings.notify_pr_comment_replies {
            items.extend(crate::prs::collect_pr_comment_notifications(db, client, org).await);
        }
    }
    // Revive snoozed PRs past their deadline or with new activity, and learn
    // which PRs remain snoozed so their notifications can be suppressed.
    let snoozed_pr_keys = match snooze.reconcile_pull_requests(&org.id, now) {
        Ok(reconcile) => still_snoozed_pr_keys(&reconcile.still_snoozed),
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "sync: PR snooze reconcile failed");
            HashSet::new()
        }
    };
    if should_collect {
        items.retain(|item| {
            !snoozed_pr_keys.contains(&format!("{}:{}", item.repository_id, item.pull_request_id))
        });
        items.retain(|item| {
            notification_allowed(
                &settings.notification_rules,
                item.kind.rule_key(),
                &item.project_name,
                Some(&item.repository_name),
            )
        });
        if !items.is_empty() {
            record_notifications(
                db,
                handle,
                &org.name,
                pr_notification_records(&org.id, &org.name, &items),
            );
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
    outcome
}

#[allow(clippy::too_many_arguments)]
async fn sync_org_work_items(
    db: &AppDatabase,
    client: &azdo_client::AdoClient,
    handle: &AppHandle,
    org: &Organization,
    scope: SyncScope,
    settings: &AppSettings,
    snooze: &SnoozeService,
    budget: &SyncBudget,
    now: &str,
    projects: &[TeamProject],
) -> SyncPassOutcome {
    let mut outcome = SyncPassOutcome::default();
    if !matches!(
        scope,
        SyncScope::All | SyncScope::Hot | SyncScope::MyWorkItems
    ) {
        return outcome;
    }
    let should_collect = should_collect_work_item_notifications(settings);
    let previous_my_work_items = if should_collect {
        match db.list_my_work_items(&org.id) {
            Ok(items) => items,
            Err(e) => {
                tracing::warn!(org = %org.name, error = ?e, "sync: failed to snapshot work items before sync");
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    if let Err(e) = sync_work_items_for_org(db, client, org, projects, budget).await {
        tracing::error!(org = %org.name, error = ?e, "sync: WI sync failed");
        outcome.record_failure();
        return outcome;
    }
    outcome.record_success();
    emit_sync_updated(handle, &org.id, vec![SyncScope::MyWorkItems]);
    match db.list_my_work_items(&org.id) {
        Ok(current_my_work_items) => {
            // Revive snoozed work items past their deadline or with a newer
            // ChangedDate; remember which stay snoozed.
            let snoozed_ids = match snooze.reconcile_work_items(
                &org.id,
                &current_my_work_items,
                now,
            ) {
                Ok(reconcile) => still_snoozed_work_item_ids(&reconcile.still_snoozed),
                Err(e) => {
                    tracing::warn!(org = %org.name, error = ?e, "sync: WI snooze reconcile failed");
                    HashSet::new()
                }
            };
            if should_collect {
                let mut items = work_item_notification_items(
                    &previous_my_work_items,
                    &current_my_work_items,
                    settings,
                );
                items.retain(|item| !snoozed_ids.contains(&item.id));
                items.retain(|item| {
                    notification_allowed(
                        &settings.notification_rules,
                        item.kind.rule_key(),
                        &item.project_name,
                        None,
                    )
                });
                if !items.is_empty() {
                    record_notifications(
                        db,
                        handle,
                        &org.name,
                        work_item_notification_records(&org.id, &org.name, &items),
                    );
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
    outcome
}

async fn sync_org_commits(
    db: &AppDatabase,
    client: &azdo_client::AdoClient,
    handle: &AppHandle,
    org: &Organization,
    scope: SyncScope,
    budget: &SyncBudget,
    projects: &[TeamProject],
) -> SyncPassOutcome {
    let mut outcome = SyncPassOutcome::default();
    if !matches!(scope, SyncScope::All | SyncScope::Commits) {
        return outcome;
    }
    if let Err(e) = sync_commits_for_org(db, client, org, projects, budget).await {
        tracing::error!(org = %org.name, error = ?e, "sync: commit sync failed");
        outcome.record_failure();
    } else {
        outcome.record_success();
        emit_sync_updated(handle, &org.id, vec![SyncScope::Commits]);
    }
    outcome
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

/// Persists notification-history rows and, on success, notifies the frontend
/// inbox. A DB failure only logs a warning: notification history is
/// best-effort and must never block the sync pass.
fn record_notifications(
    db: &AppDatabase,
    handle: &AppHandle,
    org_name: &str,
    records: Vec<NewNotification>,
) {
    if let Err(e) = db.insert_notifications(&records) {
        tracing::warn!(org = %org_name, error = ?e, "sync: failed to record notification history");
        return;
    }
    if let Err(e) = handle.emit("notifications:inbox-updated", serde_json::json!({})) {
        tracing::warn!(org = %org_name, error = ?e, "sync: failed to emit notification inbox update");
    }
}
