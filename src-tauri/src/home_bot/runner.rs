//! Runs Claude Code or Codex read-only for one Look around or one Orchestrator
//! turn, and returns its final message.
//!
//! The material comes from other people (PR titles, comments), so the run is
//! held to reads by how it is started, not by asking the model: Claude Code
//! gets `--restricted --strict-mcp-config` and at most Read / Grep / Glob,
//! Codex runs in its `read-only` sandbox (no writes, no network). Neither gets
//! Azure DevOps credentials.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::agent_notes::launch::{is_plain_model_name, shell_command, AZURE_TOKEN_VARS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadAgent {
    Claude,
    Codex,
}

impl ReadAgent {
    pub(crate) fn from_name(name: Option<&str>) -> Self {
        if name == Some("codex") {
            Self::Codex
        } else {
            Self::Claude
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

/// Whether the run may read files in its folder (Look around in the workspace)
/// or gets no tools at all (an Orchestrator turn: everything is in its prompt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tools {
    ReadFiles,
    None,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RunError {
    /// The agent's usage limit stopped it; not counted as a failure.
    UsageLimited(String),
    Failed(String),
}

impl RunError {
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::UsageLimited(m) | Self::Failed(m) => m,
        }
    }
}

const CLAUDE_FLAGS: &str = "--output-format json --restricted --strict-mcp-config";
const CLAUDE_READ_TOOLS: &str = "--tools \"Read,Grep,Glob\" --allowedTools \"Read,Grep,Glob\"";
const CLAUDE_NO_TOOLS: &str = "--tools \"\"";

pub(crate) fn command_line(
    agent: ReadAgent,
    model: Option<&str>,
    tools: Tools,
    last_message: &Path,
) -> String {
    let model = model.filter(|m| is_plain_model_name(m));
    match agent {
        ReadAgent::Claude => {
            let tools = match tools {
                Tools::ReadFiles => CLAUDE_READ_TOOLS,
                Tools::None => CLAUDE_NO_TOOLS,
            };
            let model = model
                .map(|m| format!(" --model \"{m}\""))
                .unwrap_or_default();
            format!("claude -p{model} {CLAUDE_FLAGS} {tools}")
        }
        ReadAgent::Codex => {
            let model = model.map(|m| format!(" -m \"{m}\"")).unwrap_or_default();
            format!(
                "codex exec --skip-git-repo-check --sandbox read-only --color never --output-last-message \"{}\"{model} -",
                last_message.display()
            )
        }
    }
}

/// Runs `prompt` in `work_dir` and returns the agent's final message.
pub(crate) fn run(
    agent: ReadAgent,
    model: Option<&str>,
    tools: Tools,
    work_dir: &Path,
    prompt: &str,
    timeout: Duration,
) -> Result<String, RunError> {
    let failed = |e: String| RunError::Failed(e);
    let last_message = scratch_file(agent)?;
    let mut cmd = shell_command(&command_line(agent, model, tools, &last_message));
    for var in AZURE_TOKEN_VARS {
        cmd.env_remove(var);
    }
    let mut child = cmd
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| failed(format!("could not start {}: {e}", agent.name())))?;
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(prompt.as_bytes()) {
            let _ = child.kill();
            return Err(failed(e.to_string()));
        }
    }
    // Read on other threads so a full pipe cannot stall the wait below.
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| failed("no stdout".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| failed("no stderr".into()))?;
    let out_reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let err_reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stderr.read_to_string(&mut out);
        out
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| failed(e.to_string()))? {
            Some(status) => break status,
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                return Err(failed(format!(
                    "{} did not finish within {} minutes",
                    agent.name(),
                    timeout.as_secs() / 60
                )));
            }
            None => std::thread::sleep(Duration::from_millis(500)),
        }
    };
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    let result = match agent {
        ReadAgent::Claude => parse_claude(&stdout),
        ReadAgent::Codex => {
            let text = std::fs::read_to_string(&last_message).unwrap_or_default();
            let _ = std::fs::remove_file(&last_message);
            if status.success() && !text.trim().is_empty() {
                Ok(text)
            } else {
                Err(classify(&format!("{stderr}\n{stdout}")))
            }
        }
    };
    result.map(|text| text.trim().to_string())
}

fn scratch_file(agent: ReadAgent) -> Result<PathBuf, RunError> {
    let dir = std::env::temp_dir().join("devdeck-home-bot");
    std::fs::create_dir_all(&dir).map_err(|e| RunError::Failed(e.to_string()))?;
    Ok(dir.join(format!(
        "{}-{}-{}.txt",
        agent.name(),
        std::process::id(),
        super::store::next_id("m", super::types::now_ms())
    )))
}

#[derive(Deserialize)]
struct ClaudeResult {
    result: Option<String>,
    #[serde(default)]
    is_error: bool,
}

/// `claude -p --output-format json` prints `{ "result": "<text>", "is_error": … }`.
pub(crate) fn parse_claude(output: &str) -> Result<String, RunError> {
    let cli: ClaudeResult = serde_json::from_str(output.trim()).map_err(|_| classify(output))?;
    let text = cli.result.unwrap_or_default();
    if cli.is_error || text.trim().is_empty() {
        return Err(classify(&text));
    }
    Ok(text)
}

fn classify(text: &str) -> RunError {
    let lower = text.to_lowercase();
    let short: String = text.trim().chars().take(300).collect();
    let short = if short.is_empty() {
        "the agent returned nothing".to_string()
    } else {
        short
    };
    if lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("limit reached")
    {
        RunError::UsageLimited(short)
    } else {
        RunError::Failed(short)
    }
}

/// The JSON object inside a reply (possibly in a code fence after prose).
pub(crate) fn json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (start < end).then(|| &text[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_runs_locked_down() {
        let line = command_line(
            ReadAgent::Claude,
            Some("sonnet"),
            Tools::ReadFiles,
            Path::new("x"),
        );
        assert!(line.starts_with("claude -p --model \"sonnet\""));
        assert!(line.contains("--restricted"));
        assert!(line.contains("--strict-mcp-config"));
        assert!(line.contains("--tools \"Read,Grep,Glob\""));
        assert!(!line.contains("dangerously"));
        let none = command_line(ReadAgent::Claude, None, Tools::None, Path::new("x"));
        assert!(none.ends_with("--tools \"\""));
    }

    #[test]
    fn codex_runs_in_the_read_only_sandbox() {
        let line = command_line(
            ReadAgent::Codex,
            Some("gpt-5.1"),
            Tools::ReadFiles,
            Path::new("out.txt"),
        );
        assert!(line.contains("--sandbox read-only"));
        assert!(line.contains("--output-last-message \"out.txt\""));
        assert!(line.contains("-m \"gpt-5.1\""));
        assert!(line.ends_with(" -"));
        assert!(!line.contains("workspace-write"));
    }

    #[test]
    fn drops_a_model_name_that_could_reach_the_shell() {
        let line = command_line(
            ReadAgent::Claude,
            Some("x\" & del"),
            Tools::None,
            Path::new("x"),
        );
        assert!(!line.contains("del"));
    }

    #[test]
    fn reads_claude_results_and_usage_limits() {
        assert_eq!(
            parse_claude(r#"{"result":"hi","is_error":false}"#).unwrap(),
            "hi"
        );
        assert!(matches!(
            parse_claude(r#"{"result":"Claude usage limit reached","is_error":true}"#),
            Err(RunError::UsageLimited(_))
        ));
        assert!(matches!(parse_claude("garbage"), Err(RunError::Failed(_))));
    }

    #[test]
    fn finds_the_json_object() {
        assert_eq!(
            json_object("text ```json\n{\"a\":1}\n```"),
            Some("{\"a\":1}")
        );
        assert_eq!(json_object("none"), None);
    }
}
