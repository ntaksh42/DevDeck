//! In-memory cache of each project's repository list.
//!
//! The commit sync runs every few minutes and previously re-listed every
//! project's repositories each time, although repositories rarely change. A
//! stale entry only delays picking up a brand-new repository (or dropping a
//! deleted one) by at most `TTL`, which is far shorter than the 24 hour full
//! commit sync that reconciles the rest. Entries from before a connection
//! change (`cache_epoch`) are ignored, and an explicit refresh bypasses the
//! cache so a just-created repository shows up immediately.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use azdo_client::GitRepository;

const TTL: Duration = Duration::from_secs(60 * 60);

type Key = (u64, String, String, String);
type Entries = HashMap<Key, (Instant, Vec<GitRepository>)>;

fn entries() -> &'static Mutex<Entries> {
    static ENTRIES: OnceLock<Mutex<Entries>> = OnceLock::new();
    ENTRIES.get_or_init(Default::default)
}

fn key(db_key: &str, org_id: &str, project_id: &str) -> Key {
    (
        crate::cache_epoch::current(),
        db_key.into(),
        org_id.into(),
        project_id.into(),
    )
}

pub(super) fn get(db_key: &str, org_id: &str, project_id: &str) -> Option<Vec<GitRepository>> {
    let entries = entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (stored_at, repos) = entries.get(&key(db_key, org_id, project_id))?;
    (stored_at.elapsed() < TTL).then(|| repos.clone())
}

pub(super) fn put(db_key: &str, org_id: &str, project_id: &str, repos: &[GitRepository]) {
    entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            key(db_key, org_id, project_id),
            (Instant::now(), repos.to_vec()),
        );
}
