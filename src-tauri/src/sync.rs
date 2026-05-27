use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::{interval_at, Instant};

use crate::db::AppDatabase;
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
            if let Err(e) = handle.emit("sync:updated", ()) {
                tracing::warn!(error = ?e, "failed to emit sync:updated");
            }
        }
    }
}
