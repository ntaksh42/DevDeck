use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{interval_at, Instant};

use crate::auth::client_for_organization;
use crate::commits::sync_commits_for_org;
use crate::db::{AppDatabase, AppSettings, CachedWorkItem};
use crate::prs::sync_prs_for_org;
use crate::secrets::SecretStore;
use crate::work_items::sync_work_items_for_org;

pub struct SyncRunner {
    db: AppDatabase,
    secrets: SecretStore,
}

pub type SyncTrigger = oneshot::Sender<()>;

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

impl SyncRunner {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    // bounded(1) keeps manual sync requests ordered without letting the queue grow.
    pub fn channel() -> (mpsc::Sender<SyncTrigger>, mpsc::Receiver<SyncTrigger>) {
        mpsc::channel(1)
    }

    pub async fn run(self, handle: AppHandle, mut trigger_rx: mpsc::Receiver<SyncTrigger>) {
        let mut interval = interval_at(Instant::now(), Duration::from_secs(300));
        loop {
            let mut waiters = Vec::new();
            tokio::select! {
                _ = interval.tick() => {},
                Some(waiter) = trigger_rx.recv() => {
                    waiters.push(waiter);
                    while let Ok(waiter) = trigger_rx.try_recv() {
                        waiters.push(waiter);
                    }
                }
            }
            self.sync_once(&handle).await;
            if let Err(e) = handle.emit("sync:updated", ()) {
                tracing::warn!(error = ?e, "failed to emit sync:updated");
            }
            for waiter in waiters {
                let _ = waiter.send(());
            }
        }
    }

    async fn sync_once(&self, handle: &AppHandle) {
        let settings = match self.db.get_app_settings() {
            Ok(settings) => settings,
            Err(e) => {
                tracing::warn!(error = ?e, "sync: failed to load notification settings");
                AppSettings::default()
            }
        };
        let should_collect_work_item_notifications = settings.desktop_notifications_enabled
            && (settings.notify_work_item_assignments || settings.notify_work_item_state_changes);

        let orgs = match self.db.list_organizations() {
            Ok(orgs) => orgs,
            Err(e) => {
                tracing::error!(error = ?e, "sync: failed to load organizations");
                return;
            }
        };
        for org in orgs {
            let client = match client_for_organization(&org, &self.secrets) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(org = %org.name, error = ?e, "sync: failed to create client");
                    continue;
                }
            };
            if let Err(e) = sync_prs_for_org(&self.db, &client, &org).await {
                tracing::error!(org = %org.name, error = ?e, "sync: PR sync failed");
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

            if let Err(e) = sync_work_items_for_org(&self.db, &client, &org).await {
                tracing::error!(org = %org.name, error = ?e, "sync: WI sync failed");
            } else if should_collect_work_item_notifications {
                match self.db.list_my_work_items(&org.id) {
                    Ok(current_my_work_items) => {
                        let items = work_item_notification_items(
                            &previous_my_work_items,
                            &current_my_work_items,
                            &settings,
                        );
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
                    Err(e) => {
                        tracing::warn!(org = %org.name, error = ?e, "sync: failed to snapshot work items after sync");
                    }
                }
            }
            if let Err(e) = sync_commits_for_org(&self.db, &client, &org).await {
                tracing::error!(org = %org.name, error = ?e, "sync: commit sync failed");
            }
        }
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
                return Some(work_item_notification_item(
                    item,
                    WorkItemNotificationKind::Assigned,
                    None,
                ));
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
    fn work_item_notification_items_skips_assignment_on_first_snapshot() {
        let settings = AppSettings {
            desktop_notifications_enabled: true,
            ..AppSettings::default()
        };
        let current = vec![work_item(1, "New item", Some("To Do"))];

        assert!(work_item_notification_items(&[], &current, &settings).is_empty());
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
            changed_date: Some("2026-06-03T00:00:00Z".to_string()),
            web_url: Some(format!(
                "https://dev.azure.com/org/project/_workitems/edit/{id}"
            )),
        }
    }
}
