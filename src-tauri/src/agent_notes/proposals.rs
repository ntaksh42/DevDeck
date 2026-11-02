//! Comments an agent proposes to leave on a work item or pull request. The
//! agent has no Azure DevOps access, so it appends the text to the note after
//! a `<!-- post {agent} {time} -->` marker and DevDeck posts it, either when
//! the user approves it or, if Settings allows, on its own. Every posted
//! comment ends with a signature naming the agent that wrote it, added here
//! and never taken from the agent's text. DevDeck then records the result as
//! `<!-- posted {time} {reference} -->` under the proposal, so it can only be
//! posted once, and appends it to `post-log.jsonl` in the notes root, which
//! limits how fast automatic posts may follow each other.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Duration, Local};
use serde::Deserialize;
use serde_json::json;

use super::format::{parse_note, write_atomic};
use super::replies::{is_marker, is_reply_marker};
use super::{notes_dir, validate_id, validate_note_id, AgentNoteService, NoteTarget, DONE_DIR};
use crate::error::{AppError, Result};

const LOG_FILE: &str = "post-log.jsonl";
const MAX_COMMENT_CHARS: usize = 10_000;
/// Automatic posts allowed per hour, on one item and in total.
const AUTO_PER_ITEM_PER_HOUR: usize = 3;
const AUTO_PER_HOUR: usize = 10;
const SIGNATURE_PREFIX: &str = "— 🤖 Posted by ";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostAgentProposalInput {
    pub target: NoteTarget,
    pub item_id: i64,
    pub note_id: String,
    /// Index of the `post` reply among the note's replies.
    pub reply_index: usize,
    /// Posted by DevDeck without the user approving this one comment.
    #[serde(default)]
    pub auto: bool,
}

fn in_flight() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Holds one proposal while it is being posted, so a double press cannot post
/// it twice; released when dropped.
pub(crate) struct PostGuard(String);

impl Drop for PostGuard {
    fn drop(&mut self) {
        in_flight()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.0);
    }
}

/// A proposal that passed every check, ready to post.
pub(crate) struct PreparedPost {
    /// The comment with the agent's signature appended.
    pub body: String,
    /// For a pull request line comment: the file and the 1-based line on the new side.
    pub location: Option<(String, i64)>,
    input: PostAgentProposalInput,
    agent: String,
    hash: u64,
    _guard: PostGuard,
}

pub(crate) fn agent_label(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" => Some("Claude"),
        "codex" => Some("Codex"),
        _ => None,
    }
}

pub(crate) fn signature(label: &str) -> String {
    format!("{SIGNATURE_PREFIX}{label} (via DevDeck)")
}

/// The proposal text without a signature the agent may have written itself.
fn strip_signature(body: &str) -> &str {
    let body = body.trim();
    match body.rsplit_once('\n') {
        Some((rest, last)) if last.trim().starts_with(SIGNATURE_PREFIX) => rest.trim_end(),
        _ => body,
    }
}

/// FNV-1a: only compares texts within the log, so it needs no stability
/// guarantee beyond this build.
fn text_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// Longest file path accepted in a proposal's `file=`.
const MAX_PATH_CHARS: usize = 1_000;

/// The file and line a proposal is about, checked. `None` for a plain comment.
fn proposal_location(
    target: NoteTarget,
    auto: bool,
    file_path: Option<&str>,
    line: Option<i64>,
) -> Result<Option<(String, i64)>> {
    let (file_path, line) = match (file_path, line) {
        (None, None) => return Ok(None),
        (Some(file_path), Some(line)) => (file_path, line),
        _ => {
            return Err(AppError::InvalidInput(
                "a line comment needs both file= and line=".to_string(),
            ))
        }
    };
    let valid_path = file_path.starts_with('/')
        && file_path.chars().count() <= MAX_PATH_CHARS
        && !file_path.chars().any(char::is_control)
        && !file_path.split('/').any(|segment| segment == "..");
    if !valid_path || line < 1 {
        return Err(AppError::InvalidInput(
            "the proposed comment's file or line is not valid".to_string(),
        ));
    }
    if target != NoteTarget::PullRequest {
        return Err(AppError::InvalidInput(
            "a line comment can only be posted to a pull request".to_string(),
        ));
    }
    if auto {
        return Err(AppError::InvalidInput(
            "a line comment needs your approval".to_string(),
        ));
    }
    Ok(Some((file_path.to_string(), line)))
}

/// Automatic posts must not carry anything a hostile pull request could use to
/// make the agent reach out: links and @-mentions go through the user.
fn check_auto_content(body: &str) -> Result<()> {
    if body.contains("http://") || body.contains("https://") || body.contains('@') {
        return Err(AppError::InvalidInput(
            "a comment with a link or @mention needs your approval".to_string(),
        ));
    }
    Ok(())
}

struct LogEntry {
    at: DateTime<Local>,
    target: String,
    item_id: i64,
    hash: u64,
    auto: bool,
}

fn read_log(root: &Path) -> Vec<LogEntry> {
    let Ok(text) = fs::read_to_string(root.join(LOG_FILE)) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|value| {
            Some(LogEntry {
                at: DateTime::parse_from_rfc3339(value["at"].as_str()?)
                    .ok()?
                    .with_timezone(&Local),
                target: value["target"].as_str()?.to_string(),
                item_id: value["itemId"].as_i64()?,
                hash: value["hash"].as_str()?.parse().ok()?,
                auto: value["auto"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

fn find_note(root: &Path, input: &PostAgentProposalInput) -> Result<PathBuf> {
    let dir = notes_dir(root, input.target, input.item_id);
    [
        dir.join(&input.note_id),
        dir.join(DONE_DIR).join(&input.note_id),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .ok_or_else(|| AppError::InvalidInput(format!("note not found: {}", input.note_id)))
}

impl AgentNoteService {
    /// Checks a proposal and signs it. Fails when the note or proposal is not
    /// what the request says, it was posted already, or (for `auto`) Settings
    /// or the limits do not allow it.
    pub(crate) fn prepare_post(&self, input: PostAgentProposalInput) -> Result<PreparedPost> {
        let auto_enabled = self.db.get_app_settings()?.agent_auto_post_enabled;
        prepare_post_in(&self.notes_root(), input, auto_enabled, Local::now())
    }

    /// Records a posted proposal in the log and the note, so it is not posted again.
    pub(crate) fn record_posted(&self, prepared: PreparedPost, reference: &str) -> Result<()> {
        record_posted_in(&self.notes_root(), prepared, reference, Local::now())
    }
}

pub(super) fn prepare_post_in(
    root: &Path,
    input: PostAgentProposalInput,
    auto_enabled: bool,
    now: DateTime<Local>,
) -> Result<PreparedPost> {
    validate_id(input.item_id)?;
    validate_note_id(&input.note_id)?;
    if input.target == NoteTarget::Ask {
        return Err(AppError::InvalidInput(
            "agent comments can only be posted to a work item or pull request".to_string(),
        ));
    }
    if input.auto && !auto_enabled {
        return Err(AppError::InvalidInput(
            "automatic posting of agent comments is off".to_string(),
        ));
    }
    let path = find_note(root, &input)?;
    let note = parse_note(&path, "open", &fs::read_to_string(&path)?, None);
    let reply = note
        .replies
        .get(input.reply_index)
        .filter(|reply| reply.kind == "post")
        .ok_or_else(|| {
            AppError::InvalidInput("no proposed comment at that position".to_string())
        })?;
    if reply.posted_at.is_some() {
        return Err(AppError::InvalidInput(
            "this comment was already posted".to_string(),
        ));
    }
    let label = agent_label(&reply.author).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "unknown agent for a proposed comment: {}",
            reply.author
        ))
    })?;
    let location = proposal_location(
        input.target,
        input.auto,
        reply.file_path.as_deref(),
        reply.line,
    )?;
    let text = strip_signature(&reply.body);
    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "the proposed comment is empty".to_string(),
        ));
    }
    if text.chars().count() > MAX_COMMENT_CHARS {
        return Err(AppError::InvalidInput(
            "the proposed comment is too long".to_string(),
        ));
    }
    let hash = text_hash(text);
    let log = read_log(root);
    let target = input.target.as_str();
    if log
        .iter()
        .any(|e| e.hash == hash && e.target == target && e.item_id == input.item_id)
    {
        return Err(AppError::InvalidInput(
            "the same comment was already posted here".to_string(),
        ));
    }
    if input.auto {
        check_auto_content(text)?;
        let recent: Vec<_> = log
            .iter()
            .filter(|e| e.auto && now - e.at < Duration::hours(1))
            .collect();
        let on_item = recent
            .iter()
            .filter(|e| e.target == target && e.item_id == input.item_id)
            .count();
        if on_item >= AUTO_PER_ITEM_PER_HOUR || recent.len() >= AUTO_PER_HOUR {
            return Err(AppError::InvalidInput(
                "too many automatic agent comments in the last hour".to_string(),
            ));
        }
    }
    // The notes root is part of the key so that separate roots never share a
    // slot: the app has one root, but tests run in parallel, each in its own
    // temporary root, and reuse the same ids.
    let key = format!(
        "{}:{target}:{}:{}:{}",
        root.display(),
        input.item_id,
        input.note_id,
        input.reply_index
    );
    if !in_flight()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(key.clone())
    {
        return Err(AppError::InvalidInput(
            "this comment is being posted".to_string(),
        ));
    }
    Ok(PreparedPost {
        body: format!("{text}\n\n{}", signature(label)),
        location,
        agent: reply.author.clone(),
        hash,
        input,
        _guard: PostGuard(key),
    })
}

pub(super) fn record_posted_in(
    root: &Path,
    prepared: PreparedPost,
    reference: &str,
    now: DateTime<Local>,
) -> Result<()> {
    let now = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let input = &prepared.input;
    let entry = json!({
        "at": now,
        "target": input.target.as_str(),
        "itemId": input.item_id,
        "noteId": input.note_id,
        "replyIndex": input.reply_index,
        "hash": prepared.hash.to_string(),
        "agent": prepared.agent,
        "reference": reference,
        "auto": input.auto,
    });
    fs::create_dir_all(root)?;
    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join(LOG_FILE))?;
    writeln!(log, "{entry}")?;

    let path = find_note(root, input)?;
    let text = fs::read_to_string(&path)?;
    write_atomic(
        &path,
        &insert_posted(&text, input.reply_index, &now, reference),
    )
}

/// Puts the `posted` record right after the `index`-th reply's text.
fn insert_posted(text: &str, index: usize, at: &str, reference: &str) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let start = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| is_reply_marker(line))
        .nth(index)
        .map(|(i, _)| i);
    let Some(start) = start else {
        return text.to_string();
    };
    let end = lines[start + 1..]
        .iter()
        .position(|line| is_marker(line))
        .map_or(lines.len(), |offset| start + 1 + offset);
    let mut out: String = lines[..end].concat();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!("<!-- posted {at} {reference} -->\n"));
    if end < lines.len() {
        out.push('\n');
        out.push_str(&lines[end..].concat());
    }
    out
}
