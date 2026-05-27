use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
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

impl SyncRunner {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    // bounded(1) acts as debounce — extra clicks while sync runs are dropped
    pub fn channel() -> (mpsc::Sender<()>, mpsc::Receiver<()>) {
        mpsc::channel(1)
    }

    pub async fn run(self, handle: AppHandle, mut trigger_rx: mpsc::Receiver<()>) {
        let mut interval = interval_at(Instant::now(), Duration::from_secs(300));
        loop {
            tokio::select! {
                _ = interval.tick() => {},
                Some(_) = trigger_rx.recv() => {
                    while trigger_rx.try_recv().is_ok() {}
                }
            }
            self.sync_once().await;
            if let Err(e) = handle.emit("sync:updated", ()) {
                tracing::warn!(error = ?e, "failed to emit sync:updated");
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
