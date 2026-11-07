//! Automatic review and investigation (setting `auto_agent_enabled`): on a sync
//! at least `auto_agent_interval_minutes` after the previous check (the first
//! one after startup always checks), pull requests awaiting my review and work
//! items assigned to me that are not handled yet are handed to the agent as an
//! Agent notes `investigate` note, exactly as if the user had asked from the
//! Result panel. The items form a queue worked off a few per check, so what was waiting when
//! the app started (or when the setting was turned on) is handled too. The
//! agent writes the result HTML; it gets no Azure DevOps access and is told
//! not to change code or propose comments.

mod context;
mod diffs;
mod runner;
mod state;

use chrono::{DateTime, Duration, Utc};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration as StdDuration, Instant};

use crate::agent_notes::NoteTarget;
use crate::db::{AppDatabase, AppSettings, CachedReviewPr, CachedWorkItem, Organization};
use crate::error::Result;

/// Pull requests created longer ago than this are left to a manual request.
const MAX_PR_AGE_DAYS: i64 = 30;
/// Organization batches wait their turn instead of being dropped while a
/// different organization's agent is still running.
static BATCH_SLOT: LazyLock<tokio::sync::Semaphore> =
    LazyLock::new(|| tokio::sync::Semaphore::new(1));
static QUEUED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);
static LAST_CHECK: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Mutex::default);

/// Whether the interval since `last` has elapsed (never checked counts as due).
fn is_due(last: Option<Instant>, now: Instant, interval_minutes: i64) -> bool {
    let interval = StdDuration::from_secs(interval_minutes.max(1) as u64 * 60);
    last.is_none_or(|last| now.saturating_duration_since(last) >= interval)
}

/// Records a check for the organization and returns true when one is due, so
/// a sync that comes sooner than the interval leaves the queue alone.
fn claim_check(org_id: &str, interval_minutes: i64, now: Instant) -> bool {
    let Ok(mut last_checks) = LAST_CHECK.lock() else {
        return true;
    };
    if !is_due(last_checks.get(org_id).copied(), now, interval_minutes) {
        return false;
    }
    last_checks.insert(org_id.to_string(), now);
    true
}

/// One item to hand to the agent.
#[derive(Debug)]
pub(crate) enum AutoItem {
    PullRequest(CachedReviewPr),
    WorkItem(CachedWorkItem),
}

impl AutoItem {
    fn history_path(&self, db: &AppDatabase, org: &Organization) -> PathBuf {
        let repo = match self {
            Self::PullRequest(pr) => pr.repository_id.as_str(),
            Self::WorkItem(wi) => wi.project_id.as_str(),
        };
        state::history_path(db, &org.id, repo, self.target(), self.id())
    }

    fn target(&self) -> NoteTarget {
        match self {
            Self::PullRequest(_) => NoteTarget::PullRequest,
            Self::WorkItem(_) => NoteTarget::WorkItem,
        }
    }

    fn id(&self) -> i64 {
        match self {
            Self::PullRequest(pr) => pr.pull_request_id,
            Self::WorkItem(wi) => wi.id,
        }
    }
}

/// Whether the pull request still waits for my review: not a draft, no vote of
/// mine yet, and created within [`MAX_PR_AGE_DAYS`]. An unreadable creation
/// date does not exclude it.
fn awaits_review(pr: &CachedReviewPr, now: DateTime<Utc>) -> bool {
    let recent = DateTime::parse_from_rfc3339(&pr.creation_date)
        .map(|created| now - created.with_timezone(&Utc) <= Duration::days(MAX_PR_AGE_DAYS))
        .unwrap_or(true);
    !pr.is_draft && pr.my_vote == 0 && recent
}

/// The next items of the queue, pull requests first, up to `limit`. Pull
/// requests I voted on, drafts and old ones are left out, and so is anything
/// already handled according to the caller's predicate. Initial selection
/// remains separate from the durable revision checks for tracked PRs.
pub(crate) fn pick(
    prs: Vec<CachedReviewPr>,
    work_items: Vec<CachedWorkItem>,
    limit: usize,
    now: DateTime<Utc>,
    is_handled: impl Fn(NoteTarget, i64) -> bool,
) -> Vec<AutoItem> {
    let prs = prs
        .into_iter()
        .filter(|pr| awaits_review(pr, now))
        .map(AutoItem::PullRequest);
    let work_items = work_items.into_iter().map(AutoItem::WorkItem);
    prs.chain(work_items)
        .filter(|item| !is_handled(item.target(), item.id()))
        .take(limit)
        .collect()
}

struct BatchGuard(String);
impl BatchGuard {
    fn reserve(key: String) -> Option<Self> {
        let inserted = {
            let mut queued = QUEUED.lock().ok()?;
            queued.insert(key.clone())
        };
        if inserted {
            Some(Self(key))
        } else {
            None
        }
    }
}
impl Drop for BatchGuard {
    fn drop(&mut self) {
        if let Ok(mut queued) = QUEUED.lock() {
            queued.remove(&self.0);
        }
    }
}

pub(crate) fn start(db: &AppDatabase, settings: &AppSettings, org: &Organization) {
    if !settings.auto_agent_enabled {
        return;
    }
    let key = format!("{}|{}", db.cache_key(), org.id);
    let Some(guard) = BatchGuard::reserve(key.clone()) else {
        return;
    };
    let db = db.clone();
    let org = org.clone();
    tauri::async_runtime::spawn(async move {
        let _guard = guard;
        let Ok(_slot) = BATCH_SLOT.acquire().await else {
            return;
        };
        // Queued organizations use the current settings when their turn comes.
        let outcome = match db.get_app_settings() {
            Ok(settings)
                if settings.auto_agent_enabled
                    && claim_check(&key, settings.auto_agent_interval_minutes, Instant::now()) =>
            {
                run_batch(&db, &settings, &org).await
            }
            Ok(_) => Ok(()),
            Err(error) => Err(error),
        };
        if let Err(error) = outcome {
            tracing::warn!(org = %org.name, ?error, "auto agent: batch failed");
        }
    });
}

async fn run_batch(db: &AppDatabase, settings: &AppSettings, org: &Organization) -> Result<()> {
    let prs = if settings.review_result_folder_path.is_some() {
        db.list_review_pull_requests(&org.id)?
    } else {
        Vec::new()
    };
    let work_items = if settings.work_item_result_folder_path.is_some() {
        db.list_my_work_items(&org.id)?
    } else {
        Vec::new()
    };
    // Previously tracked PRs keep following pushes even after a vote or the
    // initial 30-day window. Drafts still pause automatic review.
    let (tracked, initial): (Vec<_>, Vec<_>) =
        prs.into_iter().filter(|pr| !pr.is_draft).partition(|pr| {
            state::history_path(
                db,
                &org.id,
                &pr.repository_id,
                NoteTarget::PullRequest,
                pr.pull_request_id,
            )
            .exists()
        });
    let mut items: Vec<_> = tracked
        .into_iter()
        .map(AutoItem::PullRequest)
        .chain(pick(initial, work_items, usize::MAX, Utc::now(), |_, _| {
            false
        }))
        .collect();
    // Never-attempted and least-recently-attempted items get their turn before
    // repeatedly failing entries can consume the same first slots forever.
    items.sort_by_key(|item| {
        state::History::read(&item.history_path(db, org))
            .ok()
            .and_then(|h| h.runs.last().map(|r| r.started_at))
    });
    let mut attempted = 0;
    for item in items {
        if attempted >= settings.auto_agent_max_per_sync.clamp(1, 10) as usize {
            break;
        }
        if !db.get_app_settings()?.auto_agent_enabled {
            break;
        }
        match runner::process_item(db, settings, org, &item).await {
            Ok(true) => attempted += 1,
            Ok(false) => (),
            Err(error) => {
                attempted += 1;
                tracing::warn!(org = %org.name, id = item.id(), ?error, "auto agent: attempt failed");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
