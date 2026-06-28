use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Semaphore};
use tokio::task::JoinSet;
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use crate::db::AppSettings;

use super::org::sync_org;
use super::*;

impl SyncRunner {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self {
            db,
            secrets,
            concurrency: Arc::new(Semaphore::new(GLOBAL_SYNC_CONCURRENCY)),
        }
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
        let settings = Arc::new(match self.db.get_app_settings() {
            Ok(settings) => settings,
            Err(e) => {
                tracing::warn!(error = ?e, "sync: failed to load notification settings");
                AppSettings::default()
            }
        });

        // The app points at one active connection at a time, so sync only that
        // one. GitHub connections are served on-demand (no local cache), so they
        // are skipped entirely — only Azure DevOps populates the sync cache.
        let active = match self.db.resolve_organization(None) {
            Ok(org) => org,
            // No connection configured yet: nothing to sync, not a failure.
            Err(_) => return SyncPassOutcome::default(),
        };
        if active.provider_kind != "azdo" {
            return SyncPassOutcome::default();
        }
        let orgs = vec![active];
        let now = chrono::Utc::now().to_rfc3339();

        // The active org's PR/work-item/commit passes run concurrently. The
        // shared budget caps total in-flight requests.
        let mut tasks: JoinSet<SyncPassOutcome> = JoinSet::new();
        for org in orgs {
            tasks.spawn(sync_org(
                self.db.clone(),
                self.secrets.clone(),
                handle.clone(),
                org,
                scope,
                settings.clone(),
                self.concurrency.clone(),
                now.clone(),
            ));
        }

        let mut outcome = SyncPassOutcome::default();
        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok(org_outcome) => outcome.merge(org_outcome),
                Err(e) => {
                    tracing::error!(error = %e, "sync: organization sync task failed");
                    outcome.record_failure();
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
