//! Shapes the Home view reads over IPC.

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

/// Look around and Orchestrator settings, stored as one JSON value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct HomeBotSettings {
    /// Look around on a schedule. Look now and the chat work either way.
    pub enabled: bool,
    /// `every-4h` / `every-2h` / `twice-daily` / `mornings`.
    pub every: String,
    pub weekdays_only: bool,
    /// What to look for, in the user's words; empty means the default focus.
    pub focus: String,
    /// `claude` or `codex`: who looks around and who answers in the chat.
    pub agent: String,
    /// Empty leaves the model to the agent's own setting.
    pub model: String,
}

impl Default for HomeBotSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            every: "twice-daily".into(),
            weekdays_only: true,
            focus: String::new(),
            agent: "claude".into(),
            model: "sonnet".into(),
        }
    }
}

pub const EVERY_CHOICES: [&str; 4] = ["every-4h", "every-2h", "twice-daily", "mornings"];
pub const FOCUS_MAX_CHARS: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeSuggestion {
    pub id: String,
    pub title: String,
    pub why: String,
    /// The message Start puts in the Orchestrator's input.
    pub ask: String,
    /// `pr:{org}/{repoId}/{id}`, `wi:{org}/{id}`, or none.
    pub target: Option<String>,
    /// `!798`, `#4521`.
    pub target_label: Option<String>,
    pub web_url: Option<String>,
    /// `pr` / `wi` / `other`, for the row's mark.
    pub kind: String,
    pub is_new: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HomeLookState {
    pub running: bool,
    pub last_looked_at: Option<DateTime<Utc>>,
    pub took_ms: Option<i64>,
    pub next_at: Option<DateTime<Utc>>,
    /// Why the last look failed; its older suggestions stay listed.
    pub error: Option<String>,
    pub failures_in_a_row: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeBotView {
    pub settings: HomeBotSettings,
    pub look: HomeLookState,
    pub brief: Vec<String>,
    pub suggestions: Vec<HomeSuggestion>,
    pub new_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeChatMessage {
    pub id: i64,
    /// `user`, `orchestrator`, or `system` (DevDeck's own notes, e.g. a refused dispatch).
    pub author: String,
    pub body: String,
    pub worker_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeWorker {
    pub id: String,
    pub target_label: String,
    /// The first line of what it was asked.
    pub title: String,
    pub agent: String,
    pub model: Option<String>,
    /// `queued` / `running` / `needs_you` / `done` / `failed` / `stopped`.
    pub status: String,
    /// The id of the conversation it works in: `ask-{id}`, or the pull
    /// request / work item id when it works in that item's notes.
    pub ask_id: i64,
    /// `ask`, `pull-request` or `work-item`.
    pub note_target: String,
    /// The item, for opening its conversation in the Agent panel (PR / WI notes).
    pub subject: Option<WorkerSubject>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerSubject {
    /// `pull-request` or `work-item`.
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub organization_id: String,
    pub project_id: String,
    pub repository_id: Option<String>,
    pub repository_name: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeChatView {
    pub chat_id: String,
    pub messages: Vec<HomeChatMessage>,
    pub workers: Vec<HomeWorker>,
    /// `idle` / `thinking` / `waiting`.
    pub state: String,
    pub waiting_on: i64,
    /// Why the last Orchestrator turn failed.
    pub error: Option<String>,
}

/// What Start puts in the Orchestrator's input.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeSuggestionAsk {
    pub ask: String,
    pub target: Option<String>,
    pub target_label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendHomeMessageInput {
    pub text: String,
    /// The target chip on the input, e.g. from a suggestion's Start.
    pub target: Option<String>,
    pub suggestion_id: Option<String>,
    /// `claude` / `codex` for this turn; unset uses the Home settings.
    pub agent: Option<String>,
    /// Empty leaves the model to the agent's own setting.
    pub model: Option<String>,
}

pub(crate) fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub(crate) fn from_ms(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms).single().unwrap_or_default()
}
