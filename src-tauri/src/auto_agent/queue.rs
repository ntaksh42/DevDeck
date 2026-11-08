//! Auto queue (setting `auto_agent_approval_enabled`): the candidates of the
//! automatic run are listed instead of started, with the material the agent
//! would get, and only the ones picked are handed to the agent.

use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use super::{handled_check, pick, runner, AutoItem, BATCH_SLOT};
use crate::agent_notes::launch::AgentKind;
use crate::agent_notes::{self, NoteTarget};
use crate::db::{AppDatabase, AppSettings, CachedWorkItem, Organization};
use crate::error::{AppError, Result};

/// Characters of the material sent to the screen; the agent gets all of it.
const PREVIEW_CHARS: usize = 30_000;

/// Longest note from the requester about what to look at.
const FOCUS_CHARS: usize = 2_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoQueueItem {
    pub organization_id: String,
    pub organization_name: String,
    pub target: &'static str,
    pub id: i64,
    pub title: String,
    /// Repository of a pull request, project of a work item.
    pub scope: String,
    pub web_url: Option<String>,
    pub created_date: Option<String>,
    /// Held back from the automatic run, so it waits for a pick.
    pub held: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoQueuePreview {
    /// The start of the material; empty when there is nothing to hand over.
    pub document: String,
    pub chars: usize,
    pub estimated_tokens: usize,
    /// Why nothing can be started (a pull request without readable changes).
    pub unavailable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoQueueTarget {
    pub organization_id: String,
    pub target: NoteTarget,
    pub id: i64,
}

fn folder(path: &Option<String>) -> Option<&Path> {
    path.as_deref().map(Path::new)
}

/// Every unhandled candidate of every organization, pull requests first.
pub fn list(db: &AppDatabase) -> Result<Vec<AutoQueueItem>> {
    let settings = db.get_app_settings()?;
    let mut queue = Vec::new();
    for org in db.list_organizations()? {
        let items = candidates(db, &settings, &org)?;
        queue.extend(items.into_iter().map(|item| {
            let held = settings.auto_agent_approval_enabled;
            to_queue_item(&org, item, held)
        }));
    }
    Ok(queue)
}

/// The unhandled candidates of one organization.
pub(super) fn candidates(
    db: &AppDatabase,
    settings: &AppSettings,
    org: &Organization,
) -> Result<Vec<AutoItem>> {
    let root = agent_notes::notes_root(db);
    let (review_folder, work_item_folder) = (
        folder(&settings.review_result_folder_path),
        folder(&settings.work_item_result_folder_path),
    );
    // A folder that cannot be read would mark every item handled and leave the
    // queue silently empty, so say what is wrong instead.
    for (label, path) in [("review", review_folder), ("work item", work_item_folder)] {
        if let Some(path) = path.filter(|path| !path.is_dir()) {
            return Err(AppError::InvalidInput(format!(
                "The {label} result folder does not exist or is not a folder: {}",
                path.display()
            )));
        }
    }
    let prs = match review_folder {
        Some(_) => db.list_review_pull_requests(&org.id)?,
        None => Vec::new(),
    };
    let work_items = match work_item_folder {
        Some(_) => db.list_my_work_items(&org.id)?,
        None => Vec::new(),
    };
    // Items an automatic attempt already tracks follow their own retry
    // schedule instead of waiting for approval again.
    let handled = handled_check(&root, review_folder, work_item_folder);
    Ok(pick(prs, work_items, usize::MAX, Utc::now(), handled)
        .into_iter()
        .filter(|item| !item.history_path(db, org).exists())
        .collect())
}

fn to_queue_item(org: &Organization, item: AutoItem, held: bool) -> AutoQueueItem {
    let (target, id, title, scope, web_url, created_date) = match item {
        AutoItem::PullRequest(pr) => (
            "pull-request",
            pr.pull_request_id,
            pr.title,
            pr.repository_name,
            pr.web_url,
            Some(pr.creation_date),
        ),
        AutoItem::WorkItem(wi) => (
            "work-item",
            wi.id,
            wi.title,
            wi.project_name,
            wi.web_url,
            wi.changed_date,
        ),
    };
    AutoQueueItem {
        organization_id: org.id.clone(),
        organization_name: org.display_name.clone().unwrap_or_else(|| org.name.clone()),
        target,
        id,
        title,
        scope,
        web_url,
        created_date,
        held,
    }
}

/// Automatic runs pause when another organization or repository already uses
/// the item number (notes and results are named by number alone). Say so when
/// the user picks such an item, instead of silently doing nothing.
pub(super) fn ensure_unique_number(
    db: &AppDatabase,
    org: &Organization,
    item: &AutoItem,
) -> Result<()> {
    if super::state::has_number_collision(db, &item.history_path(db, org))? {
        return Err(AppError::InvalidInput(format!(
            "#{} is also used by another organization or repository, so notes and results would be mixed up. It is not started.",
            item.id()
        )));
    }
    Ok(())
}

/// Finds the cached item behind a target; it may be gone since the list was drawn.
fn find(db: &AppDatabase, target: &AutoQueueTarget) -> Result<(Organization, AutoItem)> {
    let org = db
        .get_organization(&target.organization_id)?
        .ok_or_else(|| AppError::InvalidInput("organization not found".to_string()))?;
    let item = match target.target {
        NoteTarget::PullRequest => db
            .list_review_pull_requests(&org.id)?
            .into_iter()
            .find(|pr| pr.pull_request_id == target.id)
            .map(AutoItem::PullRequest),
        NoteTarget::WorkItem => db
            .list_my_work_items(&org.id)?
            .into_iter()
            .find(|wi| wi.id == target.id)
            .map(AutoItem::WorkItem),
        NoteTarget::Ask => None,
    };
    let item = item.ok_or_else(|| {
        AppError::InvalidInput("the item is no longer in the synced data".to_string())
    })?;
    Ok((org, item))
}

/// The material the agent would get for one candidate. It calls the REST API
/// (the diffs of a pull request), so it is fetched only for the item on screen.
pub async fn preview(db: &AppDatabase, target: AutoQueueTarget) -> Result<AutoQueuePreview> {
    let (org, item) = find(db, &target)?;
    let settings = db.get_app_settings()?;
    let Some(document) = runner::preview(db, &settings, &org, &item).await? else {
        return Ok(AutoQueuePreview {
            document: String::new(),
            chars: 0,
            estimated_tokens: 0,
            unavailable: Some(
                "No readable changes: the agent would have nothing to review.".into(),
            ),
        });
    };
    let chars = document.chars().count();
    Ok(AutoQueuePreview {
        document: document.chars().take(PREVIEW_CHARS).collect(),
        chars,
        estimated_tokens: chars / 3,
        unavailable: None,
    })
}

/// Work items investigated at the same time by [`run_assigned_work_items`].
const WORK_ITEM_PARALLEL: usize = 3;

/// Hands the picked candidates to the automatic runner in the background, one
/// after the other and never alongside an automatic batch. Returns how many
/// were queued.
pub fn run(
    db: &AppDatabase,
    targets: Vec<AutoQueueTarget>,
    focus: Option<String>,
) -> Result<usize> {
    let settings = db.get_app_settings()?;
    let mut picked = Vec::new();
    for target in &targets {
        let (org, item) = find(db, target)?;
        ensure_unique_number(db, &org, &item)?;
        picked.push((org, item));
    }
    let count = picked.len();
    let focus = focus
        .map(|text| text.trim().chars().take(FOCUS_CHARS).collect::<String>())
        .filter(|text| !text.is_empty());
    spawn_runs(db, settings, picked, 1, None, focus);
    Ok(count)
}

/// Investigates every unhandled work item assigned to me, [`WORK_ITEM_PARALLEL`]
/// at a time and never alongside an automatic batch. Returns how many were queued.
pub fn run_assigned_work_items(db: &AppDatabase, agent: Option<AgentKind>) -> Result<usize> {
    let settings = db.get_app_settings()?;
    let mut picked = Vec::new();
    for org in db.list_organizations()? {
        for item in candidates(db, &settings, &org)? {
            if item.target() == NoteTarget::WorkItem
                && !super::state::has_number_collision(db, &item.history_path(db, &org))?
            {
                picked.push((org.clone(), item));
            }
        }
    }
    let count = picked.len();
    if count > 0 {
        spawn_runs(db, settings, picked, WORK_ITEM_PARALLEL, agent, None);
    }
    Ok(count)
}

/// A work item picked in a Work Items view. The view may show items that are
/// not in the assigned-to-me cache, so the screen sends what the runner needs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemTarget {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
}

/// Investigates the work items picked in a view, [`WORK_ITEM_PARALLEL`] at a
/// time and never alongside an automatic batch. Returns how many were queued.
/// Items that already succeeded or have a result are skipped by the runner.
pub fn run_work_items(
    db: &AppDatabase,
    targets: Vec<WorkItemTarget>,
    agent: Option<AgentKind>,
) -> Result<usize> {
    let settings = db.get_app_settings()?;
    let mut picked = Vec::new();
    for target in targets {
        let org = db
            .get_organization(&target.organization_id)?
            .ok_or_else(|| AppError::InvalidInput("organization not found".to_string()))?;
        let item = CachedWorkItem {
            org_id: org.id.clone(),
            project_id: target.project_id,
            project_name: target.project_name,
            id: target.id,
            title: target.title,
            work_item_type: None,
            state: None,
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: None,
            web_url: None,
            tags: None,
        };
        let item = AutoItem::WorkItem(item);
        ensure_unique_number(db, &org, &item)?;
        picked.push((org, item));
    }
    let count = picked.len();
    if count > 0 {
        spawn_runs(db, settings, picked, WORK_ITEM_PARALLEL, agent, None);
    }
    Ok(count)
}

fn spawn_runs(
    db: &AppDatabase,
    settings: AppSettings,
    picked: Vec<(Organization, AutoItem)>,
    parallel: usize,
    agent: Option<AgentKind>,
    focus: Option<String>,
) {
    let db = db.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(_slot) = BATCH_SLOT.acquire().await else {
            return;
        };
        let permits = Arc::new(Semaphore::new(parallel));
        let settings = Arc::new(settings);
        let mut handles = Vec::new();
        for (org, item) in picked {
            let Ok(permit) = permits.clone().acquire_owned().await else {
                break;
            };
            let (db, settings, focus) = (db.clone(), settings.clone(), focus.clone());
            handles.push(tauri::async_runtime::spawn(async move {
                let _permit = permit;
                if let Err(e) = runner::process_item(&db, &settings, &org, &item, agent, focus).await {
                    tracing::warn!(org = %org.name, id = item.id(), error = ?e, "auto queue: failed to start");
                }
            }));
        }
        for handle in handles {
            let _ = handle.await;
        }
    });
}
