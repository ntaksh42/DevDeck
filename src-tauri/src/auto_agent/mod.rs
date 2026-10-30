//! Automatic review and investigation (setting `auto_agent_enabled`): after a
//! sync, pull requests that newly await my review and work items newly
//! assigned to me are handed to the agent as an Agent notes `investigate`
//! note, exactly as if the user had asked from the Result panel. The agent
//! writes the result HTML; it gets no Azure DevOps access and is told not to
//! change code or propose comments.

mod context;

use std::collections::HashSet;

use crate::agent_notes::{self, AgentNoteService, CreateAgentNoteInput, NoteTarget, RunAgentInput};
use crate::db::{AppDatabase, AppSettings, CachedReviewPr, CachedWorkItem, Organization};
use crate::error::Result;
use crate::pr_review::{PrLocator, PrReviewService};
use crate::secrets::SecretStore;
use crate::work_items::{GetWorkItemPreviewInput, WorkItemService};

/// Items started per organization and sync; the rest stay for the user.
const ITEMS_PER_SYNC: usize = 3;

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

/// Snapshot of the review PRs and my work items taken before a sync, or
/// `None` when the feature is off or there is no earlier sync to compare with
/// (the first sync would otherwise hand over everything at once).
pub(crate) struct Before {
    prs: Option<HashSet<i64>>,
    work_items: Option<HashSet<i64>>,
}

impl Before {
    pub(crate) fn take(
        db: &AppDatabase,
        settings: &AppSettings,
        org_id: &str,
        prs_synced: bool,
        work_items_synced: bool,
    ) -> Option<Self> {
        if !settings.auto_agent_enabled {
            return None;
        }
        let prs = prs_synced
            .then(|| db.list_review_pull_requests(org_id).ok())
            .flatten()
            .map(|prs| prs.iter().map(|pr| pr.pull_request_id).collect());
        let work_items = work_items_synced
            .then(|| db.list_my_work_items(org_id).ok())
            .flatten()
            .map(|items| items.iter().map(|wi| wi.id).collect());
        Some(Self { prs, work_items })
    }
}

/// The new items worth starting, pull requests first, up to the per-sync
/// limit. Drafts are left out (not ready for review), and so is anything that
/// already has a notes folder (the user or an earlier run asked already).
pub(crate) fn pick(
    before: &Before,
    prs: Vec<CachedReviewPr>,
    work_items: Vec<CachedWorkItem>,
    has_notes: impl Fn(NoteTarget, i64) -> bool,
) -> Vec<AutoItem> {
    let is_new =
        |seen: &Option<HashSet<i64>>, id: i64| seen.as_ref().is_some_and(|s| !s.contains(&id));
    let prs = prs
        .into_iter()
        .filter(|pr| !pr.is_draft && is_new(&before.prs, pr.pull_request_id))
        .map(AutoItem::PullRequest);
    let work_items = work_items
        .into_iter()
        .filter(|wi| is_new(&before.work_items, wi.id))
        .map(AutoItem::WorkItem);
    prs.chain(work_items)
        .filter(|item| !has_notes(item.target(), item.id()))
        .take(ITEMS_PER_SYNC)
        .collect()
}

/// Compares the cache with `before` and starts the agent on the new items in
/// the background. Gathering the material calls the REST API, so it does not
/// hold up the sync.
pub(crate) fn start(db: &AppDatabase, settings: &AppSettings, org: &Organization, before: Before) {
    let root = agent_notes::notes_root(db);
    let items = pick(
        &before,
        db.list_review_pull_requests(&org.id).unwrap_or_default(),
        db.list_my_work_items(&org.id).unwrap_or_default(),
        |target, id| agent_notes::notes_dir(&root, target, id).exists(),
    );
    if items.is_empty() {
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
