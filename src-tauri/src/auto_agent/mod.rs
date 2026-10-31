//! Automatic review and investigation (setting `auto_agent_enabled`): after
//! each sync, pull requests awaiting my review and work items assigned to me
//! that are not handled yet are handed to the agent as an Agent notes
//! `investigate` note, exactly as if the user had asked from the Result panel.
//! The items form a queue worked off a few per sync, so what was waiting when
//! the app started (or when the setting was turned on) is handled too. The
//! agent writes the result HTML; it gets no Azure DevOps access and is told
//! not to change code or propose comments.

mod context;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::agent_notes::{self, AgentNoteService, CreateAgentNoteInput, NoteTarget, RunAgentInput};
use crate::db::{AppDatabase, AppSettings, CachedReviewPr, CachedWorkItem, Organization};
use crate::error::Result;
use crate::pr_review::{PrLocator, PrReviewService};
use crate::secrets::SecretStore;
use crate::settings::result_files;
use crate::work_items::{GetWorkItemPreviewInput, WorkItemService};

/// Items started per organization and sync; the rest wait for later syncs.
const ITEMS_PER_SYNC: usize = 3;
/// Set while a batch is gathering material, so an overlapping sync does not
/// pick the same items before their notes exist.
static RUNNING: AtomicBool = AtomicBool::new(false);

/// One item to hand to the agent.
#[derive(Debug)]
pub(crate) enum AutoItem {
    PullRequest(CachedReviewPr),
    WorkItem(CachedWorkItem),
}

impl AutoItem {
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

/// The next items of the queue, pull requests first, up to the per-sync
/// limit. Drafts are left out (not ready for review), and so is anything
/// already handled: it has a notes folder (the user or an earlier run asked)
/// or a result HTML.
pub(crate) fn pick(
    prs: Vec<CachedReviewPr>,
    work_items: Vec<CachedWorkItem>,
    is_handled: impl Fn(NoteTarget, i64) -> bool,
) -> Vec<AutoItem> {
    let prs = prs
        .into_iter()
        .filter(|pr| !pr.is_draft)
        .map(AutoItem::PullRequest);
    let work_items = work_items.into_iter().map(AutoItem::WorkItem);
    prs.chain(work_items)
        .filter(|item| !is_handled(item.target(), item.id()))
        .take(ITEMS_PER_SYNC)
        .collect()
}

/// Starts the agent on the next unhandled items in the background. Gathering
/// the material calls the REST API, so it does not hold up the sync. A target
/// without a result folder is skipped (there is nowhere to write the result).
pub(crate) fn start(db: &AppDatabase, settings: &AppSettings, org: &Organization) {
    if !settings.auto_agent_enabled || RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let review_folder = settings.review_result_folder_path.as_deref().map(Path::new);
    let work_item_folder = settings
        .work_item_result_folder_path
        .as_deref()
        .map(Path::new);
    let prs = match review_folder {
        Some(_) => db.list_review_pull_requests(&org.id).unwrap_or_default(),
        None => Vec::new(),
    };
    let work_items = match work_item_folder {
        Some(_) => db.list_my_work_items(&org.id).unwrap_or_default(),
        None => Vec::new(),
    };
    let root = agent_notes::notes_root(db);
    let items = pick(prs, work_items, |target, id| {
        if agent_notes::notes_dir(&root, target, id).exists() {
            return true;
        }
        let found = match target {
            NoteTarget::PullRequest => {
                review_folder.map(|folder| result_files::find_review_result_file(folder, id))
            }
            _ => {
                work_item_folder.map(|folder| result_files::find_work_item_result_file(folder, id))
            }
        };
        // An unreadable folder counts as handled, so nothing is started blind.
        found.is_none_or(|found| !matches!(found, Ok(None)))
    });
    if items.is_empty() {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    }
    let db = db.clone();
    let org = org.clone();
    let settings = settings.clone();
    tauri::async_runtime::spawn(async move {
        for item in items {
            if let Err(e) = start_item(&db, &settings, &org, &item).await {
                tracing::warn!(org = %org.name, id = item.id(), error = ?e, "auto agent: failed to start");
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

async fn start_item(
    db: &AppDatabase,
    settings: &AppSettings,
    org: &Organization,
    item: &AutoItem,
) -> Result<()> {
    let (document, line, repository, folder) = match item {
        AutoItem::PullRequest(pr) => {
            let locator = || PrLocator {
                organization_id: Some(org.id.clone()),
                project_id: pr.project_id.clone(),
                repository_id: pr.repository_id.clone(),
                pull_request_id: pr.pull_request_id,
            };
            let service = PrReviewService::new(db.clone(), SecretStore);
            let review = service.get_review(locator()).await?;
            let changes = service.list_changes(locator()).await.ok();
            (
                context::pull_request(pr, &review, changes.as_ref()),
                format!(
                    "!{} {} {}",
                    pr.pull_request_id,
                    pr.title,
                    pr.web_url.as_deref().unwrap_or_default()
                ),
                Some(pr.repository_name.clone()),
                settings.review_result_folder_path.as_deref(),
            )
        }
        AutoItem::WorkItem(wi) => {
            let preview = WorkItemService::new(db.clone(), SecretStore)
                .preview(GetWorkItemPreviewInput {
                    organization_id: Some(org.id.clone()),
                    project_id: wi.project_id.clone(),
                    work_item_id: wi.id,
                    custom_fields: None,
                })
                .await?;
            (
                context::work_item(&preview),
                format!(
                    "#{} {} {}",
                    wi.id,
                    wi.title,
                    wi.web_url.as_deref().unwrap_or_default()
                ),
                None,
                settings.work_item_result_folder_path.as_deref(),
            )
        }
    };
    let service = AgentNoteService::new(db.clone());
    service.create(CreateAgentNoteInput {
        target: item.target(),
        item_id: item.id(),
        body: context::note_body(item.target(), folder.unwrap_or_default()),
        quote: None,
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: None,
        result_file: None,
        result_hash: None,
        kind: Some("investigate".to_string()),
        context: Some(line.trim().to_string()),
        context_document: Some(document),
        draft: false,
    })?;
    service.run_agent(RunAgentInput {
        target: item.target(),
        item_id: item.id(),
        repository_name: repository,
        agent: None,
        model: None,
    })
}

#[cfg(test)]
mod tests;
