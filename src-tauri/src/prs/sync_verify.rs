//! Self-repair of the active-PR cache in projects whose active list hit
//! `PROJECT_PR_SYNC_TOP`. Their rows outside the fetched window are kept by a
//! normal sync, so a PR completed upstream would stay listed forever. Each
//! pass drops the ones that are provably closed and checks a few of the rest.

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use azdo_client::AdoClient;
use chrono::{DateTime, FixedOffset};
use tokio::task::JoinSet;

use super::util::is_ado_not_found;
use crate::db::{AppDatabase, CachedPr, CachedPrKey, Organization};
use crate::error::Result;
use crate::sync::SyncBudget;

/// Rows checked one by one per capped project and pass.
pub(crate) const VERIFY_LIMIT: usize = 30;

/// Where the next pass starts checking, so repeated passes cover every row.
static VERIFY_CURSOR: AtomicUsize = AtomicUsize::new(0);

/// Organizations whose next PR sync rebuilds the cache (Settings > Sync health).
static REBUILD_REQUESTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Marks `org_ids` so their next PR sync replaces every cached row, including
/// capped projects and unresolved group reviews.
pub(crate) fn request_rebuild(org_ids: impl IntoIterator<Item = String>) {
    let mut pending = REBUILD_REQUESTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for id in org_ids {
        if !pending.contains(&id) {
            pending.push(id);
        }
    }
}

/// Consumes a pending rebuild request for `org_id`.
pub(crate) fn take_rebuild(org_id: &str) -> bool {
    let mut pending = REBUILD_REQUESTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let before = pending.len();
    pending.retain(|id| id != org_id);
    pending.len() != before
}

fn parse(date: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(date).ok()
}

/// Drops cached PRs of `capped_project_ids` that are no longer active and
/// returns how many were dropped. A cached row the window did not return but
/// that is newer than the window's oldest PR is closed (the active list is
/// newest first); older rows are checked individually, `VERIFY_LIMIT` per
/// project and pass. A failed check keeps the row.
pub(super) async fn prune_closed_in_capped(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    capped_project_ids: &[String],
    fetched: &[CachedPr],
    budget: &SyncBudget,
) -> Result<usize> {
    let mut closed: Vec<CachedPrKey> = Vec::new();
    let mut to_check: Vec<(String, CachedPrKey)> = Vec::new();
    let start = VERIFY_CURSOR.fetch_add(VERIFY_LIMIT, Ordering::Relaxed);
    for project_id in capped_project_ids {
        let window: Vec<&CachedPr> = fetched
            .iter()
            .filter(|pr| &pr.project_id == project_id)
            .collect();
        let returned: HashSet<(&str, i64)> = window
            .iter()
            .map(|pr| (pr.repository_id.as_str(), pr.pull_request_id))
            .collect();
        let oldest = window
            .iter()
            .filter_map(|pr| parse(&pr.creation_date))
            .min();
        let mut older = Vec::new();
        for row in db.list_cached_pr_keys(&org.id, project_id)? {
            if returned.contains(&(row.repository_id.as_str(), row.pull_request_id)) {
                continue;
            }
            match (oldest, parse(&row.creation_date)) {
                (Some(oldest), Some(created)) if created > oldest => closed.push(row),
                _ => older.push(row),
            }
        }
        if older.is_empty() {
            continue;
        }
        let offset = start % older.len();
        older.rotate_left(offset);
        to_check.extend(
            older
                .into_iter()
                .take(VERIFY_LIMIT)
                .map(|row| (project_id.clone(), row)),
        );
    }

    let mut tasks = JoinSet::new();
    for (project_id, row) in to_check {
        let (client, budget) = (client.clone(), budget.clone());
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            let still_active = match client
                .get_pull_request_detail(&project_id, &row.repository_id, row.pull_request_id)
                .await
            {
                Ok(detail) => detail.status.as_deref().is_none_or(|s| s == "active"),
                Err(error) if is_ado_not_found(&error) => false,
                Err(error) => {
                    tracing::warn!(pr = row.pull_request_id, %error, "failed to check a cached PR");
                    true
                }
            };
            (!still_active).then_some(row)
        });
    }
    while let Some(joined) = tasks.join_next().await {
        closed.extend(joined.ok().flatten());
    }

    for row in &closed {
        db.forget_closed_pull_request(&org.id, &row.repository_id, row.pull_request_id)?;
    }
    Ok(closed.len())
}

/// [`prune_closed_in_capped`] for the sync pass; a failure only logs, since
/// the rows it would drop are rechecked on the next pass.
pub(super) async fn prune_capped(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    (capped_project_ids, fetched): (&Vec<String>, &[CachedPr]),
    budget: &SyncBudget,
) {
    if capped_project_ids.is_empty() {
        return;
    }
    match prune_closed_in_capped(db, client, org, capped_project_ids, fetched, budget).await {
        Ok(0) => {}
        Ok(count) => {
            tracing::info!(org = %org.name, count, "sync: dropped closed PRs of capped projects")
        }
        Err(error) => {
            tracing::warn!(org = %org.name, ?error, "sync: pruning closed capped PRs failed")
        }
    }
}
