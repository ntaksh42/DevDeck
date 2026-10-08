//! Process-wide generation counter for the in-memory TTL caches (project
//! directory, repository lists, group memberships).
//!
//! Those caches are keyed by organization id, which survives a connection being
//! deleted and re-added with a different account. Bumping the epoch whenever a
//! connection is added or removed makes every entry stored under an older epoch
//! a miss, so a new credential never reads results fetched with the old one.

use std::sync::atomic::{AtomicU64, Ordering};

static EPOCH: AtomicU64 = AtomicU64::new(0);

pub(crate) fn current() -> u64 {
    EPOCH.load(Ordering::Relaxed)
}

pub(crate) fn bump() {
    EPOCH.fetch_add(1, Ordering::Relaxed);
}
