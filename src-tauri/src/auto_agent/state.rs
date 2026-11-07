//! Durable automatic-run history, independent of the user-editable notes.
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::agent_notes::NoteTarget;
use crate::db::AppDatabase;
use crate::error::{AppError, Result};

pub(super) const TIMEOUT_SECS: u64 = 30 * 60;

#[derive(Debug, Default, Deserialize, Serialize)]
pub(super) struct History {
    pub reviewed_commit: Option<String>,
    pub runs: Vec<Run>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct Run {
    pub base_commit: Option<String>,
    pub head_commit: Option<String>,
    pub note_id: Option<String>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: Status,
    pub complete: bool,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
    pub log_path: Option<PathBuf>,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Status {
    Running,
    Succeeded,
    Failed,
    Partial,
}

impl History {
    pub fn read(path: &Path) -> Result<Self> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| AppError::InvalidInput(format!("invalid auto-agent history: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes =
            serde_json::to_vec_pretty(self).map_err(|e| AppError::InvalidInput(e.to_string()))?;
        let temp = path.with_extension("tmp");
        fs::write(&temp, bytes)?;
        fs::rename(temp, path)?;
        Ok(())
    }

    /// Back off failed attempts; an interrupted process retains its lease.
    pub fn due(&self, now: DateTime<Utc>) -> bool {
        let Some(last) = self.runs.last() else {
            return true;
        };
        match last.status {
            Status::Running => now >= last.started_at + Duration::seconds(TIMEOUT_SECS as i64),
            Status::Failed => {
                let failures = self
                    .runs
                    .iter()
                    .rev()
                    .take_while(|r| r.status == Status::Failed)
                    .count();
                let seconds = (300_i64 * (1_i64 << failures.saturating_sub(1).min(4))).min(3600);
                now >= last.finished_at.unwrap_or(last.started_at) + Duration::seconds(seconds)
            }
            _ => true,
        }
    }

    pub fn needs_review(&self, head: &str) -> bool {
        self.reviewed_commit.as_deref() != Some(head)
            && !self.runs.last().is_some_and(|r| {
                r.status == Status::Partial && r.head_commit.as_deref() == Some(head)
            })
    }

    pub fn begin(&mut self, base: Option<String>, head: Option<String>, now: DateTime<Utc>) {
        // An app restart may have interrupted the previous run. Never advance
        // its reviewed commit merely because its lease expired.
        if let Some(last) = self.runs.last_mut().filter(|r| r.status == Status::Running) {
            last.status = Status::Failed;
            last.error = Some("Automatic run was interrupted".into());
            last.finished_at = Some(now);
        }
        self.runs.push(Run {
            base_commit: base,
            head_commit: head,
            note_id: None,
            started_at: now,
            finished_at: None,
            status: Status::Running,
            complete: false,
            error: None,
            exit_code: None,
            log_path: None,
        });
    }

    pub fn finish(&mut self, complete: bool, error: Option<String>, exit_code: Option<i32>) {
        let last = self.runs.last_mut().expect("begin precedes finish");
        last.complete = complete;
        last.finished_at = Some(Utc::now());
        last.exit_code = exit_code;
        last.status = if error.is_some() {
            Status::Failed
        } else if complete {
            self.reviewed_commit = last.head_commit.clone();
            Status::Succeeded
        } else {
            Status::Partial
        };
        last.error = error;
    }
}

pub(super) fn history_path(
    db: &AppDatabase,
    org: &str,
    repo: &str,
    target: NoteTarget,
    id: i64,
) -> PathBuf {
    // Reversible encoding also keeps repository names with slashes inside the
    // app's private directory, and separates identical PR numbers in orgs.
    let encode = |s: &str| {
        s.as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let kind = if target == NoteTarget::PullRequest {
        "pr"
    } else {
        "wi"
    };
    db.data_dir()
        .join("auto-agent")
        .join(encode(org))
        .join(encode(repo))
        .join(format!("{kind}-{id}.json"))
}

/// Notes/results still use the legacy item-number naming contract. Refuse to
/// share those files between scopes instead of overwriting another review.
pub(super) fn has_number_collision(db: &AppDatabase, path: &Path) -> Result<bool> {
    let root = db.data_dir().join("auto-agent");
    if !root.is_dir() {
        return Ok(false);
    }
    for org in fs::read_dir(root)? {
        let org = org?.path();
        if !org.is_dir() {
            continue;
        }
        for repo in fs::read_dir(org)? {
            let repo = repo?.path();
            if repo.is_dir() {
                let other = repo.join(path.file_name().expect("history filename"));
                if other != path && other.exists() {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_and_partial_runs_do_not_advance_reviewed_commit() {
        let mut h = History::default();
        h.begin(None, Some("a".into()), Utc::now());
        h.finish(true, None, Some(0));
        h.begin(Some("a".into()), Some("b".into()), Utc::now());
        h.finish(true, Some("exit 1".into()), Some(1));
        assert_eq!(h.reviewed_commit.as_deref(), Some("a"));
        assert!(h.needs_review("b"));
        h.begin(Some("a".into()), Some("b".into()), Utc::now());
        h.finish(false, None, Some(0));
        assert_eq!(h.reviewed_commit.as_deref(), Some("a"));
        assert!(!h.needs_review("b"));
        assert!(h.needs_review("c"));
    }

    #[test]
    fn history_survives_restart_and_backoff_expires() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let mut h = History::default();
        h.begin(None, Some("a".into()), Utc::now());
        h.finish(true, Some("offline".into()), None);
        h.save(&path).unwrap();
        let h = History::read(&path).unwrap();
        assert!(!h.due(Utc::now()));
        assert!(h.due(Utc::now() + Duration::minutes(6)));
        assert!(h.needs_review("a"));
    }

    #[test]
    fn interrupted_run_is_not_success_and_keys_are_scoped() {
        let mut h = History::default();
        let now = Utc::now();
        h.begin(None, Some("a".into()), now);
        assert!(!h.due(now + Duration::minutes(29)));
        assert!(h.due(now + Duration::minutes(31)));
        h.begin(None, Some("b".into()), now + Duration::minutes(31));
        assert_eq!(h.runs[0].status, Status::Failed);
        assert_eq!(h.reviewed_commit, None);
        let db = AppDatabase::new(PathBuf::from("test/db.sqlite3"));
        assert_ne!(
            history_path(&db, "a", "repo", NoteTarget::PullRequest, 1),
            history_path(&db, "b", "repo", NoteTarget::PullRequest, 1)
        );
        assert_ne!(
            history_path(&db, "a", "x/y", NoteTarget::PullRequest, 1),
            history_path(&db, "a", "x", NoteTarget::PullRequest, 1)
        );
    }

    #[test]
    fn colliding_item_numbers_do_not_share_result_files_across_scopes() {
        let dir = tempfile::tempdir().unwrap();
        let db = AppDatabase::new(dir.path().join("db.sqlite3"));
        let first = history_path(&db, "a", "repo", NoteTarget::PullRequest, 7);
        let second = history_path(&db, "b", "repo", NoteTarget::PullRequest, 7);
        History::default().save(&first).unwrap();
        assert!(!has_number_collision(&db, &first).unwrap());
        assert!(has_number_collision(&db, &second).unwrap());
        let other_id = history_path(&db, "b", "repo", NoteTarget::PullRequest, 8);
        assert!(!has_number_collision(&db, &other_id).unwrap());
    }
}
