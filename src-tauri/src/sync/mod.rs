use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Semaphore};

use crate::db::AppDatabase;
use crate::secrets::SecretStore;

mod notifications;
mod org;
mod runner;

#[cfg(test)]
mod tests;

pub use notifications::{PrNotificationItem, PrNotificationKind};

/// Shared upper bound on concurrent in-flight Azure DevOps requests across the
/// whole sync pass. Every network-bound sync task acquires a permit before its
/// REST call, so parallelizing orgs and sync kinds cannot exceed this budget
/// (which keeps rate-limit pressure bounded even as fan-out grows).
pub type SyncBudget = Arc<Semaphore>;

/// Total concurrent Azure DevOps requests allowed during a sync pass. The REST
/// API tolerates this comfortably; 429s are still absorbed by the client's
/// `Retry-After` handling.
pub const GLOBAL_SYNC_CONCURRENCY: usize = 12;

pub struct SyncRunner {
    db: AppDatabase,
    secrets: SecretStore,
    concurrency: SyncBudget,
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

    /// Folds another outcome in; a pass succeeds if any part succeeded and is
    /// marked failed if any part failed (`is_failure` still requires no success).
    fn merge(&mut self, other: SyncPassOutcome) {
        self.succeeded |= other.succeeded;
        self.failed |= other.failed;
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
