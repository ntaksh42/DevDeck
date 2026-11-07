//! Prepares and validates one automatic attempt. Only a verified result moves
//! the incremental-review baseline; merely creating a note never does.
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::Utc;

use super::state::{History, Status, TIMEOUT_SECS};
use super::{context, diffs, AutoItem};
use crate::agent_notes::launch::AgentKind;
use crate::agent_notes::{
    automation, AgentNoteService, CreateAgentNoteInput, ListAgentNotesInput, NoteTarget,
    RunAgentInput,
};
use crate::db::{AppDatabase, AppSettings, Organization};
use crate::error::{AppError, Result};
use crate::pr_review::{PrLocator, PrReviewService};
use crate::secrets::SecretStore;
use crate::settings::result_files;
use crate::work_items::{GetWorkItemPreviewInput, WorkItemService};

struct Material {
    document: String,
    label: String,
    repository: Option<String>,
    folder: PathBuf,
    base: Option<String>,
    head: Option<String>,
    complete: bool,
    has_content: bool,
    /// Agent picked for a manual run; unset, the one chosen in Settings.
    agent: Option<AgentKind>,
}

pub(super) async fn process_item(
    db: &AppDatabase,
    settings: &AppSettings,
    org: &Organization,
    item: &AutoItem,
    agent: Option<AgentKind>,
) -> Result<bool> {
    let path = item.history_path(db, org);
    if super::state::has_number_collision(db, &path)? {
        tracing::warn!(
            id = item.id(),
            "auto agent: paused for an item-number collision"
        );
        return Ok(false);
    }
    let mut history = History::read(&path)?;
    if !history.due(Utc::now()) {
        return Ok(false);
    }
    let service = AgentNoteService::new(db.clone());
    let notes = service.list(ListAgentNotesInput {
        target: item.target(),
        item_id: item.id(),
    })?;
    // Never launch pending human requests as a side effect of a sync.
    if notes.iter().any(automation::has_human_request) {
        return Ok(false);
    }
    if let AutoItem::PullRequest(pr) = item {
        if let Some(url) = pr.web_url.as_deref() {
            if notes.iter().any(|n| {
                n.context
                    .as_deref()
                    .and_then(|c| c.split_whitespace().last())
                    .is_some_and(|last| last.starts_with("http") && last != url)
            }) {
                tracing::warn!(
                    id = item.id(),
                    "auto agent: existing notes refer to another PR URL"
                );
                return Ok(false);
            }
        }
    }
    if item.target() == NoteTarget::WorkItem
        && history
            .runs
            .last()
            .is_some_and(|r| matches!(r.status, Status::Succeeded | Status::Partial))
    {
        return Ok(false);
    }
    let mut observed_range = (None, None);
    let material = match prepare(db, settings, org, item, &history, &mut observed_range).await {
        Ok(Some(mut material)) => {
            material.agent = agent;
            material
        }
        Ok(None) => return Ok(false),
        Err(error) => {
            history.begin(
                observed_range.0.or_else(|| history.reviewed_commit.clone()),
                observed_range.1,
                Utc::now(),
            );
            history.finish(false, Some(error.to_string()), None);
            history.save(&path)?;
            // Preparation failures are visible and retryable too, even when
            // the model never started and no context could be assembled.
            let note = create_note(
                &service,
                item,
                "DevDeck automatic review: prepare the supplied material.",
                None,
            )?;
            history.runs.last_mut().unwrap().note_id = Some(note.id.clone());
            history.save(&path)?;
            automation::append_status(&service, item.target(), item.id(), &note.id,
                "Automatic review could not collect its material. It will retry after a delay; details are in the auto-agent history.", true)?;
            return Err(error);
        }
    };
    execute(db, item, &path, &mut history, material, TIMEOUT_SECS).await?;
    Ok(true)
}

/// The material an attempt would hand to the agent, for the Auto queue
/// preview. `None` when there is nothing reviewable to hand over.
pub(super) async fn preview(
    db: &AppDatabase,
    settings: &AppSettings,
    org: &Organization,
    item: &AutoItem,
) -> Result<Option<String>> {
    let history = History::read(&item.history_path(db, org))?;
    let material = prepare(db, settings, org, item, &history, &mut (None, None)).await?;
    Ok(material.filter(|m| m.has_content).map(|m| m.document))
}

async fn prepare(
    db: &AppDatabase,
    settings: &AppSettings,
    org: &Organization,
    item: &AutoItem,
    history: &History,
    observed_range: &mut (Option<String>, Option<String>),
) -> Result<Option<Material>> {
    match item {
        AutoItem::PullRequest(pr) => {
            let locator = || PrLocator {
                organization_id: Some(org.id.clone()),
                project_id: pr.project_id.clone(),
                repository_id: pr.repository_id.clone(),
                pull_request_id: pr.pull_request_id,
            };
            let service = PrReviewService::new(db.clone(), SecretStore);
            let changes = service
                .list_changes_since(locator(), history.reviewed_commit.as_deref())
                .await?;
            *observed_range = (
                changes.base_commit_id.clone(),
                changes.target_commit_id.clone(),
            );
            let head = changes
                .target_commit_id
                .as_deref()
                .ok_or_else(|| AppError::InvalidInput("PR source commit is unavailable".into()))?;
            if !history.needs_review(head) {
                return Ok(None);
            }
            let diff = diffs::section(&service, locator, &changes).await?;
            let review = service.get_review(locator()).await?;
            Ok(Some(Material {
                document: context::pull_request(pr, &review, Some(&changes), &diff.document),
                label: format!(
                    "!{} {} {}",
                    pr.pull_request_id,
                    pr.title,
                    pr.web_url.as_deref().unwrap_or_default()
                ),
                repository: Some(pr.repository_name.clone()),
                folder: PathBuf::from(
                    settings
                        .review_result_folder_path
                        .as_deref()
                        .unwrap_or_default(),
                ),
                base: changes.base_commit_id,
                head: changes.target_commit_id,
                complete: diff.complete,
                has_content: diff.has_content || changes.files.is_empty(),
                agent: None,
            }))
        }
        AutoItem::WorkItem(wi) => {
            let folder = PathBuf::from(
                settings
                    .work_item_result_folder_path
                    .as_deref()
                    .unwrap_or_default(),
            );
            // Existing manual investigations keep their historical behavior.
            if history.runs.is_empty()
                && result_files::find_work_item_result_file(&folder, wi.id)?.is_some()
            {
                return Ok(None);
            }
            let preview = WorkItemService::new(db.clone(), SecretStore)
                .preview(GetWorkItemPreviewInput {
                    organization_id: Some(org.id.clone()),
                    project_id: wi.project_id.clone(),
                    work_item_id: wi.id,
                    custom_fields: None,
                })
                .await?;
            Ok(Some(Material {
                document: context::work_item(&preview),
                label: format!("#{} {}", wi.id, wi.title),
                repository: None,
                folder,
                base: None,
                head: None,
                complete: true,
                has_content: true,
                agent: None,
            }))
        }
    }
}

fn create_note(
    service: &AgentNoteService,
    item: &AutoItem,
    body: &str,
    material: Option<&Material>,
) -> Result<crate::agent_notes::AgentNote> {
    service.create(CreateAgentNoteInput {
        target: item.target(),
        item_id: item.id(),
        body: body.into(),
        quote: None,
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: None,
        result_file: None,
        result_hash: None,
        kind: Some("investigate".into()),
        context: material.map(|m| m.label.clone()),
        context_document: material.map(|m| m.document.clone()),
        draft: false,
    })
}

async fn execute(
    db: &AppDatabase,
    item: &AutoItem,
    path: &Path,
    history: &mut History,
    material: Material,
    timeout_secs: u64,
) -> Result<()> {
    let outcome = execute_attempt(db, item, path, history, material, timeout_secs).await;
    if let Err(error) = &outcome {
        if history
            .runs
            .last()
            .is_some_and(|r| r.status == Status::Running)
        {
            history.finish(false, Some(error.to_string()), None);
            history.save(path)?;
            if let Some(note_id) = history.runs.last().and_then(|r| r.note_id.as_deref()) {
                let service = AgentNoteService::new(db.clone());
                automation::append_status(&service, item.target(), item.id(), note_id,
                    "Automatic review could not finish validating its local result. The reviewed commit is unchanged; retry is scheduled after a delay.", false)?;
            }
        }
    }
    outcome
}

async fn execute_attempt(
    db: &AppDatabase,
    item: &AutoItem,
    path: &Path,
    history: &mut History,
    material: Material,
    timeout_secs: u64,
) -> Result<()> {
    let service = AgentNoteService::new(db.clone());
    // Archive only automatic open attempts, leaving human notes untouched.
    for note in service.list(ListAgentNotesInput {
        target: item.target(),
        item_id: item.id(),
    })? {
        if automation::has_human_request(&note) {
            return Err(AppError::InvalidInput(
                "Automatic review paused for a pending human request".into(),
            ));
        }
        if note.status == "open" && automation::is_automatic(&note) {
            automation::append_status(
                &service,
                item.target(),
                item.id(),
                &note.id,
                "Superseded by a new automatic attempt with refreshed material.",
                true,
            )?;
        }
    }
    history.begin(material.base.clone(), material.head.clone(), Utc::now());
    history.save(path)?;
    let mut body = context::note_body(item.target(), &material.folder.display().to_string());
    body.push_str(&format!(
        "\n- Review range: {} -> {}. Review ONLY this supplied range. Re-evaluate previous findings touched by this range and mark them fixed or still present; retain unrelated findings as previously observed, without claiming they were re-reviewed.\n- Record both commit IDs and coverage omissions in the HTML. Do not claim omitted files were reviewed.\n- If the range is empty, update the HTML to record that there are no new code changes.\n- Do not fetch or check out another revision to replace the supplied snapshot.",
        material.base.as_deref().unwrap_or("initial PR base"), material.head.as_deref().unwrap_or("work item")
    ));
    let note = create_note(&service, item, &body, Some(&material))?;
    let log_path = path.with_file_name(format!(
        "{}-{}.log",
        path.file_stem().unwrap_or_default().to_string_lossy(),
        history.runs.len()
    ));
    let last = history.runs.last_mut().unwrap();
    last.note_id = Some(note.id.clone());
    last.log_path = Some(log_path.clone());
    history.save(path)?;
    if !material.has_content {
        history.finish(false, None, None);
        history.save(path)?;
        automation::append_status(&service, item.target(), item.id(), &note.id,
            "No reviewable text was available. Coverage is incomplete; this revision is not recorded as reviewed. A later push will be checked again.", true)?;
        return Ok(());
    }
    let before = result_stamp(&material.folder, item)?;
    let input = RunAgentInput {
        target: item.target(),
        item_id: item.id(),
        repository_name: material.repository,
        agent: material.agent,
        model: None,
    };
    let outcome = match service.run_agent_tracked(input, &log_path) {
        Ok(child) => tauri::async_runtime::spawn_blocking(move || wait_child(child, timeout_secs))
            .await
            .map_err(|e| AppError::InvalidInput(format!("agent wait failed: {e}")))?,
        Err(e) => Err(e),
    };
    let (mut error, exit_code) = match outcome {
        Ok(status) if status.success() => (None, status.code()),
        Ok(status) => (Some(format!("Agent exited with {}", status)), status.code()),
        Err(e) => (Some(e.to_string()), None),
    };
    let done = service
        .list(ListAgentNotesInput {
            target: item.target(),
            item_id: item.id(),
        })?
        .into_iter()
        .find(|n| n.id == note.id && n.status == "done");
    if error.is_none()
        && (done.is_none()
            || result_stamp(&material.folder, item)?.is_none()
            || result_stamp(&material.folder, item)? == before)
    {
        error = Some("Agent did not finish the note and update its result HTML".into());
    }
    let insufficient = material.document.contains("[Context truncated:")
        || done
            .as_ref()
            .and_then(|n| n.resolved.as_deref())
            .is_some_and(|r| {
                r.contains("資料不足") || r.to_ascii_lowercase().contains("insufficient")
            });
    let failed = error.is_some();
    history.finish(material.complete && !insufficient, error.clone(), exit_code);
    history.save(path)?;
    if failed {
        automation::append_status(&service, item.target(), item.id(), &note.id,
            &format!("Automatic review failed. The reviewed commit was not advanced; retry is scheduled after a delay. Log: {}", log_path.display()), false)?;
        return Err(AppError::InvalidInput(error.unwrap()));
    }
    if !material.complete || insufficient {
        automation::append_status(&service, item.target(), item.id(), &note.id,
            "Coverage is incomplete. The last fully reviewed commit is unchanged; the HTML records the omitted material.", true)?;
    }
    Ok(())
}

fn result_stamp(folder: &Path, item: &AutoItem) -> Result<Option<(PathBuf, SystemTime, u64)>> {
    let found = if item.target() == NoteTarget::PullRequest {
        result_files::find_review_result_file(folder, item.id())?
    } else {
        result_files::find_work_item_result_file(folder, item.id())?
    };
    found
        .map(|path| {
            let metadata = std::fs::metadata(&path)?;
            Ok((path, metadata.modified()?, metadata.len()))
        })
        .transpose()
}

fn wait_child(
    mut child: crate::agent_notes::launch::TrackedChild,
    timeout_secs: u64,
) -> Result<std::process::ExitStatus> {
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if start.elapsed().as_secs() >= timeout_secs {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::InvalidInput("Automatic review timed out".into()));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests;
