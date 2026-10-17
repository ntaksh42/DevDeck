//! What Claude Code wrote about an Inbox item, to decide on it without opening
//! anything: a verdict with its reason, the evidence (file:line and code), and
//! a reply draft. One row per item, written after a sync and removed with the
//! item.

use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};

use crate::error::Result;

use super::{AppDatabase, InboxItem};

/// Kinds that get a summary: comments addressed to the user. The PR and work
/// item syncs run side by side, and each summarizes only its own kinds, since
/// only the PR sync has the full comment threads at hand.
pub const PR_INSIGHT_KINDS: [&str; 2] = ["pr_mention", "pr_reply"];
pub const WI_INSIGHT_KINDS: [&str; 1] = ["wi_mention"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxInsight {
    /// `pending` (being written), `ready` or `failed`.
    pub status: String,
    /// `reply` (answer it), `fix` (change the code first) or `none` (nothing to do).
    pub verdict: Option<String>,
    /// Why, in one sentence.
    pub reason: Option<String>,
    pub evidence: Vec<InsightEvidence>,
    /// A reply the user can put in the reply box and edit before sending.
    pub reply_draft: Option<String>,
    pub error: Option<String>,
}

/// One fact behind the verdict.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InsightEvidence {
    pub text: String,
    /// `file:line` it was read from, when it came from the code.
    #[serde(default)]
    pub location: Option<String>,
    /// A few lines of that code.
    #[serde(default)]
    pub code: Option<String>,
    /// A guess rather than something read in the code or the thread.
    #[serde(default)]
    pub guess: bool,
}

pub(super) fn migrate_v26(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS action_inbox_insights (
            item_id INTEGER PRIMARY KEY REFERENCES action_inbox_items(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            verdict TEXT,
            reason TEXT,
            evidence TEXT,
            reply_draft TEXT,
            error TEXT,
            updated_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

/// Fills `insight` on the listed items that have one.
pub(super) fn attach_insights(conn: &Connection, items: &mut [InboxItem]) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; items.len()].join(", ");
    let sql = format!(
        "SELECT item_id, status, verdict, reason, evidence, reply_draft, error \
         FROM action_inbox_insights WHERE item_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(items.iter().map(|item| item.id)), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            InboxInsight {
                status: row.get(1)?,
                verdict: row.get(2)?,
                reason: row.get(3)?,
                evidence: row
                    .get::<_, Option<String>>(4)?
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default(),
                reply_draft: row.get(5)?,
                error: row.get(6)?,
            },
        ))
    })?;
    let mut by_id: HashMap<i64, InboxInsight> = rows.collect::<rusqlite::Result<_>>()?;
    for item in items.iter_mut() {
        item.insight = by_id.remove(&item.id);
    }
    Ok(())
}

impl AppDatabase {
    /// Open items of `org_id` and `kinds` without an insight yet, newest first.
    /// Scoped to the organization whose sync has the comment threads at hand.
    pub fn inbox_items_needing_insight(
        &self,
        org_id: &str,
        kinds: &[&str],
        limit: u32,
    ) -> Result<Vec<InboxItem>> {
        let conn = self.open()?;
        let kinds = kinds
            .iter()
            .map(|kind| format!("'{kind}'"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, org_id, kind, subject_id, project_id, project_name, repository_id, \
                    repository_name, thread_id, comment_id, title, author, snippet, web_url, \
                    state, snoozed_until, detected_at, done_at, file_path, line, hit_count \
             FROM action_inbox_items i \
             WHERE org_id = ?1 AND state = 'open' AND kind IN ({kinds}) \
               AND NOT EXISTS (SELECT 1 FROM action_inbox_insights s WHERE s.item_id = i.id) \
             ORDER BY detected_at DESC, id DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![org_id, limit], super::action_inbox::map_inbox_item)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn save_inbox_insight(&self, item_id: i64, insight: &InboxInsight) -> Result<()> {
        let conn = self.open()?;
        let evidence = serde_json::to_string(&insight.evidence)
            .map_err(|e| crate::error::AppError::InvalidInput(e.to_string()))?;
        conn.execute(
            "INSERT INTO action_inbox_insights \
                (item_id, status, verdict, reason, evidence, reply_draft, error, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(item_id) DO UPDATE SET status = excluded.status, \
                verdict = excluded.verdict, reason = excluded.reason, \
                evidence = excluded.evidence, reply_draft = excluded.reply_draft, \
                error = excluded.error, updated_at = excluded.updated_at",
            params![
                item_id,
                insight.status,
                insight.verdict,
                insight.reason,
                evidence,
                insight.reply_draft,
                insight.error,
                Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            ],
        )?;
        Ok(())
    }

    /// Insights left `pending` by an app that quit mid-run are written again.
    pub fn clear_pending_inbox_insights(&self) -> Result<usize> {
        let conn = self.open()?;
        Ok(conn.execute(
            "DELETE FROM action_inbox_insights WHERE status = 'pending'",
            [],
        )?)
    }
}
