//! Workers: the Orchestrator's requests run as ordinary agent conversations
//! (`ask-{id}` notes), so the Agent panel shows them as they are. At most ten
//! run at once; the rest wait in order.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use super::snapshot::Target;
use super::store_chat::{self, DispatchRow};
use super::types::now_ms;
use super::HomeBot;
use crate::agent_notes::launch::{AgentKind, TrackedChild};
use crate::agent_notes::{
    AgentNote, CreateAgentNoteInput, ListAgentNotesInput, NoteTarget, ReplyAgentNoteInput,
    RunAgentInput,
};
use crate::error::{AppError, Result};

pub(crate) const MAX_RUNNING: usize = 10;
pub(crate) const MAX_QUEUED: usize = 10;

type Running = Mutex<HashMap<String, Arc<Mutex<TrackedChild>>>>;

fn running() -> &'static Running {
    static RUNNING: OnceLock<Running> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A fresh `ask-{id}` id: milliseconds, kept increasing within the process.
fn next_ask_id() -> i64 {
    static LAST: AtomicI64 = AtomicI64::new(0);
    let now = now_ms();
    let mut last = LAST.load(Ordering::SeqCst);
    loop {
        let next = now.max(last + 1);
        match LAST.compare_exchange(last, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return next,
            Err(seen) => last = seen,
        }
    }
}

/// Records a new worker on `target` (None: a free-standing request) and starts
/// it now or queues it. Returns its id.
pub(crate) fn create(
    bot: &HomeBot,
    chat_id: &str,
    target: Option<&Target>,
    spec: &str,
    agent: &str,
    model: Option<&str>,
) -> Result<String> {
    let conn = bot.db.open()?;
    let queued = store_chat::dispatches_with_status(&conn, "queued")?.len();
    if queued >= MAX_QUEUED {
        return Err(AppError::InvalidInput(format!(
            "{MAX_QUEUED} workers are already waiting"
        )));
    }
    let now = now_ms();
    // A PR / WI worker answers in that item's notes when its result folder is
    // set, so the result HTML lands there and the item's Agent panel shows it.
    let (note_target, item_id, folder) =
        item_notes(bot, target).unwrap_or((NoteTarget::Ask, next_ask_id(), None));
    let mut row = DispatchRow {
        id: super::store::next_id("d", now),
        chat_id: chat_id.to_string(),
        target: target
            .map(|t| t.key.clone())
            .unwrap_or_else(|| "ask".into()),
        target_label: target
            .map(|t| t.label.clone())
            .unwrap_or_else(|| "request".into()),
        repository: target.and_then(|t| t.repository.clone()),
        ask_id: item_id,
        agent: agent.to_string(),
        model: model.map(str::to_string),
        spec: spec.trim().to_string(),
        status: "queued".into(),
        result_state: None,
        created_at: now,
        started_at: None,
        ended_at: None,
        note_target: note_target_name(note_target).into(),
        note_id: None,
    };
    let context = match target {
        Some(t) => format!("{} {}", t.label, t.title),
        None => "Requested from the Home Orchestrator".to_string(),
    };
    let document = match target {
        Some(t) => format!(
            "# {} {}\n\nURL: {}\nRepository: {}\nTarget key: {}\n\nThis request comes from the user's Home Orchestrator in DevDeck. For a pull request, DevDeck adds its diff, \
             description and threads below before you start, and the working folder is a clone of the repository when one could be made. \
             Reply in this note with what you found (file:line for evidence), then finish it as the guide says.\n",
            t.label,
            t.title,
            t.web_url.as_deref().unwrap_or("(none)"),
            t.repository.as_deref().unwrap_or("(none)"),
            t.key
        ),
        None => "This request comes from the user's Home Orchestrator in DevDeck.\n".to_string(),
    };
    let body = match &folder {
        Some(folder) => format!(
            "{}\n\n- 結果 HTML を `{folder}` に作る。書き方は `{folder}\\AGENTS.md` の「DevDeck の結果 HTML の書き方」に従う。\n\
             - 返信には結論と要点を 3 行以内で書く (Home の Orchestrator がそれを要約する)。\n\
             - PR のレビューでは、観点・変更の種類に応じた図・章立てを devdeck-pr-review スキル (`{}`) を最初に読んで従う。\n\
             - 読み取り専用: コードやブランチは変更しない。",
            row.spec,
            crate::agent_notes::review_skill::skill_path(&crate::agent_notes::notes_root(&bot.db)).display()
        ),
        None => row.spec.clone(),
    };
    let note = bot.notes.create(CreateAgentNoteInput {
        target: note_target,
        item_id: row.ask_id,
        body,
        quote: None,
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: None,
        result_file: None,
        result_hash: None,
        kind: Some("investigate".into()),
        context: Some(context),
        context_document: Some(document),
        draft: false,
    })?;
    row.note_id = Some(note.id);
    store_chat::insert_dispatch(&conn, &row)?;
    drop(conn);
    pump(bot);
    Ok(row.id)
}

pub(crate) fn note_target_name(target: NoteTarget) -> &'static str {
    match target {
        NoteTarget::PullRequest => "pull-request",
        NoteTarget::WorkItem => "work-item",
        NoteTarget::Ask => "ask",
    }
}

fn note_target_of(row: &DispatchRow) -> NoteTarget {
    match row.note_target.as_str() {
        "pull-request" => NoteTarget::PullRequest,
        "work-item" => NoteTarget::WorkItem,
        _ => NoteTarget::Ask,
    }
}

/// The item's own notes and its result folder, when that folder is set.
fn item_notes(bot: &HomeBot, target: Option<&Target>) -> Option<(NoteTarget, i64, Option<String>)> {
    let target = target?;
    let settings = bot.db.get_app_settings().ok()?;
    let (kind, folder) = if target.key.starts_with("pr:") {
        (NoteTarget::PullRequest, settings.review_result_folder_path)
    } else if target.key.starts_with("wi:") {
        (NoteTarget::WorkItem, settings.work_item_result_folder_path)
    } else {
        return None;
    };
    let folder = folder.filter(|f| std::path::Path::new(f).is_dir())?;
    let id = target.key.rsplit('/').next()?.parse().ok()?;
    Some((kind, id, Some(folder)))
}

/// Sends a follow-up to a worker's conversation and runs it again (queued if
/// ten are running).
pub(crate) fn send(bot: &HomeBot, id: &str, text: &str) -> Result<()> {
    let conn = bot.db.open()?;
    let row = store_chat::get_dispatch(&conn, id)?
        .ok_or_else(|| AppError::InvalidInput(format!("unknown worker {id}")))?;
    if row.status == "running" {
        return Err(AppError::InvalidInput(format!(
            "worker {id} is still running"
        )));
    }
    let note = last_note(bot, &row)?
        .ok_or_else(|| AppError::InvalidInput("the worker's note is gone".into()))?;
    bot.notes.reply(ReplyAgentNoteInput {
        target: note_target_of(&row),
        item_id: row.ask_id,
        note_id: note.id,
        body: text.to_string(),
    })?;
    store_chat::set_status(&conn, id, "queued", now_ms())?;
    // A follow-up's result is new: report it again.
    conn.execute(
        "UPDATE home_dispatches SET result_state = NULL WHERE id = ?1",
        [id],
    )?;
    drop(conn);
    pump(bot);
    Ok(())
}

pub(crate) fn stop(bot: &HomeBot, id: &str) -> Result<()> {
    let child = running()
        .lock()
        .map_err(|_| AppError::Database("worker lock poisoned".into()))?
        .remove(id);
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
    let conn = bot.db.open()?;
    store_chat::set_status(&conn, id, "stopped", now_ms())?;
    drop(conn);
    bot.notify();
    pump(bot);
    Ok(())
}

/// Serializes `pump`, so two finishing workers cannot both take the last slot.
static PUMP: Mutex<()> = Mutex::new(());

/// Starts queued workers while fewer than ten run. A worker counts as running
/// from the moment DevDeck starts gathering its material.
pub(crate) fn pump(bot: &HomeBot) {
    {
        let _guard = PUMP.lock().unwrap_or_else(|p| p.into_inner());
        let Ok(conn) = bot.db.open() else { return };
        let Ok(queued) = store_chat::dispatches_with_status(&conn, "queued") else {
            return;
        };
        let mut count = store_chat::dispatches_with_status(&conn, "running")
            .map(|rows| rows.len())
            .unwrap_or(MAX_RUNNING);
        for row in queued {
            if count >= MAX_RUNNING {
                break;
            }
            if store_chat::set_status(&conn, &row.id, "running", now_ms()).is_err() {
                continue;
            }
            count += 1;
            let bot = bot.clone();
            std::thread::spawn(move || run_worker(&bot, &row));
        }
    }
    bot.notify();
}

fn still_running(bot: &HomeBot, id: &str) -> bool {
    bot.db
        .open()
        .ok()
        .and_then(|conn| store_chat::get_dispatch(&conn, id).ok().flatten())
        .is_some_and(|row| row.status == "running")
}

/// Gathers the material, starts the agent, waits for it and records the end.
fn run_worker(bot: &HomeBot, row: &DispatchRow) {
    super::material::prepare(bot, row);
    if !still_running(bot, &row.id) {
        // Stopped while the material was gathered.
        pump(bot);
        return;
    }
    let child = match launch(bot, row) {
        Ok(child) => child,
        Err(error) => {
            tracing::warn!(worker = %row.id, %error, "home bot: worker did not start");
            if let Ok(conn) = bot.db.open() {
                let _ = store_chat::set_status(&conn, &row.id, "failed", now_ms());
            }
            bot.after_worker(&row.chat_id);
            pump(bot);
            return;
        }
    };
    loop {
        let exited = match child.lock() {
            Ok(mut c) => !matches!(c.try_wait(), Ok(None)),
            Err(_) => true,
        };
        if exited {
            break;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    let was_tracked = running()
        .lock()
        .map(|mut r| r.remove(&row.id).is_some())
        .unwrap_or(false);
    if !was_tracked {
        // Stopped by the user: already recorded.
        return;
    }
    let status = match last_note(bot, row) {
        Ok(Some(note)) => finished_status(&note),
        _ => "failed",
    };
    if let Ok(conn) = bot.db.open() {
        let _ = store_chat::set_status(&conn, &row.id, status, now_ms());
    }
    bot.after_worker(&row.chat_id);
    pump(bot);
}

fn launch(bot: &HomeBot, row: &DispatchRow) -> Result<Arc<Mutex<TrackedChild>>> {
    let log = crate::agent_notes::notes_root(&bot.db)
        .join(format!(
            "{}-{}",
            match note_target_of(row) {
                NoteTarget::PullRequest => "pr",
                NoteTarget::WorkItem => "wi",
                NoteTarget::Ask => "ask",
            },
            row.ask_id
        ))
        .join(format!(".home-worker-{}.log", row.id));
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let child = bot.notes.run_agent_tracked(
        RunAgentInput {
            target: note_target_of(row),
            item_id: row.ask_id,
            repository_name: row.repository.clone(),
            agent: Some(if row.agent == "codex" {
                AgentKind::Codex
            } else {
                AgentKind::Claude
            }),
            model: row.model.clone(),
        },
        &log,
    )?;
    let child = Arc::new(Mutex::new(child));
    running()
        .lock()
        .map_err(|_| AppError::Database("worker lock poisoned".into()))?
        .insert(row.id.clone(), child.clone());
    Ok(child)
}

/// Done when the agent finished the note, Needs you when it replied last
/// without finishing (a question), Failed when it never replied.
pub(crate) fn finished_status(note: &AgentNote) -> &'static str {
    if note.status == "done" {
        return "done";
    }
    match note.replies.last() {
        Some(reply) if reply.author != "user" => "needs_you",
        _ => "failed",
    }
}

/// The note the worker answers in (by id; older rows without one take the newest).
pub(super) fn last_note(bot: &HomeBot, row: &DispatchRow) -> Result<Option<AgentNote>> {
    let notes = bot.notes.list(ListAgentNotesInput {
        target: note_target_of(row),
        item_id: row.ask_id,
    })?;
    Ok(match &row.note_id {
        Some(id) => notes.into_iter().find(|n| &n.id == id),
        None => notes
            .into_iter()
            .filter(|n| n.status != "draft")
            .max_by(|a, b| a.created_at.cmp(&b.created_at)),
    })
}

/// What the worker said last, for the Orchestrator's summary.
pub(crate) fn result_text(bot: &HomeBot, row: &DispatchRow) -> String {
    match last_note(bot, row) {
        Ok(Some(note)) => {
            let reply = note
                .replies
                .iter()
                .rev()
                .find(|r| r.author != "user")
                .map(|r| r.body.clone());
            match (reply, note.resolved) {
                (Some(reply), _) => reply,
                (None, Some(resolved)) => resolved,
                (None, None) => "(the worker did not reply)".into(),
            }
        }
        _ => "(the worker's note could not be read)".into(),
    }
}
