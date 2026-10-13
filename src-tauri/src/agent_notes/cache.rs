//! Parsed notes keyed by file path, reused while the file's size and
//! modification time are unchanged. The UI polls the note folders every few
//! seconds and `_done/` only grows, so re-reading every file each time would
//! get slower the longer DevDeck is used.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use chrono::{DateTime, Local};

use super::format::parse_note;
use super::AgentNote;

// Entries for moved or deleted files are never looked up again; clearing the
// whole map past this size keeps it bounded without tracking them.
const MAX_ENTRIES: usize = 10_000;

struct Entry {
    modified: Option<SystemTime>,
    len: u64,
    note: AgentNote,
}

fn cache() -> &'static Mutex<HashMap<PathBuf, Entry>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Entry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Reads and parses one note file, or returns the cached parse when the file
/// has not changed since. Hand-written notes may not be valid UTF-8.
pub(super) fn read_note(path: &Path, status: &str) -> io::Result<AgentNote> {
    let metadata = fs::metadata(path)?;
    let modified = metadata.modified().ok();
    let len = metadata.len();
    if let Some(entry) = cache().lock().unwrap().get(path) {
        if entry.modified == modified && entry.len == len && entry.note.status == status {
            return Ok(entry.note.clone());
        }
    }
    let bytes = fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let modified_at = modified.map(|time| {
        DateTime::<Local>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
    });
    let note = parse_note(path, status, &text, modified_at);
    let mut cache = cache().lock().unwrap();
    if cache.len() >= MAX_ENTRIES {
        cache.clear();
    }
    cache.insert(
        path.to_path_buf(),
        Entry {
            modified,
            len,
            note: note.clone(),
        },
    );
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rereads_a_note_once_its_file_changes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("a.md");
        fs::write(&path, "first").unwrap();
        assert_eq!(read_note(&path, "open").unwrap().body, "first");
        // Unchanged file: served from the cache with the same content.
        assert_eq!(read_note(&path, "open").unwrap().body, "first");

        fs::write(&path, "second, longer").unwrap();
        assert_eq!(read_note(&path, "open").unwrap().body, "second, longer");
    }

    #[test]
    fn missing_file_is_not_found() {
        let temp = tempfile::tempdir().unwrap();
        let err = read_note(&temp.path().join("gone.md"), "open").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
