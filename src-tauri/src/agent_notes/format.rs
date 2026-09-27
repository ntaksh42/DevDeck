//! Reading and rewriting the note file format: a `---`-delimited front-matter
//! block of `key: value` lines, the body, then replies.

use std::fs;
use std::path::Path;

use super::replies;
use super::AgentNote;
use crate::error::Result;

pub(crate) fn parse_note(
    path: &Path,
    status: &str,
    text: &str,
    modified: Option<String>,
) -> AgentNote {
    let (fields, body) = split_front_matter(text);
    let (body, replies) = replies::split_replies(body);
    // Last occurrence wins: a note reopened by a reply keeps its old
    // `resolved` line, and the agent appends a new one when it is done again.
    let get = |key: &str| {
        fields
            .iter()
            .rev()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())
    };
    AgentNote {
        id: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        status: status.to_string(),
        created_at: get("created").or(modified.clone()).unwrap_or_default(),
        modified_at: modified,
        body,
        quote: get("quote"),
        quote_prefix: get("quote_prefix"),
        quote_suffix: get("quote_suffix"),
        quote_offset: get("quote_offset").and_then(|value| value.parse().ok()),
        result_file: get("result_file"),
        result_hash: get("result_hash"),
        kind: get("kind"),
        resolved: get("resolved"),
        replies,
        file_path: path.display().to_string(),
    }
}

/// Splits `---`-delimited `key: value` lines from the body. Values written by
/// DevDeck are JSON strings; values an agent writes by hand may be bare text,
/// so both are accepted. A file without front-matter is all body.
fn split_front_matter(text: &str) -> (Vec<(String, String)>, &str) {
    let Some((lines, body)) = front_matter_lines(text) else {
        return (Vec::new(), text.trim_start_matches('\u{feff}'));
    };
    let fields = lines
        .iter()
        .filter_map(|line| line.trim_end().split_once(':'))
        .map(|(key, value)| (key.trim().to_string(), parse_value(value.trim())))
        .collect();
    (fields, body)
}

/// The raw front-matter lines (without the `---` fences) and the rest.
fn front_matter_lines(text: &str) -> Option<(Vec<&str>, &str)> {
    let text = text.trim_start_matches('\u{feff}');
    let rest = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))?;
    let mut lines = Vec::new();
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        offset += line.len();
        if line.trim_end() == "---" {
            return Some((lines, &rest[offset..]));
        }
        lines.push(line.trim_end_matches(['\r', '\n']));
    }
    None
}

fn parse_value(raw: &str) -> String {
    if raw.starts_with('"') {
        if let Ok(value) = serde_json::from_str::<String>(raw) {
            return value;
        }
    }
    if raw == "null" || raw == "~" {
        return String::new();
    }
    raw.to_string()
}

/// Rewrites the front-matter so `key` appears once with `value` (JSON-quoted),
/// or not at all when `value` is `None`. Other lines are kept as written.
pub(crate) fn set_field(text: &str, key: &str, value: Option<&str>) -> String {
    let Some((lines, body)) = front_matter_lines(text) else {
        return match value {
            Some(_) => set_field(&format!("---\n---\n{text}"), key, value),
            None => text.to_string(),
        };
    };
    let mut out = String::from("---\n");
    for line in lines {
        let is_key = line
            .split_once(':')
            .is_some_and(|(name, _)| name.trim() == key);
        if !is_key {
            out.push_str(line);
            out.push('\n');
        }
    }
    if let Some(value) = value {
        let json = serde_json::to_string(value).unwrap_or_default();
        out.push_str(&format!("{key}: {json}\n"));
    }
    out.push_str("---\n");
    out.push_str(body);
    out
}

/// Replaces the note body (everything between the front-matter and the first
/// reply marker), keeping the replies.
pub(crate) fn replace_body(text: &str, body: &str) -> String {
    let (lines, rest) = front_matter_lines(text).unwrap_or((Vec::new(), text));
    let replies_start = rest
        .split_inclusive('\n')
        .scan(0, |offset, line| {
            let start = *offset;
            *offset += line.len();
            Some((start, line))
        })
        .find(|(_, line)| replies::is_marker(line))
        .map(|(start, _)| start)
        .unwrap_or(rest.len());
    let mut out = String::from("---\n");
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(body);
    out.push('\n');
    if replies_start < rest.len() {
        out.push('\n');
        out.push_str(&rest[replies_start..]);
    }
    out
}

/// Writes through a temporary sibling and renames it into place, so an agent
/// polling the folder never reads a half-written note. The temporary name does
/// not end in `.md`, so it is never listed as a note.
pub(crate) fn write_atomic(path: &Path, text: &str) -> Result<()> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    let temp = path.with_file_name(format!(".{name}.tmp"));
    fs::write(&temp, text)?;
    if let Err(err) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(err.into());
    }
    Ok(())
}
