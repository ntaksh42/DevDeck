//! In-memory cache of each project's repository list.
//!
//! Repositories rarely change, so the PR search repository picker and the
//! branch list reuse one listing per project instead of re-listing on every
//! call. A stale entry only delays picking up a brand-new repository (or
//! dropping a deleted one) by at most `TTL`.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use azdo_client::GitRepository;

const TTL: Duration = Duration::from_secs(60 * 60);

type Key = (String, String, String);
type Entries = HashMap<Key, (Instant, Vec<GitRepository>)>;

fn entries() -> &'static Mutex<Entries> {
    static ENTRIES: OnceLock<Mutex<Entries>> = OnceLock::new();
    ENTRIES.get_or_init(Default::default)
}

fn key(db_key: &str, org_id: &str, project_id: &str) -> Key {
    (db_key.into(), org_id.into(), project_id.into())
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

/// Ids of the projects that own `repository_ids`, read from fresh cache
/// entries only (no API call). Repositories not in the cache are skipped.
pub(super) fn owning_project_ids(
    db_key: &str,
    org_id: &str,
    repository_ids: &HashSet<String>,
) -> HashSet<String> {
    let entries = entries()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    entries
        .iter()
        .filter(|((db, org, _), (stored_at, _))| {
            db == db_key && org == org_id && stored_at.elapsed() < TTL
        })
        .flat_map(|(_, (_, repos))| repos)
        .filter(|repo| repository_ids.contains(&repo.id))
        .filter_map(|repo| repo.project.as_ref().map(|project| project.id.clone()))
        .collect()
}
