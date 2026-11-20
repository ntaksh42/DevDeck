//! Home Bot: Look around (a few read-only looks a day that list next steps)
//! and the Orchestrator chat (answers itself, hands code work to workers and
//! summarizes what they found). Claude Code or Codex, chosen in the Home
//! settings and per message.

mod chat;
mod dispatch;
mod look;
mod material;
mod runner;
mod schedule;
mod snapshot;
mod store;
mod store_chat;
mod turn;
mod types;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Local;

use crate::agent_notes::AgentNoteService;
use crate::db::AppDatabase;
use crate::error::{AppError, Result};
use runner::{ReadAgent, RunError, Tools};
pub use types::*;

const LOOK_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const TURN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const ARMED_KEY: &str = "home_bot_armed_at";
const SEEN_KEY: &str = "home_bot_seen_at";
const SINCE_KEY: &str = "home_bot_enabled_since";
const CHAT_MESSAGES: i64 = 200;

#[derive(Default)]
struct Runtime {
    looking: bool,
    turn_running: bool,
    /// Worker results arrived while a turn ran: summarize them after it.
    turn_pending: bool,
    turn_error: Option<String>,
    /// Agent and model of the last turn the user started; summaries reuse them.
    last_turn: Option<(String, Option<String>)>,
}

pub type Notifier = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone)]
pub struct HomeBot {
    db: AppDatabase,
    notes: AgentNoteService,
    /// Tells the frontend to refetch (`home:updated`); none in tests.
    notifier: Option<Notifier>,
    runtime: Arc<Mutex<Runtime>>,
}

impl HomeBot {
    pub fn new(db: AppDatabase, notifier: Option<Notifier>) -> Self {
        Self {
            notes: AgentNoteService::new(db.clone()),
            db,
            notifier,
            runtime: Arc::default(),
        }
    }

    /// Cleans up after the last exit and starts the schedule.
    pub fn start(&self) {
        if let Ok(conn) = self.db.open() {
            let now = now_ms();
            let _ = store::close_unfinished_runs(&conn, now);
            let _ = store_chat::fail_orphaned_workers(&conn, now);
        }
        let bot = self.clone();
        std::thread::spawn(move || loop {
            bot.tick();
            std::thread::sleep(Duration::from_secs(60));
        });
    }

    fn notify(&self) {
        if let Some(notify) = &self.notifier {
            notify();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Runtime> {
        self.runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // ── Look around ──────────────────────────────────────────────────────────

    fn tick(&self) {
        let Ok(conn) = self.db.open() else { return };
        let Ok(settings) = store::load_settings(&conn) else {
            return;
        };
        let armed = store::get_kv_ms(&conn, ARMED_KEY).ok().flatten();
        let since = store::get_kv_ms(&conn, SINCE_KEY).ok().flatten();
        let runs = store::recent_runs(&conn, 20).unwrap_or_default();
        if let Some(slot) = schedule::due_slot(&settings, armed, since, &runs, Local::now()) {
            let _ = self.begin_look("schedule", Some(slot));
        }
    }

    pub fn look_now(&self) -> Result<()> {
        self.begin_look("manual", None)
    }

    fn begin_look(&self, trigger: &str, slot: Option<i64>) -> Result<()> {
        {
            let mut rt = self.lock();
            if rt.looking {
                return Err(AppError::InvalidInput("Already looking around.".into()));
            }
            rt.looking = true;
        }
        let bot = self.clone();
        let trigger = trigger.to_string();
        std::thread::spawn(move || {
            if let Err(e) = bot.run_look(&trigger, slot) {
                tracing::warn!(error = ?e, "home bot: look failed to record");
            }
            bot.lock().looking = false;
            bot.notify();
        });
        self.notify();
        Ok(())
    }

    fn workspace(&self) -> Option<PathBuf> {
        self.db
            .get_app_settings()
            .ok()
            .and_then(|s| s.agent_workspace_path)
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
    }

    fn scratch_dir() -> Result<PathBuf> {
        let dir = std::env::temp_dir().join("devdeck-home-bot");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    fn run_look(&self, trigger: &str, slot: Option<i64>) -> Result<()> {
        let conn = self.db.open()?;
        let settings = store::load_settings(&conn)?;
        let model = Some(settings.model.as_str()).filter(|m| !m.is_empty());
        let now = now_ms();
        let run_id = store::begin_run(&conn, trigger, slot, &settings.agent, model, now)?;
        self.notify();
        let snapshot = snapshot::build(&self.db, chrono::Utc::now())?;
        let (open, started, dismissed) = store::history_titles(&conn, now)?;
        let workspace = self.workspace();
        let prompt = look::prompt(
            &snapshot,
            &settings.focus,
            &look::History {
                open,
                started,
                dismissed,
            },
            workspace.is_some(),
        );
        let work_dir = match &workspace {
            Some(dir) => dir.clone(),
            None => Self::scratch_dir()?,
        };
        let agent = ReadAgent::from_name(Some(&settings.agent));
        let outcome = runner::run(
            agent,
            model,
            Tools::ReadFiles,
            &work_dir,
            &prompt,
            LOOK_TIMEOUT,
        )
        .map_err(|e| {
            (
                e.message().to_string(),
                matches!(e, RunError::UsageLimited(_)),
            )
        })
        .and_then(|text| look::parse(&text, &snapshot).map_err(|e| (e, false)));
        let now = now_ms();
        match outcome {
            Ok(result) => {
                for suggestion in &result.suggestions {
                    store::suggest(&conn, run_id, suggestion, now)?;
                }
                store::settle_after_look(&conn, run_id, now)?;
                store::end_run(&conn, run_id, "ok", None, &result.brief, now)?;
            }
            Err((error, limited)) => {
                let outcome = if limited { "usage_limited" } else { "failed" };
                store::end_run(&conn, run_id, outcome, Some(&error), &[], now)?;
                let failures = store::failures_in_a_row(&store::recent_runs(&conn, 20)?);
                if failures >= schedule::FAILURES_TO_TURN_OFF {
                    let mut settings = store::load_settings(&conn)?;
                    settings.enabled = false;
                    store::save_settings(&conn, &settings)?;
                }
            }
        }
        Ok(())
    }

    // ── Views ────────────────────────────────────────────────────────────────

    pub fn view(&self) -> Result<HomeBotView> {
        let conn = self.db.open()?;
        let now = now_ms();
        store::expire(&conn, now)?;
        let settings = store::load_settings(&conn)?;
        let seen = store::get_kv_ms(&conn, SEEN_KEY)?.unwrap_or(0);
        let runs = store::recent_runs(&conn, 20)?;
        let last_ok = runs.iter().find(|r| r.outcome.as_deref() == Some("ok"));
        let last_ended = runs.iter().find(|r| r.ended_at.is_some());
        let suggestions = store::open_suggestions(&conn, seen)?;
        let look = HomeLookState {
            running: self.lock().looking,
            last_looked_at: last_ok.and_then(|r| r.ended_at).map(from_ms),
            took_ms: last_ok.and_then(|r| r.ended_at.map(|e| e - r.started_at)),
            next_at: schedule::next_slot(&settings, Local::now())
                .map(|d| d.with_timezone(&chrono::Utc)),
            error: last_ended
                .filter(|r| r.outcome.as_deref() != Some("ok"))
                .and_then(|r| r.error.clone()),
            failures_in_a_row: store::failures_in_a_row(&runs),
        };
        Ok(HomeBotView {
            new_count: suggestions.iter().filter(|s| s.is_new).count() as i64,
            brief: last_ok.map(|r| r.brief.clone()).unwrap_or_default(),
            settings,
            look,
            suggestions,
        })
    }

    /// The user opened Home: its suggestions are no longer new. The first time
    /// also arms the schedule, so nothing runs before Home was opened once.
    pub fn mark_seen(&self) -> Result<()> {
        let conn = self.db.open()?;
        let now = now_ms();
        if store::get_kv_ms(&conn, ARMED_KEY)?.is_none() {
            store::set_kv(&conn, ARMED_KEY, &now.to_string())?;
        }
        store::set_kv(&conn, SEEN_KEY, &now.to_string())?;
        self.notify();
        Ok(())
    }

    pub fn dismiss(&self, id: &str) -> Result<()> {
        store::resolve(&self.db.open()?, id, "dismissed", now_ms())?;
        self.notify();
        Ok(())
    }

    /// The suggestion's request and target, for Start to put in the input.
    pub fn suggestion_ask(&self, id: &str) -> Result<HomeSuggestionAsk> {
        store::get_ask(&self.db.open()?, id)?
            .ok_or_else(|| AppError::InvalidInput("That suggestion is no longer listed.".into()))
    }

    pub fn clear_dismissed(&self) -> Result<()> {
        store::clear_dismissed(&self.db.open()?)?;
        self.notify();
        Ok(())
    }

    pub fn dismissed_count(&self) -> Result<i64> {
        store::dismissed_count(&self.db.open()?)
    }

    pub fn save_settings(&self, input: HomeBotSettings) -> Result<HomeBotSettings> {
        if !EVERY_CHOICES.contains(&input.every.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "unknown schedule: {}",
                input.every
            )));
        }
        if input.agent != "claude" && input.agent != "codex" {
            return Err(AppError::InvalidInput(format!(
                "unknown agent: {}",
                input.agent
            )));
        }
        let model = input.model.trim().to_string();
        if !model.is_empty() && !crate::agent_notes::launch::is_plain_model_name(&model) {
            return Err(AppError::InvalidInput(format!(
                "invalid model name: {model}"
            )));
        }
        let conn = self.db.open()?;
        let previous = store::load_settings(&conn)?;
        let settings = HomeBotSettings {
            focus: input.focus.trim().chars().take(FOCUS_MAX_CHARS).collect(),
            model,
            ..input
        };
        if settings.enabled && !previous.enabled {
            // A slot from before it was turned on is never caught up.
            store::set_kv(&conn, SINCE_KEY, &now_ms().to_string())?;
        }
        store::save_settings(&conn, &settings)?;
        self.notify();
        Ok(settings)
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
