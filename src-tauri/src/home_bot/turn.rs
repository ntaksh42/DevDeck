//! The Orchestrator chat: the user's turns, the workers they start, and the
//! summaries of what the workers found.

use super::types::{now_ms, HomeChatView, HomeWorker, SendHomeMessageInput};
use super::{
    chat, dispatch, runner, snapshot, store, store_chat, HomeBot, CHAT_MESSAGES, TURN_TIMEOUT,
};
use crate::error::{AppError, Result};
use runner::{ReadAgent, Tools};

impl HomeBot {
    pub fn chat_view(&self) -> Result<HomeChatView> {
        let conn = self.db.open()?;
        let chat_id = store_chat::current_chat(&conn, now_ms())?;
        let rows = store_chat::dispatches(&conn, &chat_id)?;
        let waiting_on = rows.iter().filter(|r| r.is_active()).count() as i64;
        let rt = self.lock();
        let state = if rt.turn_running {
            "thinking"
        } else if waiting_on > 0 {
            "waiting"
        } else {
            "idle"
        };
        Ok(HomeChatView {
            messages: store_chat::messages(&conn, &chat_id, CHAT_MESSAGES)?,
            workers: rows
                .iter()
                .map(|r| HomeWorker {
                    subject: super::material::worker_subject(&conn, r),
                    ..r.view()
                })
                .collect(),
            state: state.into(),
            waiting_on,
            error: rt.turn_error.clone(),
            chat_id,
        })
    }

    pub fn new_chat(&self) -> Result<String> {
        if self.lock().turn_running {
            return Err(AppError::InvalidInput(
                "Wait for the Orchestrator to finish its reply.".into(),
            ));
        }
        let chat = store_chat::new_chat(&self.db.open()?, now_ms())?;
        self.notify();
        Ok(chat)
    }

    pub fn send_message(&self, input: SendHomeMessageInput) -> Result<()> {
        let text = input.text.trim().to_string();
        if text.is_empty() {
            return Err(AppError::InvalidInput("Write a message first.".into()));
        }
        {
            let mut rt = self.lock();
            if rt.turn_running {
                return Err(AppError::InvalidInput(
                    "The Orchestrator is still replying.".into(),
                ));
            }
            rt.turn_running = true;
            rt.turn_error = None;
        }
        let agent = match input.agent.as_deref() {
            Some("codex") => "codex".to_string(),
            Some("claude") => "claude".to_string(),
            _ => store::load_settings(&self.db.open()?)?.agent,
        };
        let model = match input.model {
            Some(m) => Some(m.trim().to_string()).filter(|m| !m.is_empty()),
            None => Some(store::load_settings(&self.db.open()?)?.model).filter(|m| !m.is_empty()),
        };
        let result = (|| -> Result<String> {
            let conn = self.db.open()?;
            let now = now_ms();
            let chat_id = store_chat::current_chat(&conn, now)?;
            store_chat::add_message(&conn, &chat_id, "user", &text, &[], now)?;
            if let Some(id) = &input.suggestion_id {
                store::resolve(&conn, id, "started", now)?;
            }
            Ok(chat_id)
        })();
        let chat_id = match result {
            Ok(chat_id) => chat_id,
            Err(e) => {
                self.lock().turn_running = false;
                return Err(e);
            }
        };
        self.lock().last_turn = Some((agent.clone(), model.clone()));
        let bot = self.clone();
        let turn = chat::TurnInput::Message {
            text,
            target: input.target,
        };
        std::thread::spawn(move || bot.run_turn(&chat_id, turn, &agent, model.as_deref()));
        self.notify();
        Ok(())
    }

    pub fn stop_worker(&self, id: &str) -> Result<()> {
        dispatch::stop(self, id)
    }

    /// A worker ended: summarize its result now, or after the running turn.
    pub(super) fn after_worker(&self, chat_id: &str) {
        self.notify();
        {
            let mut rt = self.lock();
            if rt.turn_running {
                rt.turn_pending = true;
                return;
            }
            rt.turn_running = true;
        }
        let bot = self.clone();
        let chat_id = chat_id.to_string();
        std::thread::spawn(move || bot.summarize_results(&chat_id));
    }

    pub(super) fn summarize_results(&self, chat_id: &str) {
        let results = self
            .db
            .open()
            .and_then(|conn| store_chat::pending_results(&conn, chat_id))
            .unwrap_or_default();
        if results.is_empty() {
            self.lock().turn_running = false;
            self.notify();
            return;
        }
        let texts = results
            .iter()
            .map(|row| (row.clone(), dispatch::result_text(self, row)))
            .collect();
        let (agent, model) = self.lock().last_turn.clone().unwrap_or_else(|| {
            let settings = self
                .db
                .open()
                .and_then(|c| store::load_settings(&c))
                .unwrap_or_default();
            (
                settings.agent,
                Some(settings.model).filter(|m| !m.is_empty()),
            )
        });
        if let Ok(conn) = self.db.open() {
            let ids: Vec<String> = results.iter().map(|r| r.id.clone()).collect();
            let _ = store_chat::mark_reported(&conn, &ids);
        }
        self.run_turn(
            chat_id,
            chat::TurnInput::Results(texts),
            &agent,
            model.as_deref(),
        );
    }

    /// Runs one turn (turn_running is already set) and records the reply.
    pub(super) fn run_turn(
        &self,
        chat_id: &str,
        input: chat::TurnInput,
        agent: &str,
        model: Option<&str>,
    ) {
        let summarizing = matches!(input, chat::TurnInput::Results(_));
        let outcome = (|| -> std::result::Result<(String, Vec<String>, Vec<String>), String> {
            let conn = self.db.open().map_err(|e| e.to_string())?;
            let snapshot =
                snapshot::build(&self.db, chrono::Utc::now()).map_err(|e| e.to_string())?;
            let messages =
                store_chat::messages(&conn, chat_id, CHAT_MESSAGES).map_err(|e| e.to_string())?;
            let rows = store_chat::dispatches(&conn, chat_id).map_err(|e| e.to_string())?;
            let prompt = chat::prompt(&snapshot, &messages, &rows, &input);
            let work_dir = Self::scratch_dir().map_err(|e| e.to_string())?;
            let text = runner::run(
                ReadAgent::from_name(Some(agent)),
                model,
                Tools::None,
                &work_dir,
                &prompt,
                TURN_TIMEOUT,
            )
            .map_err(|e| e.message().to_string())?;
            let (visible, ops, parse_note) = chat::parse_reply(&text);
            let mut notes: Vec<String> = parse_note.into_iter().collect();
            let mut started = Vec::new();
            let mut starts = 0;
            for op in ops {
                match op {
                    chat::DispatchOp::Start {
                        target,
                        spec,
                        agent: op_agent,
                    } => {
                        if summarizing || starts >= chat::STARTS_PER_TURN {
                            notes.push("A worker was not started: too many in one reply.".into());
                            continue;
                        }
                        let target = match target
                            .as_deref()
                            .map(str::trim)
                            .filter(|t| !t.is_empty() && *t != "null" && *t != "ask")
                        {
                            Some(key) => {
                                match snapshot.target(key) {
                                    Some(t) => Some(t.clone()),
                                    None => {
                                        notes.push(format!("A worker was not started: {key} is not in the overview."));
                                        continue;
                                    }
                                }
                            }
                            None => None,
                        };
                        if let Some(t) = &target {
                            if let Ok(Some(active)) =
                                store_chat::active_on_target(&conn, chat_id, &t.key)
                            {
                                notes.push(format!(
                                    "{} already has worker {}; nothing new was started.",
                                    t.label, active.id
                                ));
                                continue;
                            }
                        }
                        let worker_agent = match op_agent.as_deref() {
                            Some("codex") => "codex",
                            Some("claude") => "claude",
                            _ => agent,
                        };
                        match dispatch::create(
                            self,
                            chat_id,
                            target.as_ref(),
                            &spec,
                            worker_agent,
                            model,
                        ) {
                            Ok(id) => {
                                starts += 1;
                                started.push(id);
                            }
                            Err(e) => notes.push(format!("A worker was not started: {e}")),
                        }
                    }
                    chat::DispatchOp::Send { dispatch: id, text } => {
                        if let Err(e) = dispatch::send(self, &id, &text) {
                            notes.push(format!("Could not message worker {id}: {e}"));
                        }
                    }
                    chat::DispatchOp::Stop { dispatch: id } => {
                        if let Err(e) = dispatch::stop(self, &id) {
                            notes.push(format!("Could not stop worker {id}: {e}"));
                        }
                    }
                }
            }
            Ok((visible, started, notes))
        })();
        let now = now_ms();
        match (outcome, self.db.open()) {
            (Ok((visible, started, notes)), Ok(conn)) => {
                let body = if visible.is_empty() && !started.is_empty() {
                    "worker に渡した。".to_string()
                } else {
                    visible
                };
                let _ =
                    store_chat::add_message(&conn, chat_id, "orchestrator", &body, &started, now);
                for note in notes {
                    let _ = store_chat::add_message(&conn, chat_id, "system", &note, &[], now);
                }
            }
            (Err(error), _) => self.lock().turn_error = Some(error),
            (_, Err(e)) => self.lock().turn_error = Some(e.to_string()),
        }
        let again = {
            let mut rt = self.lock();
            let again = rt.turn_pending;
            rt.turn_pending = false;
            rt.turn_running = again;
            again
        };
        self.notify();
        if again {
            self.summarize_results(chat_id);
        }
    }
}
