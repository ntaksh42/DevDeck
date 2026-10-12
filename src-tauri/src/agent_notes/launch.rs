//! Starts the user's agent command (Settings) for one item's notes, so a note
//! can be handed over without switching to a terminal.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

use super::{notes_dir, NoteTarget};
use crate::error::{AppError, Result};

const GUIDE_FILE: &str = "AGENTS.md";
/// Used when Settings has no Claude Code command, so the agent works out of the
/// box: Claude Code in the background, allowed into the notes folder (outside
/// the folder it starts in) and without permission prompts, which nobody could
/// answer. The prompt comes before `--add-dir`, which takes several values.
const DEFAULT_CLAUDE_COMMAND: &str = "claude -p \"Read {guide} and handle the open notes in {notes}\" --add-dir \"{notes}\" --disallowedTools \"Bash(az:*)\" \"Bash(git push:*)\" --dangerously-skip-permissions";
/// The same for Codex: non-interactive, also outside a git repository (the
/// result folder), and sandboxed to writing only the folder it starts in and
/// the notes folder. Azure CLI and `git push` are blocked by the environment
/// below, as for Claude Code.
const DEFAULT_CODEX_COMMAND: &str = "codex exec --skip-git-repo-check --sandbox workspace-write --add-dir \"{notes}\" \"Read {guide} and handle the open notes in {notes}\"";
/// Empty Azure CLI config folder (under the notes root) the agent starts with,
/// so `az` is signed out: the agent reads what DevDeck gathered instead of
/// reaching Azure DevOps with the user's credentials.
const ISOLATED_AZ_DIR: &str = ".az-signed-out";
/// Variables through which Azure DevOps tooling picks up a token.
/// Remote URL prefixes whose pushes are rewritten (`url.<x>.pushInsteadOf`)
/// to a transport git does not have, so `git push` fails while fetching with
/// the user's stored credentials still works for reading a clone.
const BLOCKED_PUSH_PREFIXES: [&str; 3] = ["https://", "ssh://", "git@"];
const BLOCKED_PUSH_URL: &str = "devdeck-push-blocked://";
const AZURE_TOKEN_VARS: [&str; 3] = [
    "AZURE_DEVOPS_EXT_PAT",
    "SYSTEM_ACCESSTOKEN",
    "AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY",
];

/// Which coding agent a request is handed to.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    #[default]
    Claude,
    Codex,
}

impl AgentKind {
    /// The stored `default_agent` setting: `codex`, anything else Claude Code.
    pub(crate) fn from_setting(value: Option<&str>) -> Self {
        if value == Some("codex") {
            Self::Codex
        } else {
            Self::Claude
        }
    }

    fn default_command(self) -> &'static str {
        match self {
            Self::Claude => DEFAULT_CLAUDE_COMMAND,
            Self::Codex => DEFAULT_CODEX_COMMAND,
        }
    }

    fn model_flag(self) -> &'static str {
        match self {
            Self::Claude => "--model",
            Self::Codex => "-m",
        }
    }
}

/// A model name is appended to a shell command, so only the characters model
/// names use (`claude-opus-4-1`, `opus[1m]`, `gpt-5.1`, `org/model:tag`) pass.
fn is_plain_model_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/[]-".contains(c))
}

/// Where the agent runs and what the command placeholders resolve to.
pub(crate) struct AgentLaunch<'a> {
    /// The result folder of the item's target (holds the guide).
    pub result_folder: &'a Path,
    /// Where every item's notes live (see [`super::notes_root`]).
    pub notes_root: &'a Path,
    /// The single folder holding repository clones, when configured.
    pub workspace: Option<&'a Path>,
    /// Model passed to the agent (`--model` / `-m`, appended to the command);
    /// unset, the agent's own configured model.
    pub model: Option<&'a str>,
    /// Name of the pull request's repository, to pick its clone.
    pub repository: Option<&'a str>,
}

impl AgentLaunch<'_> {
    /// The clone of the repository inside the workspace when there is one, else
    /// the workspace itself, else the result folder. DevDeck never clones or
    /// checks out anything; the folder is only where the agent starts.
    pub(crate) fn work_dir(&self) -> PathBuf {
        let Some(workspace) = self.workspace else {
            return self.result_folder.to_path_buf();
        };
        if let Some(clone) = self
            .repository
            .filter(|name| is_plain_folder_name(name))
            .map(|name| workspace.join(name))
            .filter(|candidate| candidate.is_dir())
        {
            return clone;
        }
        workspace.to_path_buf()
    }
}

/// A repository name becomes a path segment, so it must not be able to leave
/// the workspace (`..`, separators, drive prefixes).
fn is_plain_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

/// Folders an agent was started in and has not exited yet: two agents editing
/// the same working tree would collide.
fn running_dirs() -> &'static Mutex<HashSet<PathBuf>> {
    static RUNNING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Placeholders in the command: `{target}` (`work-item` / `pull-request`),
/// `{id}` (item id), `{notes}` (the item's notes folder), `{workspace}` (the
/// workspace folder, empty when unset), `{repo}` (the repository name, empty
/// for work items) and `{guide}` (the agent guide in the result folder). The
/// command runs through the system shell in [`AgentLaunch::work_dir`] and is
/// not waited on by the caller.
pub(crate) fn run_agent(
    launch: &AgentLaunch<'_>,
    agent: AgentKind,
    command: Option<&str>,
    target: NoteTarget,
    item_id: i64,
) -> Result<()> {
    let command = expand(agent, command, launch, target, item_id)?;
    let work_dir = launch.work_dir();

    {
        let mut running = running_dirs()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !running.insert(work_dir.clone()) {
            return Err(AppError::InvalidInput(format!(
                "An agent is already running in {}",
                work_dir.display()
            )));
        }
    }

    let az_dir = launch.notes_root.join(ISOLATED_AZ_DIR);
    std::fs::create_dir_all(&az_dir)?;
    let mut cmd = shell_command(&command);
    cmd.env("AZURE_CONFIG_DIR", &az_dir);
    // Git config entries given to this process only (GIT_CONFIG_COUNT/KEY/VALUE).
    cmd.env("GIT_CONFIG_COUNT", BLOCKED_PUSH_PREFIXES.len().to_string());
    for (index, prefix) in BLOCKED_PUSH_PREFIXES.iter().enumerate() {
        cmd.env(
            format!("GIT_CONFIG_KEY_{index}"),
            format!("url.{BLOCKED_PUSH_URL}.pushInsteadOf"),
        );
        cmd.env(format!("GIT_CONFIG_VALUE_{index}"), prefix);
    }
    for var in AZURE_TOKEN_VARS {
        cmd.env_remove(var);
    }
    let spawned = cmd
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        Ok(mut child) => {
            // The command is not waited on by the request, but something has
            // to reap it and free the folder once it exits.
            std::thread::spawn(move || {
                let _ = child.wait();
                running_dirs()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(&work_dir);
            });
            Ok(())
        }
        Err(e) => {
            running_dirs()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&work_dir);
            Err(e.into())
        }
    }
}

/// The system shell running `command`. On Windows the string is handed to
/// `cmd` verbatim: `Command::arg` would re-escape its `"` as `\"`, which
/// cmd.exe does not understand, so a quoted argument such as
/// `claude -p "handle {id}"` would be split apart. `/S` plus the outer quotes
/// makes cmd strip exactly that pair and keep the rest as written.
fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.args(["/S", "/C"]).raw_arg(format!("\"{command}\""));
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
}

fn expand(
    agent: AgentKind,
    command: Option<&str>,
    launch: &AgentLaunch<'_>,
    target: NoteTarget,
    item_id: i64,
) -> Result<String> {
    let command = command
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or(agent.default_command());
    let notes = notes_dir(launch.notes_root, target, item_id);
    let guide = launch.result_folder.join(GUIDE_FILE);
    let workspace = launch
        .workspace
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    // An unsafe repository name is dropped from the command as well as from
    // the folder lookup, so it can never reach the shell.
    let repo = launch
        .repository
        .filter(|name| is_plain_folder_name(name))
        .unwrap_or_default();
    let mut command = command
        .replace("{target}", target.as_str())
        .replace("{id}", &item_id.to_string())
        .replace("{notes}", &notes.display().to_string())
        .replace("{workspace}", &workspace)
        .replace("{repo}", repo)
        .replace("{guide}", &guide.display().to_string());
    if let Some(model) = launch.model {
        if !is_plain_model_name(model) {
            return Err(AppError::InvalidInput(format!(
                "invalid model name: {model}"
            )));
        }
        command = format!("{command} {} \"{model}\"", agent.model_flag());
    }
    Ok(command)
}

#[cfg(test)]
#[path = "tests_launch.rs"]
mod tests;
