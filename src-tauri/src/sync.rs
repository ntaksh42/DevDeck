use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{interval_at, Instant};

use crate::auth::client_for_organization;
use crate::commits::sync_commits_for_org;
use crate::db::AppDatabase;
use crate::prs::sync_prs_for_org;
use crate::secrets::SecretStore;
use crate::work_items::sync_work_items_for_org;

pub struct SyncRunner {
    db: AppDatabase,
    secrets: SecretStore,
}

pub type SyncTrigger = oneshot::Sender<()>;

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
            self.sync_once().await;
            if let Err(e) = handle.emit("sync:updated", ()) {
                tracing::warn!(error = ?e, "failed to emit sync:updated");
            }
            for waiter in waiters {
                let _ = waiter.send(());
            }
        }
    }

    async fn sync_once(&self) {
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
            if let Err(e) = sync_work_items_for_org(&self.db, &client, &org).await {
                tracing::error!(org = %org.name, error = ?e, "sync: WI sync failed");
            }
            if let Err(e) = sync_commits_for_org(&self.db, &client, &org).await {
                tracing::error!(org = %org.name, error = ?e, "sync: commit sync failed");
            }
        }
    }
}
