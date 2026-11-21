use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::runner::wait_child;
use super::state::{History, Status, TIMEOUT_SECS};
use super::work::{save_label, AgentWorkTarget, ItemLabel};
use crate::agent_notes::{
    AgentNoteService, CreateAgentNoteInput, ListAgentNotesInput, NoteTarget, RunAgentInput,
};
use crate::db::AppDatabase;
use crate::error::{AppError, Result};

#[derive(Default)]
struct Admission {
    active: HashMap<PathBuf, bool>,
    last_ask_id: i64,
}
static ADMISSION: LazyLock<Mutex<Admission>> = LazyLock::new(Mutex::default);

pub(super) fn active_status(path: &Path) -> Option<&'static str> {
    let admission = ADMISSION.lock().ok()?;
    admission
        .active
        .get(path)
        .map(|running| if *running { "running" } else { "waiting" })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineInvestigation {
    organization_id: String,
    project_id: String,
    build_id: i64,
    title: String,
    project_name: String,
    web_url: Option<String>,
    body: String,
    context: String,
    context_document: String,
}

#[derive(Serialize, Deserialize)]
struct Request {
    ask_id: i64,
    body: String,
    context: String,
    context_document: String,
}

fn request_path(path: &Path) -> std::path::PathBuf {
    path.with_extension("request.json")
}

pub fn start(db: &AppDatabase, input: PipelineInvestigation) -> Result<bool> {
    let settings = db.get_app_settings()?;
    if !settings.auto_agent_pipelines_enabled || settings.read_only_validation_mode_enabled {
        return Ok(false);
    }
    let target = AgentWorkTarget {
        organization_id: input.organization_id,
        scope_id: input.project_id.clone(),
        target: NoteTarget::Ask,
        id: input.build_id,
    };
    let path = target.history_path(db);
    let mut admission = ADMISSION.lock().map_err(|_| state_unavailable())?;
    if !History::read(&path)?.runs.is_empty() {
        return Ok(false);
    }
    let since = Utc::now() - chrono::Duration::hours(1);
    let recent = super::work::history_files(db)
        .into_iter()
        .filter(|(_, _, path)| {
            super::work::parse_history_name(
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default(),
            )
            .is_some_and(|(kind, _)| kind == NoteTarget::Ask)
        })
        .filter_map(|(_, _, path)| History::read(&path).ok())
        .flat_map(|history| history.runs.into_iter().take(1))
        .filter(|run| run.started_at > since)
        .take(5)
        .count();
    if recent >= 5 {
        return Ok(false);
    }

    // Manual ask IDs use a formatted local timestamp. Reserve a millisecond ID for
    // each automatically submitted request.
    admission.last_ask_id = Utc::now().timestamp_millis().max(admission.last_ask_id + 1);
    let request = Request {
        ask_id: admission.last_ask_id,
        body: input.body,
        context: input.context,
        context_document: input.context_document,
    };
    save_label(
        &path,
        &ItemLabel {
            title: input.title,
            scope: input.project_name,
            project_id: Some(input.project_id),
            web_url: input.web_url,
            ask_id: Some(request.ask_id),
        },
    )?;
    fs::write(
        request_path(&path),
        serde_json::to_vec(&request).map_err(|e| AppError::InvalidInput(e.to_string()))?,
    )?;
    launch(db, path, request, &mut admission)?;
    Ok(true)
}

pub(super) fn retry(db: &AppDatabase, target: AgentWorkTarget) -> Result<()> {
    if db.get_app_settings()?.read_only_validation_mode_enabled {
        return Err(AppError::InvalidInput(
            "Read-only validation mode is active.".into(),
        ));
    }
    let mut admission = ADMISSION.lock().map_err(|_| state_unavailable())?;
    let path = target.history_path(db);
    if admission.active.contains_key(&path) {
        return Err(AppError::InvalidInput(
            "The investigation is already queued or running.".into(),
        ));
    }
    let history = History::read(&path)?;
    if !history.runs.last().is_some_and(|run| {
        run.status == Status::Failed || (run.status == Status::Running && history.due(Utc::now()))
    }) {
        return Err(AppError::InvalidInput(
            "Only a failed item can be retried.".into(),
        ));
    }
    let request = load_request(&path)?;
    launch(db, path, request, &mut admission)
}

fn load_request(path: &Path) -> Result<Request> {
    serde_json::from_slice(&fs::read(request_path(path))?)
        .map_err(|e| AppError::InvalidInput(e.to_string()))
}

fn launch(
    db: &AppDatabase,
    path: PathBuf,
    request: Request,
    admission: &mut Admission,
) -> Result<()> {
    let mut history = History::read(&path)?;
    history.begin(None, None, Utc::now());
    history.save(&path)?;
    admission.active.insert(path.clone(), false);
    let db = db.clone();
    tauri::async_runtime::spawn(async move {
        let _permit = super::BATCH_SLOT
            .acquire()
            .await
            .expect("agent semaphore stays open");
        let mut attempt = history;
        let log_path = path.with_extension(format!("{}.log", attempt.runs.len()));
        let current = attempt.runs.last_mut().expect("attempt started");
        current.started_at = Utc::now();
        current.log_path = Some(log_path.clone());
        let result = match attempt.save(&path) {
            Ok(()) => {
                if let Ok(mut admission) = ADMISSION.lock() {
                    admission.active.insert(path.clone(), true);
                }
                tauri::async_runtime::spawn_blocking(move || {
                    if db.get_app_settings()?.read_only_validation_mode_enabled {
                        return Err(AppError::InvalidInput(
                            "Read-only validation mode is active.".into(),
                        ));
                    }
                    run(&AgentNoteService::new(db), request, &log_path)
                })
                .await
                .map_err(|error| AppError::InvalidInput(error.to_string()))
                .and_then(|result| result)
            }
            Err(error) => Err(error),
        };
        let (error, code) = match result {
            Ok(code) => (None, code),
            Err(error) => (Some(error.to_string()), None),
        };
        attempt.finish(error.is_none(), error, code);
        if let Err(error) = attempt.save(&path) {
            tracing::warn!(%error, "could not save pipeline investigation outcome");
        }
        if let Ok(mut admission) = ADMISSION.lock() {
            admission.active.remove(&path);
        }
    });
    Ok(())
}

fn run(service: &AgentNoteService, request: Request, log_path: &Path) -> Result<Option<i32>> {
    let list = || {
        service.list(ListAgentNotesInput {
            target: NoteTarget::Ask,
            item_id: request.ask_id,
        })
    };
    let id = match list()?.into_iter().next() {
        Some(note) if note.status == "done" => return Ok(None),
        Some(note) => note.id,
        None => {
            service
                .create(CreateAgentNoteInput {
                    target: NoteTarget::Ask,
                    item_id: request.ask_id,
                    body: request.body,
                    quote: None,
                    quote_prefix: None,
                    quote_suffix: None,
                    quote_offset: None,
                    result_file: None,
                    result_hash: None,
                    kind: Some("investigate".into()),
                    context: Some(request.context),
                    context_document: Some(request.context_document),
                    draft: false,
                })?
                .id
        }
    };
    let child = service.run_agent_tracked(
        RunAgentInput {
            target: NoteTarget::Ask,
            item_id: request.ask_id,
            repository_name: None,
            agent: None,
            model: None,
        },
        log_path,
    )?;
    let status = wait_child(child, TIMEOUT_SECS)?;
    if !status.success() {
        return Err(AppError::InvalidInput(format!(
            "Agent exited with {status}"
        )));
    }
    if !list()?
        .iter()
        .any(|note| note.id == id && note.status == "done")
    {
        return Err(AppError::InvalidInput(
            "Agent did not finish the investigation note.".into(),
        ));
    }
    Ok(status.code())
}

fn state_unavailable() -> AppError {
    AppError::InvalidInput("Pipeline investigation state is unavailable.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: i64) -> PipelineInvestigation {
        PipelineInvestigation {
            organization_id: "org".into(),
            project_id: "project".into(),
            build_id: id,
            title: "CI pipeline".into(),
            project_name: "Project".into(),
            web_url: None,
            body: "Investigate the failed build".into(),
            context: "CI pipeline".into(),
            context_document: "Failed step".into(),
        }
    }

    async fn failed(db: &AppDatabase, failures: usize) -> super::super::work::AgentWorkEntry {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Some(entry) = super::super::work::list(db)
                    .unwrap()
                    .into_iter()
                    .find(|entry| entry.status == "failed" && entry.failures == failures)
                {
                    return entry;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("pipeline attempt records its outcome")
    }

    #[tokio::test]
    async fn failed_build_is_listed_deduplicated_and_can_be_retried() {
        let dir = tempfile::tempdir().unwrap();
        let db = AppDatabase::new(dir.path().join("db.sqlite3"));
        db.initialize().unwrap();
        assert!(!start(&db, input(42)).unwrap());
        let mut settings = db.get_app_settings().unwrap();
        settings.auto_agent_pipelines_enabled = true;
        settings.agent_workspace_path = Some(dir.path().join("missing").to_string_lossy().into());
        db.update_app_settings(settings).unwrap();

        assert!(start(&db, input(42)).unwrap());
        assert!(!start(&db, input(42)).unwrap());
        let first = failed(&db, 1).await;
        assert_eq!(first.target, "pipeline");
        assert_eq!(first.title, "CI pipeline");
        assert!(first.error.as_deref().unwrap().contains("workspace folder"));
        let ask_id = first.ask_id.unwrap();
        retry(
            &db,
            AgentWorkTarget {
                organization_id: first.organization_id,
                scope_id: first.scope_id,
                target: NoteTarget::Ask,
                id: first.id,
            },
        )
        .unwrap();
        let second = failed(&db, 2).await;
        assert_eq!(second.ask_id, Some(ask_id));
    }
}
