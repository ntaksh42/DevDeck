//! Agent Work: what the automatic runner did and is doing for each item
//! (waiting, running, failed, partial, succeeded), read from the durable
//! history, plus the items the user excluded from automatic runs.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use super::state::{self, History, Status, TIMEOUT_SECS};
use super::AutoItem;
use crate::agent_notes::NoteTarget;
use crate::db::{AppDatabase, CachedReviewPr, CachedWorkItem, Organization};
use crate::error::{AppError, Result};

/// The end of a log shown on screen; the whole file stays on disk.
const LOG_TAIL_BYTES: u64 = 64 * 1024;

/// What the screen shows for an item that may have left the synced data
/// (a voted PR, a work item picked in a view), saved next to its history.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ItemLabel {
    pub title: String,
    /// Repository of a pull request, project of a work item.
    pub scope: String,
    pub project_id: Option<String>,
    pub web_url: Option<String>,
}

impl ItemLabel {
    fn of(item: &AutoItem) -> Self {
        match item {
            AutoItem::PullRequest(pr) => Self {
                title: pr.title.clone(),
                scope: pr.repository_name.clone(),
                project_id: Some(pr.project_id.clone()),
                web_url: pr.web_url.clone(),
            },
            AutoItem::WorkItem(wi) => Self {
                title: wi.title.clone(),
                scope: wi.project_name.clone(),
                project_id: Some(wi.project_id.clone()),
                web_url: wi.web_url.clone(),
            },
        }
    }
}

type Key = (String, &'static str, i64);

fn target_str(target: NoteTarget) -> &'static str {
    match target {
        NoteTarget::PullRequest => "pull-request",
        _ => "work-item",
    }
}

pub(super) fn key(org_id: &str, target: NoteTarget, id: i64) -> Key {
    (org_id.to_string(), target_str(target), id)
}

fn scope_id(item: &AutoItem) -> String {
    match item {
        AutoItem::PullRequest(pr) => pr.repository_id.clone(),
        AutoItem::WorkItem(wi) => wi.project_id.clone(),
    }
}

fn meta_path(history: &Path) -> PathBuf {
    history.with_extension("meta.json")
}

/// Saves the item's title and scope before an attempt, so the history stays
/// readable after the item leaves the synced data. Best effort.
pub(super) fn remember(db: &AppDatabase, org: &Organization, item: &AutoItem) {
    let path = meta_path(&item.history_path(db, org));
    let saved = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| {
            let bytes = serde_json::to_vec_pretty(&ItemLabel::of(item)).unwrap_or_default();
            fs::write(&path, bytes)
        });
    if let Err(error) = saved {
        tracing::warn!(id = item.id(), %error, "agent work: could not save the item label");
    }
}

fn read_label(history: &Path) -> Option<ItemLabel> {
    serde_json::from_slice(&fs::read(meta_path(history)).ok()?).ok()
}

mod excluded;
mod pending;

pub(super) use excluded::excluded_keys;
use excluded::read_excluded;
pub use excluded::{set_excluded, SetExcludedInput};
pub(super) use pending::{dequeue, enqueue, mark_started};
use pending::{Pending, PENDING};

// ── Listing ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkEntry {
    pub organization_id: String,
    pub organization_name: String,
    pub target: &'static str,
    pub id: i64,
    /// Repository ID of a pull request, project ID of a work item.
    pub scope_id: String,
    pub title: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub web_url: Option<String>,
    /// `waiting` | `running` | `failed` | `partial` | `succeeded` | `none`.
    pub status: &'static str,
    pub excluded: bool,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    /// Failed attempts in a row.
    pub failures: usize,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
    pub has_log: bool,
}

fn decode_hex(text: &str) -> Option<String> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    let bytes = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

/// `pr-12.json` / `wi-34.json`; the label, temp and log files are skipped.
fn parse_history_name(name: &str) -> Option<(NoteTarget, i64)> {
    let stem = name.strip_suffix(".json")?;
    let (target, id) = if let Some(id) = stem.strip_prefix("pr-") {
        (NoteTarget::PullRequest, id)
    } else {
        (NoteTarget::WorkItem, stem.strip_prefix("wi-")?)
    };
    Some((target, id.parse().ok()?))
}

fn status_of(history: &History, pending: Option<&Pending>, now: DateTime<Utc>) -> &'static str {
    let last = history.runs.last();
    if let Some(last) = last.filter(|r| r.status == Status::Running) {
        if now < last.started_at + Duration::seconds(TIMEOUT_SECS as i64) {
            return "running";
        }
    }
    if let Some(pending) = pending {
        return if pending.started {
            "running"
        } else {
            "waiting"
        };
    }
    match last.map(|r| &r.status) {
        None => "none",
        Some(Status::Succeeded) => "succeeded",
        Some(Status::Partial) => "partial",
        Some(Status::Failed | Status::Running) => "failed",
    }
}

/// Synced titles for items whose label was never saved (older histories).
#[derive(Default)]
struct SyncedLabels {
    prs: HashMap<String, Vec<CachedReviewPr>>,
    work_items: HashMap<String, Vec<CachedWorkItem>>,
}

impl SyncedLabels {
    fn find(
        &mut self,
        db: &AppDatabase,
        org: &str,
        target: NoteTarget,
        scope_id: &str,
        id: i64,
    ) -> Option<ItemLabel> {
        let item = if target == NoteTarget::PullRequest {
            let prs = self
                .prs
                .entry(org.to_string())
                .or_insert_with(|| db.list_review_pull_requests(org).unwrap_or_default());
            let pr = prs
                .iter()
                .find(|pr| pr.pull_request_id == id && pr.repository_id == scope_id)?;
            AutoItem::PullRequest(pr.clone())
        } else {
            let items = self
                .work_items
                .entry(org.to_string())
                .or_insert_with(|| db.list_my_work_items(org).unwrap_or_default());
            AutoItem::WorkItem(items.iter().find(|wi| wi.id == id)?.clone())
        };
        Some(ItemLabel::of(&item))
    }
}

/// Every item with an automatic-run history, a pending pick or an exclusion,
/// most recent activity first.
pub fn list(db: &AppDatabase) -> Result<Vec<AgentWorkEntry>> {
    let orgs: HashMap<String, Organization> = db
        .list_organizations()?
        .into_iter()
        .map(|o| (o.id.clone(), o))
        .collect();
    let org_name = |id: &str| {
        orgs.get(id)
            .map(|o| o.display_name.clone().unwrap_or_else(|| o.name.clone()))
            .unwrap_or_else(|| id.to_string())
    };
    let pending = PENDING
        .lock()
        .map_err(|_| AppError::InvalidInput("agent work state is unavailable".into()))?;
    let excluded = read_excluded(db);
    let excluded_keys: HashSet<Key> = excluded
        .iter()
        .map(|e| key(&e.organization_id, e.target, e.id))
        .collect();
    let mut synced = SyncedLabels::default();
    let now = Utc::now();
    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    for (org_id, scope, path) in history_files(db) {
        let Some((target, id)) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(parse_history_name)
        else {
            continue;
        };
        let history = match History::read(&path) {
            Ok(history) => history,
            Err(error) => {
                tracing::warn!(path = %path.display(), ?error, "agent work: unreadable history");
                continue;
            }
        };
        let key = key(&org_id, target, id);
        let label = read_label(&path)
            .or_else(|| synced.find(db, &org_id, target, &scope, id))
            .unwrap_or_default();
        let waiting = pending.iter().find(|p| p.key == key);
        let last = history.runs.last();
        entries.push(AgentWorkEntry {
            organization_name: org_name(&org_id),
            target: target_str(target),
            id,
            scope_id: scope,
            title: label.title,
            scope: label.scope,
            project_id: label.project_id,
            web_url: label.web_url,
            status: status_of(&history, waiting, now),
            excluded: excluded_keys.contains(&key),
            started_at: last.map(|r| r.started_at),
            finished_at: last.and_then(|r| r.finished_at),
            failures: history.failures(),
            next_retry_at: history.retry_at(),
            error: last.and_then(|r| r.error.clone()),
            exit_code: last.and_then(|r| r.exit_code),
            has_log: last
                .and_then(|r| r.log_path.as_deref())
                .is_some_and(Path::exists),
            organization_id: org_id,
        });
        seen.insert(key);
    }
    for p in pending.iter() {
        if !seen.insert(p.key.clone()) {
            continue;
        }
        entries.push(bare_entry(
            &p.key,
            &org_name(&p.key.0),
            &p.scope_id,
            p.label.clone(),
            if p.started { "running" } else { "waiting" },
            excluded_keys.contains(&p.key),
        ));
    }
    for e in excluded {
        let key = key(&e.organization_id, e.target, e.id);
        if seen.insert(key.clone()) {
            let label = ItemLabel {
                title: e.title,
                scope: e.scope,
                project_id: None,
                web_url: None,
            };
            entries.push(bare_entry(
                &key,
                &org_name(&key.0),
                &e.scope_id,
                label,
                "none",
                true,
            ));
        }
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.finished_at.or(e.started_at)));
    Ok(entries)
}

fn bare_entry(
    key: &Key,
    org_name: &str,
    scope_id: &str,
    label: ItemLabel,
    status: &'static str,
    excluded: bool,
) -> AgentWorkEntry {
    AgentWorkEntry {
        organization_id: key.0.clone(),
        organization_name: org_name.to_string(),
        target: key.1,
        id: key.2,
        scope_id: scope_id.to_string(),
        title: label.title,
        scope: label.scope,
        project_id: label.project_id,
        web_url: label.web_url,
        status,
        excluded,
        started_at: None,
        finished_at: None,
        failures: 0,
        next_retry_at: None,
        error: None,
        exit_code: None,
        has_log: false,
    }
}

/// `(organization ID, repository or project ID, path)` of every history file.
fn history_files(db: &AppDatabase) -> Vec<(String, String, PathBuf)> {
    let root = db.data_dir().join("auto-agent");
    let dirs = |path: &Path| -> Vec<PathBuf> {
        fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| e.path()).collect())
            .unwrap_or_default()
    };
    let mut files = Vec::new();
    for org_dir in dirs(&root).into_iter().filter(|p| p.is_dir()) {
        let Some(org) = org_dir
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(decode_hex)
        else {
            continue;
        };
        for scope_dir in dirs(&org_dir).into_iter().filter(|p| p.is_dir()) {
            let Some(scope) = scope_dir
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(decode_hex)
            else {
                continue;
            };
            files.extend(
                dirs(&scope_dir)
                    .into_iter()
                    .map(|path| (org.clone(), scope.clone(), path)),
            );
        }
    }
    files
}

// ── Actions on one item ──

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkTarget {
    pub organization_id: String,
    pub target: NoteTarget,
    pub id: i64,
    pub scope_id: String,
}

impl AgentWorkTarget {
    fn history_path(&self, db: &AppDatabase) -> PathBuf {
        state::history_path(
            db,
            &self.organization_id,
            &self.scope_id,
            self.target,
            self.id,
        )
    }
}

/// The end of the latest attempt's log (stdout and stderr of the agent).
pub fn read_log(db: &AppDatabase, target: AgentWorkTarget) -> Result<String> {
    let history = History::read(&target.history_path(db))?;
    let Some(path) = history.runs.last().and_then(|r| r.log_path.clone()) else {
        return Ok(String::new());
    };
    let mut file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Starts a failed item again now, without waiting for its backoff.
pub fn retry(db: &AppDatabase, target: AgentWorkTarget) -> Result<()> {
    let path = target.history_path(db);
    let mut history = History::read(&path)?;
    if status_of(&history, None, Utc::now()) != "failed" {
        return Err(AppError::InvalidInput(
            "Only a failed item can be retried.".into(),
        ));
    }
    let org = db
        .get_organization(&target.organization_id)?
        .ok_or_else(|| AppError::InvalidInput("organization not found".into()))?;
    let queued = super::queue::AutoQueueTarget {
        organization_id: target.organization_id.clone(),
        target: target.target,
        id: target.id,
    };
    let item = match super::queue::find(db, &queued) {
        Ok((_, item)) => item,
        // A work item picked in a view is not in the assigned-to-me cache.
        Err(_) if target.target == NoteTarget::WorkItem => {
            let label = read_label(&path).unwrap_or_default();
            AutoItem::WorkItem(CachedWorkItem {
                org_id: org.id.clone(),
                project_id: target.scope_id.clone(),
                project_name: label.scope,
                id: target.id,
                title: label.title,
                work_item_type: None,
                state: None,
                assigned_to: None,
                assigned_to_unique_name: None,
                changed_date: None,
                web_url: label.web_url,
                tags: None,
            })
        }
        Err(error) => return Err(error),
    };
    super::queue::ensure_unique_number(db, &org, &item)?;
    history.retry_requested = true;
    history.save(&path)?;
    super::queue::spawn_runs(db, db.get_app_settings()?, vec![(org, item)], 1, None, None);
    Ok(())
}

#[cfg(test)]
mod tests;
