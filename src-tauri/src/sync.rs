use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::{interval_at, Instant};

use crate::auth::client_for_organization;
use crate::db::AppDatabase;
use crate::prs::sync_prs_for_org;
use crate::secrets::SecretStore;

pub struct SyncRunner {
    db: AppDatabase,
    secrets: SecretStore,
}

impl SyncRunner {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn run(self, handle: AppHandle) {
        let start = Instant::now() + Duration::from_secs(300);
        let mut interval = interval_at(start, Duration::from_secs(300));
        loop {
            interval.tick().await;
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
        }
    }
}
