use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

const SCHEMA_VERSION: i64 = 12;

/// Max rows kept in the my_work_items snapshot queries; sync notification
/// diffing must know this cap to avoid treating re-entering rows as new.
pub const MY_WORK_ITEMS_LIMIT: usize = 200;

// ── Existing public types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub base_url: String,
    pub auth_provider: String,
    pub credential_key: String,
    pub authenticated_user_id: Option<String>,
    pub authenticated_user_display_name: Option<String>,
    pub authenticated_user_unique_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub review_result_folder_path: Option<String>,
    pub show_window_hotkey: Option<String>,
    pub read_only_validation_mode_enabled: bool,
    pub desktop_notifications_enabled: bool,
    pub notification_content_preview_enabled: bool,
    pub notify_work_item_assignments: bool,
    pub notify_work_item_state_changes: bool,
    pub notify_pr_review_requests: bool,
    pub notify_pr_vote_resets: bool,
    pub notify_pr_comment_replies: bool,
    pub review_stale_threshold_days: i64,
}

pub const DEFAULT_REVIEW_STALE_THRESHOLD_DAYS: i64 = 3;
pub const REVIEW_STALE_THRESHOLD_DAY_OPTIONS: [i64; 4] = [2, 3, 5, 7];

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            review_result_folder_path: None,
            show_window_hotkey: None,
            read_only_validation_mode_enabled: false,
            desktop_notifications_enabled: false,
            notification_content_preview_enabled: true,
            notify_work_item_assignments: true,
            notify_work_item_state_changes: true,
            notify_pr_review_requests: true,
            notify_pr_vote_resets: true,
            notify_pr_comment_replies: true,
            review_stale_threshold_days: DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
        }
    }
}

pub struct OrganizationDraft {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub base_url: String,
    pub auth_provider: String,
    pub credential_key: String,
    pub authenticated_user_id: Option<String>,
    pub authenticated_user_display_name: Option<String>,
    pub authenticated_user_unique_name: Option<String>,
}

// ── Cache row types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CachedPr {
    pub org_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedReviewPr {
    pub org_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub my_is_required: bool,
    pub is_draft: bool,
    pub merge_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedWorkItem {
    pub org_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub assigned_to_unique_name: Option<String>,
    pub changed_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnoozedItem {
    pub item_type: String,
    pub item_key: String,
    pub snooze_until: String,
    /// Activity marker captured when the item was snoozed. For pull requests
    /// this is the last-seen comment id (decimal string); for work items it is
    /// the `System.ChangedDate` timestamp. Compared against the live value
    /// during sync to revive items that saw new activity.
    pub baseline_activity: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CachedCommit {
    pub org_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub author_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedRepository {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
}

#[derive(Debug, Clone)]
pub struct MentionHistoryEntry {
    pub unique_name: String,
    pub display_name: String,
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub scope: String,
    pub org_id: String,
    pub last_synced_at: Option<String>,
    pub error_count: i64,
    pub last_error: Option<String>,
    pub last_warning: Option<String>,
}

// ── AppDatabase ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppDatabase {
    path: PathBuf,
}

impl AppDatabase {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn initialize(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = self.open()?;
        migrate(&conn)?;
        Ok(())
    }

    pub fn open(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "recursive_triggers", "ON")?;
        // Wait instead of failing with SQLITE_BUSY when a sync write overlaps
        // a UI read; NORMAL is durable enough under WAL and much faster.
        conn.busy_timeout(std::time::Duration::from_secs(3))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(conn)
    }

    // ── Organizations ────────────────────────────────────────────────────────

    pub fn list_organizations(&self) -> Result<Vec<Organization>> {
        let conn = self.open()?;
        list_organizations(&conn)
    }

    pub fn get_organization(&self, id: &str) -> Result<Option<Organization>> {
        let conn = self.open()?;
        get_organization(&conn, id)
    }

    /// Resolves an organization by id, or falls back to the first configured
    /// organization when no id is given.
    pub fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }
        self.list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }

    pub fn upsert_organization(&self, draft: OrganizationDraft) -> Result<Organization> {
        let conn = self.open()?;
        upsert_organization(&conn, draft)
    }

    pub fn delete_organization(&self, id: &str) -> Result<()> {
        let conn = self.open()?;
        delete_organization(&conn, id)
    }

    // ── App settings ─────────────────────────────────────────────────────────

    pub fn get_app_settings(&self) -> Result<AppSettings> {
        let conn = self.open()?;
        get_app_settings(&conn)
    }

    pub fn update_app_settings(&self, settings: AppSettings) -> Result<AppSettings> {
        let conn = self.open()?;
        update_app_settings(&conn, settings)
    }

    pub fn get_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<Option<i64>> {
        let conn = self.open()?;
        get_pr_comment_seen(&conn, org_id, repository_id, pull_request_id)
    }

    pub fn set_pr_comment_seen(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        last_seen_comment_id: i64,
    ) -> Result<()> {
        let conn = self.open()?;
        set_pr_comment_seen(
            &conn,
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
        )
    }

    // ── Snoozed items ─────────────────────────────────────────────────────────

    pub fn upsert_snoozed_item(
        &self,
        org_id: &str,
        item_type: &str,
        item_key: &str,
        snooze_until: &str,
        baseline_activity: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        upsert_snoozed_item(
            &conn,
            org_id,
            item_type,
            item_key,
            snooze_until,
            baseline_activity,
        )
    }

    pub fn delete_snoozed_item(&self, org_id: &str, item_type: &str, item_key: &str) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM snoozed_items \
             WHERE organization_id = ?1 AND item_type = ?2 AND item_key = ?3",
            params![org_id, item_type, item_key],
        )?;
        Ok(())
    }

    pub fn list_snoozed_items(&self, org_id: &str, item_type: &str) -> Result<Vec<SnoozedItem>> {
        let conn = self.open()?;
        list_snoozed_items(&conn, org_id, item_type)
    }

    // ── Pull requests cache ───────────────────────────────────────────────────

    pub fn search_pull_requests(
        &self,
        org_id: &str,
        project_id: Option<&str>,
        repository_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<CachedPr>> {
        let conn = self.open()?;
        search_pull_requests(&conn, org_id, project_id, repository_id, status)
    }

    /// Replaces cached pull requests for the repositories that synced
    /// successfully; rows of other repositories are preserved.
    pub fn replace_pull_requests_for_projects(
        &self,
        org_id: &str,
        synced_project_ids: &[&str],
        prs: &[CachedPr],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        for &project_id in synced_project_ids {
            tx.execute(
                "DELETE FROM pull_requests WHERE org_id = ?1 AND project_id = ?2",
                rusqlite::params![org_id, project_id],
            )?;
        }
        upsert_pull_requests(&tx, prs)?;
        tx.commit()?;
        Ok(())
    }

    // ── Review PRs cache ──────────────────────────────────────────────────────

    pub fn list_review_pull_requests(&self, org_id: &str) -> Result<Vec<CachedReviewPr>> {
        let conn = self.open()?;
        list_review_pull_requests(&conn, org_id)
    }

    pub fn replace_review_pull_requests(&self, org_id: &str, prs: &[CachedReviewPr]) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM review_pull_requests WHERE org_id = ?1",
            [org_id],
        )?;
        upsert_review_pull_requests(&tx, prs)?;
        tx.commit()?;
        Ok(())
    }

    /// Reflects a freshly cast vote in the cached review row so the grid does
    /// not show a stale vote until the next background sync.
    pub fn update_review_pr_vote(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        vote: i32,
        vote_label: &str,
    ) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "UPDATE review_pull_requests SET my_vote = ?4, my_vote_label = ?5 \
             WHERE org_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id, vote, vote_label],
        )?;
        Ok(())
    }

    // ── Work items cache ──────────────────────────────────────────────────────

    pub fn upsert_work_items(&self, items: &[CachedWorkItem]) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        upsert_work_items(&conn, items)
    }

    pub fn search_work_items(
        &self,
        org_id: &str,
        project_id: Option<&str>,
        state: Option<&str>,
        work_item_type: Option<&str>,
        assigned_to: Option<&str>,
    ) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        search_work_items(
            &conn,
            org_id,
            project_id,
            state,
            work_item_type,
            assigned_to,
        )
    }

    pub fn search_work_items_fts(&self, org_id: &str, query: &str) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        search_work_items_fts(&conn, org_id, query)
    }

    // ── My work items cache ───────────────────────────────────────────────────

    pub fn list_my_work_items(&self, org_id: &str) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        list_my_work_items(&conn, org_id)
    }

    /// Keeps the my_work_items snapshot consistent after a single-item edit.
    ///
    /// When `my_unique_name` is known and the item is no longer assigned to that
    /// user, the row is removed so a reassignment drops out of My Work Items
    /// immediately instead of lingering until the next full sync. Otherwise the
    /// existing row (if any) is updated in place.
    pub fn update_my_work_item_if_present(
        &self,
        item: &CachedWorkItem,
        my_unique_name: Option<&str>,
    ) -> Result<()> {
        let still_mine = match (my_unique_name, item.assigned_to_unique_name.as_deref()) {
            (Some(me), Some(assignee)) => me.eq_ignore_ascii_case(assignee),
            // Unknown identity or unassigned: fall back to update-only to avoid
            // dropping a row we cannot confidently say left the snapshot.
            (None, _) => true,
            (Some(_), None) => false,
        };

        let conn = self.open()?;
        if !still_mine {
            conn.execute(
                "DELETE FROM my_work_items WHERE org_id=?1 AND id=?2",
                rusqlite::params![item.org_id, item.id],
            )?;
            return Ok(());
        }
        conn.execute(
            "UPDATE my_work_items SET title=?3, work_item_type=?4, state=?5, \
             assigned_to=?6, assigned_to_unique_name=?7, changed_date=?8, web_url=?9 \
             WHERE org_id=?1 AND id=?2",
            rusqlite::params![
                item.org_id,
                item.id,
                item.title,
                item.work_item_type,
                item.state,
                item.assigned_to,
                item.assigned_to_unique_name,
                item.changed_date,
                item.web_url
            ],
        )?;
        Ok(())
    }

    pub fn replace_work_items(
        &self,
        org_id: &str,
        synced_project_ids: &[&str],
        all_items: &[CachedWorkItem],
        my_items: &[CachedWorkItem],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        // Delete only rows that left the snapshot instead of rewriting every
        // row; unchanged rows keep their rowid so the FTS triggers stay idle.
        tx.execute_batch("CREATE TEMP TABLE sync_work_item_ids(id INTEGER PRIMARY KEY) ")?;
        {
            let mut insert =
                tx.prepare_cached("INSERT OR IGNORE INTO sync_work_item_ids(id) VALUES (?1)")?;
            for item in all_items {
                insert.execute([item.id])?;
            }
        }
        for &project_id in synced_project_ids {
            tx.execute(
                "DELETE FROM work_items WHERE org_id = ?1 AND project_id = ?2 AND id NOT IN (SELECT id FROM sync_work_item_ids)",
                rusqlite::params![org_id, project_id],
            )?;
            tx.execute(
                "DELETE FROM my_work_items WHERE org_id = ?1 AND project_id = ?2",
                rusqlite::params![org_id, project_id],
            )?;
        }
        upsert_work_items(&tx, all_items)?;
        upsert_my_work_items(&tx, my_items)?;
        tx.execute_batch("DROP TABLE sync_work_item_ids")?;
        tx.commit()?;
        Ok(())
    }

    // Delta sync: merge changed work items without touching rows that are
    // absent from the snapshot. Deletions are reconciled by the periodic full
    // sync via `replace_work_items`. The my_work_items view is always a full
    // snapshot so assignment removals stay correct.
    pub fn apply_work_items_delta(
        &self,
        org_id: &str,
        synced_project_ids: &[&str],
        delta_items: &[CachedWorkItem],
        my_items: &[CachedWorkItem],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        upsert_work_items(&tx, delta_items)?;
        for &project_id in synced_project_ids {
            tx.execute(
                "DELETE FROM my_work_items WHERE org_id = ?1 AND project_id = ?2",
                rusqlite::params![org_id, project_id],
            )?;
        }
        upsert_my_work_items(&tx, my_items)?;
        tx.commit()?;
        Ok(())
    }

    // ── Commits cache ─────────────────────────────────────────────────────────

    pub fn search_commits(
        &self,
        org_id: &str,
        repository_id: Option<&str>,
        author_email: Option<&str>,
        from_date: Option<&str>,
        to_date: Option<&str>,
    ) -> Result<Vec<CachedCommit>> {
        let conn = self.open()?;
        search_commits(
            &conn,
            org_id,
            repository_id,
            author_email,
            from_date,
            to_date,
        )
    }

    pub fn search_commits_fts(
        &self,
        org_id: &str,
        query: &str,
        repository_id: Option<&str>,
    ) -> Result<Vec<CachedCommit>> {
        let conn = self.open()?;
        search_commits_fts(&conn, org_id, query, repository_id)
    }

    pub fn list_commit_repositories(&self, org_id: &str) -> Result<Vec<CachedRepository>> {
        let conn = self.open()?;
        list_commit_repositories(&conn, org_id)
    }

    pub fn replace_commits_for_repo(
        &self,
        org_id: &str,
        repository_id: &str,
        commits: &[CachedCommit],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        // Same final state as delete-all + insert, but rows already in the
        // snapshot are left untouched so the FTS triggers stay idle.
        tx.execute_batch("CREATE TEMP TABLE sync_commit_ids(commit_id TEXT PRIMARY KEY)")?;
        {
            let mut insert =
                tx.prepare_cached("INSERT OR IGNORE INTO sync_commit_ids(commit_id) VALUES (?1)")?;
            for commit in commits {
                insert.execute([&commit.commit_id])?;
            }
        }
        tx.execute(
            "DELETE FROM commits WHERE org_id = ?1 AND repository_id = ?2 AND commit_id NOT IN (SELECT commit_id FROM sync_commit_ids)",
            rusqlite::params![org_id, repository_id],
        )?;
        upsert_commits(&tx, commits)?;
        tx.execute_batch("DROP TABLE sync_commit_ids")?;
        tx.commit()?;
        Ok(())
    }

    pub fn purge_old_commits(&self, org_id: &str, before_date: &str) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM commits WHERE org_id = ?1 AND (author_date IS NULL OR author_date < ?2)",
            rusqlite::params![org_id, before_date],
        )?;
        Ok(())
    }

    // ── Sync state ────────────────────────────────────────────────────────────

    pub fn get_sync_state(&self, scope: &str) -> Result<Option<SyncState>> {
        let conn = self.open()?;
        Ok(conn
            .query_row(
                "SELECT scope, org_id, last_synced_at, error_count, last_error, last_warning FROM sync_state WHERE scope = ?1",
                [scope],
                map_sync_state,
            )
            .optional()?)
    }

    pub fn list_sync_states(&self) -> Result<Vec<SyncState>> {
        let conn = self.open()?;
        // `internal:` scopes are bookkeeping (e.g. last full work item sync)
        // and are hidden from the settings UI.
        let mut stmt = conn.prepare(
            "SELECT scope, org_id, last_synced_at, error_count, last_error, last_warning FROM sync_state \
             WHERE scope NOT LIKE 'internal:%' \
             ORDER BY org_id, scope",
        )?;
        let rows = stmt.query_map([], map_sync_state)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn update_sync_state(
        &self,
        scope: &str,
        org_id: &str,
        last_synced_at: Option<&str>,
        error_count: i64,
        last_error: Option<&str>,
        last_warning: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            r#"
            INSERT INTO sync_state(scope, org_id, last_synced_at, error_count, last_error, last_warning)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(scope) DO UPDATE SET
                last_synced_at = COALESCE(excluded.last_synced_at, last_synced_at),
                error_count = excluded.error_count,
                last_error = excluded.last_error,
                last_warning = excluded.last_warning
            "#,
            params![
                scope,
                org_id,
                last_synced_at,
                error_count,
                last_error,
                last_warning
            ],
        )?;
        Ok(())
    }

    pub fn list_mention_history(
        &self,
        org_id: &str,
        limit: usize,
    ) -> Result<Vec<MentionHistoryEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT unique_name, display_name, user_id FROM mention_history \
             WHERE org_id = ?1 \
             ORDER BY interaction_count DESC, last_used_at DESC \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![org_id, limit as i64], |row| {
            Ok(MentionHistoryEntry {
                unique_name: row.get(0)?,
                display_name: row.get(1)?,
                user_id: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_mention_interaction(
        &self,
        org_id: &str,
        unique_name: &str,
        display_name: &str,
        user_id: Option<&str>,
        now: &str,
    ) -> Result<()> {
        let unique_name_lower = unique_name.to_lowercase();
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO mention_history(org_id, unique_name, display_name, user_id, interaction_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)
             ON CONFLICT(org_id, unique_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 user_id = COALESCE(excluded.user_id, user_id),
                 interaction_count = interaction_count + 1,
                 last_used_at = excluded.last_used_at",
            params![org_id, unique_name_lower, display_name, user_id, now],
        )?;
        Ok(())
    }

    pub fn list_assignee_history(
        &self,
        org_id: &str,
        limit: usize,
    ) -> Result<Vec<MentionHistoryEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT unique_name, display_name, user_id FROM assignee_history \
             WHERE org_id = ?1 \
             ORDER BY interaction_count DESC, last_used_at DESC \
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![org_id, limit as i64], |row| {
            Ok(MentionHistoryEntry {
                unique_name: row.get(0)?,
                display_name: row.get(1)?,
                user_id: row.get(2)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn record_assignee_interaction(
        &self,
        org_id: &str,
        unique_name: &str,
        display_name: &str,
        user_id: Option<&str>,
        now: &str,
    ) -> Result<()> {
        let unique_name_lower = unique_name.to_lowercase();
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO assignee_history(org_id, unique_name, display_name, user_id, interaction_count, last_used_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)
             ON CONFLICT(org_id, unique_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 user_id = COALESCE(excluded.user_id, user_id),
                 interaction_count = interaction_count + 1,
                 last_used_at = excluded.last_used_at",
            params![org_id, unique_name_lower, display_name, user_id, now],
        )?;
        Ok(())
    }
}

// ── Migration ─────────────────────────────────────────────────────────────────

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "recursive_triggers", "ON")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(AppError::Database(format!(
            "database schema version {current} is newer than supported version {SCHEMA_VERSION}"
        )));
    }
    if current < 1 {
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS app_settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS organizations(
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                display_name TEXT,
                base_url TEXT NOT NULL,
                auth_provider TEXT NOT NULL,
                credential_key TEXT NOT NULL,
                authenticated_user_id TEXT,
                authenticated_user_display_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            PRAGMA user_version = 1;
            "#,
        )?;
    }
    if current < 2 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS pull_requests(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                repository_id TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT,
                creation_date TEXT NOT NULL,
                source_ref_name TEXT NOT NULL,
                target_ref_name TEXT NOT NULL,
                web_url TEXT,
                PRIMARY KEY (org_id, repository_id, pull_request_id)
            );
            CREATE INDEX IF NOT EXISTS idx_prs_status
                ON pull_requests(org_id, status, creation_date DESC);
            CREATE INDEX IF NOT EXISTS idx_prs_project
                ON pull_requests(org_id, project_id);

            CREATE TABLE IF NOT EXISTS review_pull_requests(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                repository_id TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                created_by TEXT,
                creation_date TEXT NOT NULL,
                target_ref_name TEXT NOT NULL,
                web_url TEXT,
                my_vote INTEGER NOT NULL DEFAULT 0,
                my_vote_label TEXT NOT NULL DEFAULT '',
                my_is_required INTEGER NOT NULL DEFAULT 0,
                is_draft INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (org_id, repository_id, pull_request_id)
            );
            CREATE INDEX IF NOT EXISTS idx_rprs_vote
                ON review_pull_requests(org_id, my_vote);

            CREATE TABLE IF NOT EXISTS work_items(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                id INTEGER NOT NULL,
                title TEXT NOT NULL,
                work_item_type TEXT,
                state TEXT,
                assigned_to TEXT,
                changed_date TEXT,
                web_url TEXT,
                PRIMARY KEY (org_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_wi_state
                ON work_items(org_id, state, changed_date DESC);
            CREATE INDEX IF NOT EXISTS idx_wi_assigned
                ON work_items(org_id, assigned_to);

            CREATE VIRTUAL TABLE IF NOT EXISTS work_items_fts USING fts5(
                org_id UNINDEXED,
                item_id UNINDEXED,
                title
            );
            CREATE TRIGGER IF NOT EXISTS work_items_fts_ai
                AFTER INSERT ON work_items BEGIN
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                    VALUES (new.rowid, new.org_id, new.id, new.title);
                END;
            CREATE TRIGGER IF NOT EXISTS work_items_fts_ad
                AFTER DELETE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                END;
            CREATE TRIGGER IF NOT EXISTS work_items_fts_au
                AFTER UPDATE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                    VALUES (new.rowid, new.org_id, new.id, new.title);
                END;

            CREATE TABLE IF NOT EXISTS commits(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                repository_id TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                commit_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                author_name TEXT,
                author_email TEXT,
                author_date TEXT,
                web_url TEXT,
                PRIMARY KEY (org_id, repository_id, commit_id)
            );
            CREATE INDEX IF NOT EXISTS idx_commits_date
                ON commits(org_id, repository_id, author_date DESC);
            CREATE INDEX IF NOT EXISTS idx_commits_author
                ON commits(org_id, author_email);

            CREATE VIRTUAL TABLE IF NOT EXISTS commits_fts USING fts5(
                org_id UNINDEXED,
                repository_id UNINDEXED,
                commit_id UNINDEXED,
                comment,
                author_name
            );
            CREATE TRIGGER IF NOT EXISTS commits_fts_ai
                AFTER INSERT ON commits BEGIN
                    INSERT INTO commits_fts(rowid, org_id, repository_id, commit_id, comment, author_name)
                    VALUES (new.rowid, new.org_id, new.repository_id, new.commit_id, new.comment, new.author_name);
                END;
            CREATE TRIGGER IF NOT EXISTS commits_fts_ad
                AFTER DELETE ON commits BEGIN
                    DELETE FROM commits_fts WHERE rowid = old.rowid;
                END;
            CREATE TRIGGER IF NOT EXISTS commits_fts_au
                AFTER UPDATE ON commits BEGIN
                    DELETE FROM commits_fts WHERE rowid = old.rowid;
                    INSERT INTO commits_fts(rowid, org_id, repository_id, commit_id, comment, author_name)
                    VALUES (new.rowid, new.org_id, new.repository_id, new.commit_id, new.comment, new.author_name);
                END;

            CREATE TABLE IF NOT EXISTS sync_state(
                scope TEXT PRIMARY KEY,
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                last_synced_at TEXT,
                error_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_state_org ON sync_state(org_id);

            PRAGMA user_version = 2;
            "#,
        )?;
    }
    if current < 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS my_work_items(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                id INTEGER NOT NULL,
                title TEXT NOT NULL,
                work_item_type TEXT,
                state TEXT,
                assigned_to TEXT,
                changed_date TEXT,
                web_url TEXT,
                PRIMARY KEY (org_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_mywi_changed
                ON my_work_items(org_id, changed_date DESC);

            PRAGMA user_version = 3;
            "#,
        )?;
    }
    if current < 4 {
        conn.execute_batch(
            r#"
            ALTER TABLE work_items ADD COLUMN assigned_to_unique_name TEXT;
            ALTER TABLE my_work_items ADD COLUMN assigned_to_unique_name TEXT;
            PRAGMA user_version = 4;
            "#,
        )?;
    }
    if current < 5 {
        conn.execute_batch(
            r#"
            DROP TRIGGER IF EXISTS work_items_fts_au;
            DROP TRIGGER IF EXISTS work_items_fts_ad;
            DROP TRIGGER IF EXISTS work_items_fts_ai;
            DROP TABLE IF EXISTS work_items_fts;

            CREATE VIRTUAL TABLE work_items_fts USING fts5(
                org_id UNINDEXED,
                item_id UNINDEXED,
                title,
                work_item_type,
                assigned_to
            );

            CREATE TRIGGER work_items_fts_ai
                AFTER INSERT ON work_items BEGIN
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to)
                    VALUES (new.rowid, new.org_id, new.id, new.title, new.work_item_type, new.assigned_to);
                END;

            CREATE TRIGGER work_items_fts_ad
                AFTER DELETE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                END;

            CREATE TRIGGER work_items_fts_au
                AFTER UPDATE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to)
                    VALUES (new.rowid, new.org_id, new.id, new.title, new.work_item_type, new.assigned_to);
                END;

            INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to)
                SELECT rowid, org_id, id, title, work_item_type, assigned_to FROM work_items;

            PRAGMA user_version = 5;
            "#,
        )?;
    }
    if current < 6 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS mention_history(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                unique_name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                user_id TEXT,
                interaction_count INTEGER NOT NULL DEFAULT 1,
                last_used_at TEXT NOT NULL,
                PRIMARY KEY (org_id, unique_name)
            );
            CREATE INDEX IF NOT EXISTS idx_mention_history_rank
                ON mention_history(org_id, interaction_count DESC, last_used_at DESC);

            PRAGMA user_version = 6;
            "#,
        )?;
    }
    if current < 7 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sync_state(
                scope TEXT PRIMARY KEY,
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                last_synced_at TEXT,
                error_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                last_warning TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_state_org ON sync_state(org_id);
            "#,
        )?;
        if !table_column_exists(conn, "sync_state", "last_warning")? {
            conn.execute_batch("ALTER TABLE sync_state ADD COLUMN last_warning TEXT;")?;
        }
        conn.execute_batch("PRAGMA user_version = 7;")?;
    }
    if current < 8 {
        if !table_column_exists(conn, "organizations", "authenticated_user_unique_name")? {
            conn.execute_batch(
                "ALTER TABLE organizations ADD COLUMN authenticated_user_unique_name TEXT;",
            )?;
        }
        conn.execute_batch("PRAGMA user_version = 8;")?;
    }
    if current < 9 {
        // Minimal legacy databases may not have the table at all; create it in
        // its current shape before adding the column.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS review_pull_requests(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                repository_id TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                created_by TEXT,
                creation_date TEXT NOT NULL,
                target_ref_name TEXT NOT NULL,
                web_url TEXT,
                my_vote INTEGER NOT NULL DEFAULT 0,
                my_vote_label TEXT NOT NULL DEFAULT '',
                my_is_required INTEGER NOT NULL DEFAULT 0,
                is_draft INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (org_id, repository_id, pull_request_id)
            );
            "#,
        )?;
        if !table_column_exists(conn, "review_pull_requests", "merge_status")? {
            conn.execute_batch("ALTER TABLE review_pull_requests ADD COLUMN merge_status TEXT;")?;
        }
        conn.execute_batch("PRAGMA user_version = 9;")?;
    }
    if current < 10 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS assignee_history(
                org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                unique_name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                user_id TEXT,
                interaction_count INTEGER NOT NULL DEFAULT 1,
                last_used_at TEXT NOT NULL,
                PRIMARY KEY (org_id, unique_name)
            );
            CREATE INDEX IF NOT EXISTS idx_assignee_history_rank
                ON assignee_history(org_id, interaction_count DESC, last_used_at DESC);

            PRAGMA user_version = 10;
            "#,
        )?;
    }
    if current < 11 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS pr_comment_seen(
                organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                repository_id TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL,
                last_seen_comment_id INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (organization_id, repository_id, pull_request_id)
            );

            PRAGMA user_version = 11;
            "#,
        )?;
    }
    if current < 12 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS snoozed_items(
                organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                item_type         TEXT NOT NULL,
                item_key          TEXT NOT NULL,
                snooze_until      TEXT NOT NULL,
                baseline_activity TEXT,
                created_at        TEXT NOT NULL,
                PRIMARY KEY (organization_id, item_type, item_key)
            );

            PRAGMA user_version = 12;
            "#,
        )?;
    }
    Ok(())
}

fn table_column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in columns {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

// ── Private helpers — organizations ──────────────────────────────────────────

fn list_organizations(conn: &Connection) -> Result<Vec<Organization>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, name, display_name, base_url, auth_provider, credential_key,
               authenticated_user_id, authenticated_user_display_name,
               authenticated_user_unique_name, created_at, updated_at
        FROM organizations
        ORDER BY name ASC
        "#,
    )?;
    let rows = stmt.query_map([], map_organization)?;
    let mut orgs = Vec::new();
    for row in rows {
        orgs.push(row?);
    }
    Ok(orgs)
}

fn get_organization(conn: &Connection, id: &str) -> Result<Option<Organization>> {
    Ok(conn
        .query_row(
            r#"
            SELECT id, name, display_name, base_url, auth_provider, credential_key,
                   authenticated_user_id, authenticated_user_display_name,
                   authenticated_user_unique_name, created_at, updated_at
            FROM organizations WHERE id = ?1
            "#,
            [id],
            map_organization,
        )
        .optional()?)
}

fn upsert_organization(conn: &Connection, draft: OrganizationDraft) -> Result<Organization> {
    let now = Utc::now().to_rfc3339();
    let created_at = existing_created_at(conn, &draft.id)?.unwrap_or_else(|| now.clone());
    conn.execute(
        r#"
        INSERT INTO organizations(
            id, name, display_name, base_url, auth_provider, credential_key,
            authenticated_user_id, authenticated_user_display_name,
            authenticated_user_unique_name, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            display_name = excluded.display_name,
            base_url = excluded.base_url,
            auth_provider = excluded.auth_provider,
            credential_key = excluded.credential_key,
            authenticated_user_id = excluded.authenticated_user_id,
            authenticated_user_display_name = excluded.authenticated_user_display_name,
            authenticated_user_unique_name = excluded.authenticated_user_unique_name,
            updated_at = excluded.updated_at
        "#,
        params![
            draft.id,
            draft.name,
            draft.display_name,
            draft.base_url,
            draft.auth_provider,
            draft.credential_key,
            draft.authenticated_user_id,
            draft.authenticated_user_display_name,
            draft.authenticated_user_unique_name,
            created_at,
            now
        ],
    )?;
    get_organization(conn, &draft.id)?
        .ok_or_else(|| AppError::Database("organization was not persisted".to_string()))
}

fn existing_created_at(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT created_at FROM organizations WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?)
}

fn delete_organization(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM organizations WHERE id = ?1", [id])?;
    Ok(())
}

// ── Private helpers — app settings ───────────────────────────────────────────

fn get_app_settings(conn: &Connection) -> Result<AppSettings> {
    Ok(AppSettings {
        review_result_folder_path: get_setting(conn, "review_result_folder_path")?,
        show_window_hotkey: get_setting(conn, "show_window_hotkey")?,
        read_only_validation_mode_enabled: get_bool_setting(
            conn,
            "read_only_validation_mode_enabled",
            false,
        )?,
        desktop_notifications_enabled: get_bool_setting(
            conn,
            "desktop_notifications_enabled",
            false,
        )?,
        notification_content_preview_enabled: get_bool_setting(
            conn,
            "notification_content_preview_enabled",
            true,
        )?,
        notify_work_item_assignments: get_bool_setting(conn, "notify_work_item_assignments", true)?,
        notify_work_item_state_changes: get_bool_setting(
            conn,
            "notify_work_item_state_changes",
            true,
        )?,
        notify_pr_review_requests: get_bool_setting(conn, "notify_pr_review_requests", true)?,
        notify_pr_vote_resets: get_bool_setting(conn, "notify_pr_vote_resets", true)?,
        notify_pr_comment_replies: get_bool_setting(conn, "notify_pr_comment_replies", true)?,
        review_stale_threshold_days: get_review_stale_threshold_days(conn)?,
    })
}

fn get_review_stale_threshold_days(conn: &Connection) -> Result<i64> {
    let value = get_setting(conn, "review_stale_threshold_days")?
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|days| REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(days))
        .unwrap_or(DEFAULT_REVIEW_STALE_THRESHOLD_DAYS);
    Ok(value)
}

fn update_app_settings(conn: &Connection, settings: AppSettings) -> Result<AppSettings> {
    set_setting(
        conn,
        "review_result_folder_path",
        settings.review_result_folder_path.as_deref(),
    )?;
    set_setting(
        conn,
        "show_window_hotkey",
        settings.show_window_hotkey.as_deref(),
    )?;
    set_bool_setting(
        conn,
        "read_only_validation_mode_enabled",
        settings.read_only_validation_mode_enabled,
    )?;
    set_bool_setting(
        conn,
        "desktop_notifications_enabled",
        settings.desktop_notifications_enabled,
    )?;
    set_bool_setting(
        conn,
        "notification_content_preview_enabled",
        settings.notification_content_preview_enabled,
    )?;
    set_bool_setting(
        conn,
        "notify_work_item_assignments",
        settings.notify_work_item_assignments,
    )?;
    set_bool_setting(
        conn,
        "notify_work_item_state_changes",
        settings.notify_work_item_state_changes,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_review_requests",
        settings.notify_pr_review_requests,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_vote_resets",
        settings.notify_pr_vote_resets,
    )?;
    set_bool_setting(
        conn,
        "notify_pr_comment_replies",
        settings.notify_pr_comment_replies,
    )?;
    let stale_days =
        if REVIEW_STALE_THRESHOLD_DAY_OPTIONS.contains(&settings.review_stale_threshold_days) {
            settings.review_stale_threshold_days
        } else {
            DEFAULT_REVIEW_STALE_THRESHOLD_DAYS
        };
    set_setting(
        conn,
        "review_stale_threshold_days",
        Some(&stale_days.to_string()),
    )?;
    get_app_settings(conn)
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => {
            conn.execute(
                r#"
                INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                "#,
                params![key, v, Utc::now().to_rfc3339()],
            )?;
        }
        None => {
            conn.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
        }
    }
    Ok(())
}

fn get_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT last_seen_comment_id FROM pr_comment_seen \
             WHERE organization_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn set_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
    last_seen_comment_id: i64,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO pr_comment_seen(organization_id, repository_id, pull_request_id, last_seen_comment_id, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(organization_id, repository_id, pull_request_id)
        DO UPDATE SET last_seen_comment_id = excluded.last_seen_comment_id, updated_at = excluded.updated_at
        "#,
        params![
            org_id,
            repository_id,
            pull_request_id,
            last_seen_comment_id,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn upsert_snoozed_item(
    conn: &Connection,
    org_id: &str,
    item_type: &str,
    item_key: &str,
    snooze_until: &str,
    baseline_activity: Option<&str>,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO snoozed_items(organization_id, item_type, item_key, snooze_until, baseline_activity, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(organization_id, item_type, item_key)
        DO UPDATE SET snooze_until = excluded.snooze_until, baseline_activity = excluded.baseline_activity
        "#,
        params![
            org_id,
            item_type,
            item_key,
            snooze_until,
            baseline_activity,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn list_snoozed_items(
    conn: &Connection,
    org_id: &str,
    item_type: &str,
) -> Result<Vec<SnoozedItem>> {
    let mut stmt = conn.prepare(
        "SELECT item_type, item_key, snooze_until, baseline_activity, created_at \
         FROM snoozed_items WHERE organization_id = ?1 AND item_type = ?2 \
         ORDER BY snooze_until ASC",
    )?;
    let rows = stmt.query_map(params![org_id, item_type], |row| {
        Ok(SnoozedItem {
            item_type: row.get(0)?,
            item_key: row.get(1)?,
            snooze_until: row.get(2)?,
            baseline_activity: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn get_bool_setting(conn: &Connection, key: &str, default_value: bool) -> Result<bool> {
    Ok(get_setting(conn, key)?
        .as_deref()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "yes"
            )
        })
        .unwrap_or(default_value))
}

fn set_bool_setting(conn: &Connection, key: &str, value: bool) -> Result<()> {
    set_setting(conn, key, Some(if value { "true" } else { "false" }))
}

// ── Private helpers — pull requests ──────────────────────────────────────────

fn upsert_pull_requests(conn: &Connection, prs: &[CachedPr]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO pull_requests(
            org_id, project_id, project_name, repository_id, repository_name,
            pull_request_id, title, status, created_by, creation_date,
            source_ref_name, target_ref_name, web_url
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(org_id, repository_id, pull_request_id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            repository_name = excluded.repository_name,
            title = excluded.title,
            status = excluded.status,
            created_by = excluded.created_by,
            creation_date = excluded.creation_date,
            source_ref_name = excluded.source_ref_name,
            target_ref_name = excluded.target_ref_name,
            web_url = excluded.web_url
        "#,
    )?;
    for pr in prs {
        stmt.execute(params![
            pr.org_id,
            pr.project_id,
            pr.project_name,
            pr.repository_id,
            pr.repository_name,
            pr.pull_request_id,
            pr.title,
            pr.status,
            pr.created_by,
            pr.creation_date,
            pr.source_ref_name,
            pr.target_ref_name,
            pr.web_url
        ])?;
    }
    Ok(())
}

fn search_pull_requests(
    conn: &Connection,
    org_id: &str,
    project_id: Option<&str>,
    repository_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<CachedPr>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               pull_request_id, title, status, created_by, creation_date,
               source_ref_name, target_ref_name, web_url
        FROM pull_requests
        WHERE org_id = ?1
          AND (?2 IS NULL OR project_id = ?2)
          AND (?3 IS NULL OR repository_id = ?3)
          AND (?4 IS NULL OR status = ?4)
        ORDER BY creation_date DESC
        LIMIT 500
        "#,
    )?;
    let rows = stmt.query_map(
        params![org_id, project_id, repository_id, status],
        map_cached_pr,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

// ── Private helpers — review PRs ─────────────────────────────────────────────

fn upsert_review_pull_requests(conn: &Connection, prs: &[CachedReviewPr]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO review_pull_requests(
            org_id, project_id, project_name, repository_id, repository_name,
            pull_request_id, title, created_by, creation_date, target_ref_name,
            web_url, my_vote, my_vote_label, my_is_required, is_draft, merge_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(org_id, repository_id, pull_request_id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            repository_name = excluded.repository_name,
            title = excluded.title,
            created_by = excluded.created_by,
            creation_date = excluded.creation_date,
            target_ref_name = excluded.target_ref_name,
            web_url = excluded.web_url,
            my_vote = excluded.my_vote,
            my_vote_label = excluded.my_vote_label,
            my_is_required = excluded.my_is_required,
            is_draft = excluded.is_draft,
            merge_status = excluded.merge_status
        "#,
    )?;
    for pr in prs {
        stmt.execute(params![
            pr.org_id,
            pr.project_id,
            pr.project_name,
            pr.repository_id,
            pr.repository_name,
            pr.pull_request_id,
            pr.title,
            pr.created_by,
            pr.creation_date,
            pr.target_ref_name,
            pr.web_url,
            pr.my_vote,
            pr.my_vote_label,
            pr.my_is_required as i32,
            pr.is_draft as i32,
            pr.merge_status
        ])?;
    }
    Ok(())
}

fn list_review_pull_requests(conn: &Connection, org_id: &str) -> Result<Vec<CachedReviewPr>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               pull_request_id, title, created_by, creation_date, target_ref_name,
               web_url, my_vote, my_vote_label, my_is_required, is_draft, merge_status
        FROM review_pull_requests
        WHERE org_id = ?1
        ORDER BY creation_date DESC
        LIMIT 500
        "#,
    )?;
    let rows = stmt.query_map([org_id], map_cached_review_pr)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

// ── Private helpers — work items ──────────────────────────────────────────────

fn upsert_work_items(conn: &Connection, items: &[CachedWorkItem]) -> Result<()> {
    // Azure DevOps bumps System.ChangedDate on every revision, so it works as
    // a version stamp: rows with an unchanged date are skipped entirely and
    // the FTS update trigger never fires for them.
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO work_items(
            org_id, project_id, project_name, id, title,
            work_item_type, state, assigned_to, changed_date, web_url,
            assigned_to_unique_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(org_id, id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            title = excluded.title,
            work_item_type = excluded.work_item_type,
            state = excluded.state,
            assigned_to = excluded.assigned_to,
            changed_date = excluded.changed_date,
            web_url = excluded.web_url,
            assigned_to_unique_name = excluded.assigned_to_unique_name
        WHERE excluded.changed_date IS NOT work_items.changed_date
        "#,
    )?;
    for item in items {
        stmt.execute(params![
            item.org_id,
            item.project_id,
            item.project_name,
            item.id,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.changed_date,
            item.web_url,
            item.assigned_to_unique_name
        ])?;
    }
    Ok(())
}

fn search_work_items(
    conn: &Connection,
    org_id: &str,
    project_id: Option<&str>,
    state: Option<&str>,
    work_item_type: Option<&str>,
    assigned_to: Option<&str>,
) -> Result<Vec<CachedWorkItem>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM work_items
        WHERE org_id = ?1
          AND (?2 IS NULL OR project_id = ?2)
          AND (?3 IS NULL OR state = ?3)
          AND (?4 IS NULL OR work_item_type = ?4)
          AND (?5 IS NULL OR assigned_to = ?5)
        ORDER BY changed_date DESC
        LIMIT 500
        "#,
    )?;
    let rows = stmt.query_map(
        params![org_id, project_id, state, work_item_type, assigned_to],
        map_cached_work_item,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn search_work_items_fts(
    conn: &Connection,
    org_id: &str,
    query: &str,
) -> Result<Vec<CachedWorkItem>> {
    // Numeric queries also match work item IDs (exact match first, then prefix).
    let mut result = if !query.is_empty() && query.bytes().all(|b| b.is_ascii_digit()) {
        search_work_items_by_id_prefix(conn, org_id, query)?
    } else {
        Vec::new()
    };
    let fts_query = fts5_query(query);
    if fts_query.is_empty() {
        return Ok(result);
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT w.org_id, w.project_id, w.project_name, w.id, w.title,
               w.work_item_type, w.state, w.assigned_to, w.changed_date, w.web_url,
               w.assigned_to_unique_name
        FROM work_items w
        WHERE w.org_id = ?2
          AND w.id IN (
              SELECT item_id FROM work_items_fts
              WHERE work_items_fts MATCH ?1 AND org_id = ?2
          )
        ORDER BY w.changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![fts_query, org_id], map_cached_work_item)?;
    let mut text_matches = Vec::new();
    for row in rows {
        text_matches.push(row?);
    }
    if text_matches.is_empty() {
        // FTS tokenization cannot match substrings inside CJK text; fall back
        // to a LIKE scan so Japanese queries still find cached work items.
        text_matches = search_work_items_like(conn, org_id, query)?;
    }
    if result.is_empty() {
        return Ok(text_matches);
    }
    for item in text_matches {
        if !result
            .iter()
            .any(|r| r.id == item.id && r.project_id == item.project_id)
        {
            result.push(item);
        }
    }
    Ok(result)
}

fn search_work_items_by_id_prefix(
    conn: &Connection,
    org_id: &str,
    digits: &str,
) -> Result<Vec<CachedWorkItem>> {
    let pattern = format!("{digits}%");
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM work_items
        WHERE org_id = ?1
          AND CAST(id AS TEXT) LIKE ?2
        ORDER BY (CAST(id AS TEXT) = ?3) DESC, changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![org_id, pattern, digits], map_cached_work_item)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn search_work_items_like(
    conn: &Connection,
    org_id: &str,
    query: &str,
) -> Result<Vec<CachedWorkItem>> {
    let pattern = format!("%{}%", escape_like_pattern(query));
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM work_items
        WHERE org_id = ?1
          AND (title LIKE ?2 ESCAPE '\'
               OR work_item_type LIKE ?2 ESCAPE '\'
               OR assigned_to LIKE ?2 ESCAPE '\')
        ORDER BY changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![org_id, pattern], map_cached_work_item)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn upsert_my_work_items(conn: &Connection, items: &[CachedWorkItem]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT OR REPLACE INTO my_work_items(
            org_id, project_id, project_name, id, title,
            work_item_type, state, assigned_to, changed_date, web_url,
            assigned_to_unique_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
    )?;
    for item in items {
        stmt.execute(params![
            item.org_id,
            item.project_id,
            item.project_name,
            item.id,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.changed_date,
            item.web_url,
            item.assigned_to_unique_name
        ])?;
    }
    Ok(())
}

fn list_my_work_items(conn: &Connection, org_id: &str) -> Result<Vec<CachedWorkItem>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM my_work_items
        WHERE org_id = ?1
        ORDER BY changed_date DESC
        LIMIT ?2
        "#,
    )?;
    let rows = stmt.query_map(
        params![org_id, MY_WORK_ITEMS_LIMIT as i64],
        map_cached_work_item,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

// ── Private helpers — commits ─────────────────────────────────────────────────

fn upsert_commits(conn: &Connection, commits: &[CachedCommit]) -> Result<()> {
    // Commits are immutable; only project/repo display metadata can change
    // (e.g. a repository rename), so unchanged rows are skipped.
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO commits(
            org_id, project_id, project_name, repository_id, repository_name,
            commit_id, comment, author_name, author_email, author_date, web_url
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(org_id, repository_id, commit_id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            repository_name = excluded.repository_name,
            web_url = excluded.web_url
        WHERE excluded.project_name IS NOT commits.project_name
           OR excluded.repository_name IS NOT commits.repository_name
           OR excluded.web_url IS NOT commits.web_url
        "#,
    )?;
    for c in commits {
        stmt.execute(params![
            c.org_id,
            c.project_id,
            c.project_name,
            c.repository_id,
            c.repository_name,
            c.commit_id,
            c.comment,
            c.author_name,
            c.author_email,
            c.author_date,
            c.web_url
        ])?;
    }
    Ok(())
}

fn search_commits(
    conn: &Connection,
    org_id: &str,
    repository_id: Option<&str>,
    author_email: Option<&str>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<CachedCommit>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               commit_id, comment, author_name, author_email, author_date, web_url
        FROM commits
        WHERE org_id = ?1
          AND (?2 IS NULL OR repository_id = ?2)
          AND (?3 IS NULL OR author_email = ?3)
          AND (?4 IS NULL OR author_date >= ?4)
          AND (?5 IS NULL OR author_date <= ?5)
        ORDER BY author_date DESC
        LIMIT 500
        "#,
    )?;
    let rows = stmt.query_map(
        params![org_id, repository_id, author_email, from_date, to_date],
        map_cached_commit,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn search_commits_fts(
    conn: &Connection,
    org_id: &str,
    query: &str,
    repository_id: Option<&str>,
) -> Result<Vec<CachedCommit>> {
    let fts_query = fts5_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT c.org_id, c.project_id, c.project_name, c.repository_id, c.repository_name,
               c.commit_id, c.comment, c.author_name, c.author_email, c.author_date, c.web_url
        FROM commits c
        WHERE c.org_id = ?2
          AND (?3 IS NULL OR c.repository_id = ?3)
          AND c.commit_id IN (
              SELECT commit_id FROM commits_fts
              WHERE commits_fts MATCH ?1
                AND org_id = ?2
                AND (?3 IS NULL OR repository_id = ?3)
          )
        ORDER BY c.author_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![fts_query, org_id, repository_id], map_cached_commit)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn list_commit_repositories(conn: &Connection, org_id: &str) -> Result<Vec<CachedRepository>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT DISTINCT project_id, project_name, repository_id, repository_name
        FROM commits WHERE org_id = ?1
        ORDER BY project_name, repository_name
        "#,
    )?;
    let rows = stmt.query_map([org_id], |row| {
        Ok(CachedRepository {
            project_id: row.get(0)?,
            project_name: row.get(1)?,
            repository_id: row.get(2)?,
            repository_name: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

// ── FTS helpers ───────────────────────────────────────────────────────────────

fn fts5_query(input: &str) -> String {
    let words: Vec<String> = input
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect();
    words.join(" OR ")
}

// ── Row mappers ───────────────────────────────────────────────────────────────

fn map_organization(row: &rusqlite::Row<'_>) -> rusqlite::Result<Organization> {
    Ok(Organization {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        base_url: row.get(3)?,
        auth_provider: row.get(4)?,
        credential_key: row.get(5)?,
        authenticated_user_id: row.get(6)?,
        authenticated_user_display_name: row.get(7)?,
        authenticated_user_unique_name: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn map_cached_pr(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedPr> {
    Ok(CachedPr {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        pull_request_id: row.get(5)?,
        title: row.get(6)?,
        status: row.get(7)?,
        created_by: row.get(8)?,
        creation_date: row.get(9)?,
        source_ref_name: row.get(10)?,
        target_ref_name: row.get(11)?,
        web_url: row.get(12)?,
    })
}

fn map_cached_review_pr(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedReviewPr> {
    Ok(CachedReviewPr {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        pull_request_id: row.get(5)?,
        title: row.get(6)?,
        created_by: row.get(7)?,
        creation_date: row.get(8)?,
        target_ref_name: row.get(9)?,
        web_url: row.get(10)?,
        my_vote: row.get(11)?,
        my_vote_label: row.get(12)?,
        my_is_required: row.get::<_, i32>(13)? != 0,
        is_draft: row.get::<_, i32>(14)? != 0,
        merge_status: row.get(15)?,
    })
}

fn map_cached_work_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedWorkItem> {
    Ok(CachedWorkItem {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        id: row.get(3)?,
        title: row.get(4)?,
        work_item_type: row.get(5)?,
        state: row.get(6)?,
        assigned_to: row.get(7)?,
        changed_date: row.get(8)?,
        web_url: row.get(9)?,
        assigned_to_unique_name: row.get(10)?,
    })
}

fn map_cached_commit(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedCommit> {
    Ok(CachedCommit {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        commit_id: row.get(5)?,
        comment: row.get(6)?,
        author_name: row.get(7)?,
        author_email: row.get(8)?,
        author_date: row.get(9)?,
        web_url: row.get(10)?,
    })
}

fn map_sync_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncState> {
    Ok(SyncState {
        scope: row.get(0)?,
        org_id: row.get(1)?,
        last_synced_at: row.get(2)?,
        error_count: row.get(3)?,
        last_error: row.get(4)?,
        last_warning: row.get(5)?,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn make_org_draft(id: &str) -> OrganizationDraft {
        OrganizationDraft {
            id: id.to_string(),
            name: id.to_string(),
            display_name: None,
            base_url: format!("https://dev.azure.com/{id}"),
            auth_provider: "pat".to_string(),
            credential_key: format!("azdodeck:org:{id}:pat"),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
        }
    }

    #[test]
    fn open_applies_connection_pragmas() {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();

        let conn = db.open().unwrap();
        let synchronous: i64 = conn
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 1, "synchronous should be NORMAL");
        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 3000);
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode, "wal");
    }

    #[test]
    fn migrate_is_repeatable() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn pr_comment_seen_roundtrips() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org")).unwrap();
        assert_eq!(get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(), None);
        set_pr_comment_seen(&conn, "org", "repo", 42, 100).unwrap();
        assert_eq!(
            get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(),
            Some(100)
        );
        set_pr_comment_seen(&conn, "org", "repo", 42, 150).unwrap();
        assert_eq!(
            get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(),
            Some(150)
        );
    }

    #[test]
    fn snoozed_items_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org")).unwrap();

        assert!(list_snoozed_items(&conn, "org", "pull_request")
            .unwrap()
            .is_empty());

        upsert_snoozed_item(
            &conn,
            "org",
            "pull_request",
            "repo:42",
            "2026-06-20T09:00:00Z",
            Some("100"),
        )
        .unwrap();
        upsert_snoozed_item(&conn, "org", "work_item", "7", "2026-06-18T09:00:00Z", None).unwrap();

        let prs = list_snoozed_items(&conn, "org", "pull_request").unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].item_key, "repo:42");
        assert_eq!(prs[0].baseline_activity.as_deref(), Some("100"));

        // Re-snoozing the same key updates the deadline and baseline in place.
        upsert_snoozed_item(
            &conn,
            "org",
            "pull_request",
            "repo:42",
            "2026-06-25T09:00:00Z",
            Some("150"),
        )
        .unwrap();
        let prs = list_snoozed_items(&conn, "org", "pull_request").unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].snooze_until, "2026-06-25T09:00:00Z");
        assert_eq!(prs[0].baseline_activity.as_deref(), Some("150"));

        let work_items = list_snoozed_items(&conn, "org", "work_item").unwrap();
        assert_eq!(work_items.len(), 1);
        assert_eq!(work_items[0].baseline_activity, None);
    }

    #[test]
    fn migrate_v1_db_upgrades_to_latest() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS organizations(
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT,
                base_url TEXT NOT NULL, auth_provider TEXT NOT NULL, credential_key TEXT NOT NULL,
                authenticated_user_id TEXT, authenticated_user_display_name TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            "#,
        )
        .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='commits'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let fts_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='work_items_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);

        let mywi_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='my_work_items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mywi_count, 1);
    }

    #[test]
    fn migrate_v2_db_upgrades_to_v3() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE organizations(id TEXT PRIMARY KEY);
            CREATE TABLE work_items(
                org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
            PRAGMA user_version = 2;
            "#,
        )
        .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let mywi_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='my_work_items'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mywi_count, 1);
    }

    #[test]
    fn upsert_preserves_created_at_and_updates_user() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let first = upsert_organization(
            &conn,
            OrganizationDraft {
                authenticated_user_id: Some("user-1".to_string()),
                authenticated_user_display_name: Some("First User".to_string()),
                ..make_org_draft("contoso")
            },
        )
        .unwrap();

        let second = upsert_organization(
            &conn,
            OrganizationDraft {
                authenticated_user_id: Some("user-2".to_string()),
                authenticated_user_display_name: Some("Second User".to_string()),
                ..make_org_draft("contoso")
            },
        )
        .unwrap();

        assert_eq!(first.created_at, second.created_at);
        assert_eq!(
            second.authenticated_user_display_name.as_deref(),
            Some("Second User")
        );
        assert_eq!(list_organizations(&conn).unwrap().len(), 1);
    }

    #[test]
    fn app_settings_can_be_saved_and_cleared() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        assert_eq!(get_app_settings(&conn).unwrap(), AppSettings::default());

        let saved = update_app_settings(
            &conn,
            AppSettings {
                review_result_folder_path: Some("C:/reports".to_string()),
                show_window_hotkey: Some("Ctrl+Alt+D".to_string()),
                read_only_validation_mode_enabled: true,
                desktop_notifications_enabled: true,
                notification_content_preview_enabled: false,
                notify_work_item_assignments: true,
                notify_work_item_state_changes: false,
                notify_pr_review_requests: false,
                notify_pr_vote_resets: true,
                notify_pr_comment_replies: false,
                review_stale_threshold_days: 7,
            },
        )
        .unwrap();
        assert_eq!(
            saved.review_result_folder_path.as_deref(),
            Some("C:/reports")
        );
        assert_eq!(saved.review_stale_threshold_days, 7);
        assert_eq!(saved.show_window_hotkey.as_deref(), Some("Ctrl+Alt+D"));
        assert!(saved.read_only_validation_mode_enabled);
        assert!(saved.desktop_notifications_enabled);
        assert!(!saved.notification_content_preview_enabled);
        assert!(saved.notify_work_item_assignments);
        assert!(!saved.notify_work_item_state_changes);
        assert!(!saved.notify_pr_review_requests);
        assert!(saved.notify_pr_vote_resets);
        assert!(!saved.notify_pr_comment_replies);

        let cleared = update_app_settings(
            &conn,
            AppSettings {
                review_result_folder_path: Some("   ".to_string()),
                show_window_hotkey: Some("   ".to_string()),
                ..AppSettings::default()
            },
        )
        .unwrap();
        assert_eq!(cleared, AppSettings::default());
    }

    #[test]
    fn work_items_fts_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org1")).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["org1", "p1", "Project One", 42_i64, "fix the login bug"],
        )
        .unwrap();

        let results = search_work_items_fts(&conn, "org1", "login").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 42);

        // Re-upsert same PK: FTS must not duplicate
        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["org1", "p1", "Project One", 42_i64, "fix the login timeout bug"],
        )
        .unwrap();

        let fts_count: i64 = conn
            .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts_count, 1);

        let results = search_work_items_fts(&conn, "org1", "timeout").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "fix the login timeout bug");
    }

    #[test]
    fn search_work_items_fts_matches_numeric_query_by_id() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org1")).unwrap();

        for (id, title) in [
            (42_i64, "fix the login bug"),
            (421_i64, "label 42 spike"),
            (9_i64, "error 42 cascade"),
        ] {
            conn.execute(
                "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["org1", "p1", "Project One", id, title],
            )
            .unwrap();
        }

        let results = search_work_items_fts(&conn, "org1", "42").unwrap();
        let ids: Vec<i64> = results.iter().map(|item| item.id).collect();
        // Exact ID match first, prefix and title matches follow without duplicates.
        assert_eq!(ids[0], 42);
        assert!(ids.contains(&421));
        assert!(ids.contains(&9));
        assert_eq!(ids.len(), 3);
    }

    fn make_cached_wi(id: i64, title: &str, changed: &str) -> CachedWorkItem {
        CachedWorkItem {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "Project One".to_string(),
            id,
            title: title.to_string(),
            work_item_type: Some("Task".to_string()),
            state: Some("Active".to_string()),
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: Some(changed.to_string()),
            web_url: None,
        }
    }

    #[test]
    fn replace_work_items_skips_unchanged_rows_and_deletes_stale() {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        db.replace_work_items(
            "org1",
            &["p1"],
            &[
                make_cached_wi(1, "first item", "2026-06-01T00:00:00Z"),
                make_cached_wi(2, "second item", "2026-06-01T00:00:00Z"),
            ],
            &[],
        )
        .unwrap();

        let conn = db.open().unwrap();
        let rowid_query = "SELECT rowid FROM work_items WHERE org_id = 'org1' AND id = 1";
        let rowid_before: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();

        // Re-sync: item 1 is unchanged, item 2 has a new revision.
        db.replace_work_items(
            "org1",
            &["p1"],
            &[
                make_cached_wi(1, "first item", "2026-06-01T00:00:00Z"),
                make_cached_wi(2, "second item edited", "2026-06-02T00:00:00Z"),
            ],
            &[],
        )
        .unwrap();

        let rowid_after: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();
        assert_eq!(
            rowid_before, rowid_after,
            "unchanged rows must not be rewritten"
        );
        let results = search_work_items_fts(&conn, "org1", "edited").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 2);

        // Items missing from the snapshot are deleted, including their FTS rows.
        db.replace_work_items(
            "org1",
            &["p1"],
            &[make_cached_wi(1, "first item", "2026-06-01T00:00:00Z")],
            &[],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM work_items WHERE org_id = 'org1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(search_work_items_fts(&conn, "org1", "second")
            .unwrap()
            .is_empty());
    }

    fn make_cached_commit(commit_id: &str, comment: &str) -> CachedCommit {
        CachedCommit {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "Project One".to_string(),
            repository_id: "repo1".to_string(),
            repository_name: "repo-one".to_string(),
            commit_id: commit_id.to_string(),
            comment: comment.to_string(),
            author_name: Some("Alice".to_string()),
            author_email: None,
            author_date: Some("2026-06-01T00:00:00Z".to_string()),
            web_url: None,
        }
    }

    #[test]
    fn replace_commits_skips_unchanged_rows_and_deletes_stale() {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        db.replace_commits_for_repo(
            "org1",
            "repo1",
            &[
                make_cached_commit("aaa111", "refactor auth middleware"),
                make_cached_commit("bbb222", "tune retry delays"),
            ],
        )
        .unwrap();

        let conn = db.open().unwrap();
        let rowid_query =
            "SELECT rowid FROM commits WHERE org_id = 'org1' AND commit_id = 'aaa111'";
        let rowid_before: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();

        // Next sync window: aaa111 unchanged, bbb222 gone, ccc333 new.
        db.replace_commits_for_repo(
            "org1",
            "repo1",
            &[
                make_cached_commit("aaa111", "refactor auth middleware"),
                make_cached_commit("ccc333", "add palette search"),
            ],
        )
        .unwrap();

        let rowid_after: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();
        assert_eq!(
            rowid_before, rowid_after,
            "unchanged rows must not be rewritten"
        );
        assert!(search_commits_fts(&conn, "org1", "retry", None)
            .unwrap()
            .is_empty());
        let results = search_commits_fts(&conn, "org1", "palette", None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].commit_id, "ccc333");
    }

    #[test]
    fn commits_fts_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org1")).unwrap();

        conn.execute(
            r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params!["org1", "p1", "Proj", "repo1", "Repo", "abc123", "refactor auth middleware"],
        )
        .unwrap();

        let results = search_commits_fts(&conn, "org1", "auth", None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].commit_id, "abc123");

        // Re-upsert same PK: FTS must not duplicate
        conn.execute(
            r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params!["org1", "p1", "Proj", "repo1", "Repo", "abc123", "refactor auth and session middleware"],
        )
        .unwrap();

        let fts_count: i64 = conn
            .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts_count, 1);

        let results = search_commits_fts(&conn, "org1", "session", None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].comment, "refactor auth and session middleware");
    }

    #[test]
    fn cascade_delete_clears_cache() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org1")).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["org1", "p1", "P1", 1_i64, "Test task"],
        )
        .unwrap();
        conn.execute(
            r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params!["org1", "p1", "P1", "r1", "Repo", "sha1", "initial commit"],
        )
        .unwrap();

        let wi_count: i64 = conn
            .query_row("SELECT count(*) FROM work_items", [], |r| r.get(0))
            .unwrap();
        let fts_wi: i64 = conn
            .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
            .unwrap();
        let c_count: i64 = conn
            .query_row("SELECT count(*) FROM commits", [], |r| r.get(0))
            .unwrap();
        let fts_c: i64 = conn
            .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!((wi_count, fts_wi, c_count, fts_c), (1, 1, 1, 1));

        conn.execute("DELETE FROM organizations WHERE id = 'org1'", [])
            .unwrap();

        let wi_count: i64 = conn
            .query_row("SELECT count(*) FROM work_items", [], |r| r.get(0))
            .unwrap();
        let fts_wi: i64 = conn
            .query_row("SELECT count(*) FROM work_items_fts", [], |r| r.get(0))
            .unwrap();
        let c_count: i64 = conn
            .query_row("SELECT count(*) FROM commits", [], |r| r.get(0))
            .unwrap();
        let fts_c: i64 = conn
            .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!((wi_count, fts_wi, c_count, fts_c), (0, 0, 0, 0));
    }

    #[test]
    fn pull_requests_search() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let pr = CachedPr {
            org_id: "org1".to_string(),
            project_id: "proj1".to_string(),
            project_name: "Project One".to_string(),
            repository_id: "repo1".to_string(),
            repository_name: "Repo One".to_string(),
            pull_request_id: 1,
            title: "Add feature X".to_string(),
            status: "active".to_string(),
            created_by: Some("Alice".to_string()),
            creation_date: "2024-01-01T00:00:00Z".to_string(),
            source_ref_name: "refs/heads/feature".to_string(),
            target_ref_name: "refs/heads/main".to_string(),
            web_url: None,
        };
        db.replace_pull_requests_for_projects("org1", &["p1"], &[pr])
            .unwrap();

        let results = db
            .search_pull_requests("org1", None, None, Some("active"))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].pull_request_id, 1);

        let no_results = db
            .search_pull_requests("org1", None, None, Some("completed"))
            .unwrap();
        assert!(no_results.is_empty());
    }

    #[test]
    fn sync_state_upsert_and_read() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        db.update_sync_state(
            "prs:org1",
            "org1",
            Some("2024-01-01T00:00:00Z"),
            0,
            None,
            Some("warning"),
        )
        .unwrap();
        let state = db.get_sync_state("prs:org1").unwrap().unwrap();
        assert_eq!(state.error_count, 0);
        assert_eq!(
            state.last_synced_at.as_deref(),
            Some("2024-01-01T00:00:00Z")
        );
        assert_eq!(state.last_warning.as_deref(), Some("warning"));

        db.update_sync_state("prs:org1", "org1", None, 2, Some("timeout"), None)
            .unwrap();
        let state = db.get_sync_state("prs:org1").unwrap().unwrap();
        assert_eq!(state.error_count, 2);
        assert_eq!(state.last_error.as_deref(), Some("timeout"));
        assert_eq!(state.last_warning, None);
        // A failed sync must not erase the last successful sync timestamp.
        assert_eq!(
            state.last_synced_at.as_deref(),
            Some("2024-01-01T00:00:00Z")
        );
    }

    #[test]
    fn list_mention_history_ranks_by_interaction_count() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        db.record_mention_interaction(
            "org1",
            "alice@corp.com",
            "Alice",
            None,
            "2026-06-01T00:00:00Z",
        )
        .unwrap();
        db.record_mention_interaction(
            "org1",
            "bob@corp.com",
            "Bob",
            Some("bob-id"),
            "2026-06-02T00:00:00Z",
        )
        .unwrap();
        db.record_mention_interaction("org1", "bob@corp.com", "Bob", None, "2026-06-03T00:00:00Z")
            .unwrap();

        let entries = db.list_mention_history("org1", 10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].unique_name, "bob@corp.com");
        assert_eq!(entries[0].display_name, "Bob");
        assert_eq!(entries[0].user_id.as_deref(), Some("bob-id"));
        assert_eq!(entries[1].unique_name, "alice@corp.com");
    }

    #[test]
    fn list_assignee_history_ranks_by_interaction_count() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        db.record_assignee_interaction(
            "org1",
            "alice@corp.com",
            "Alice",
            None,
            "2026-06-01T00:00:00Z",
        )
        .unwrap();
        db.record_assignee_interaction(
            "org1",
            "bob@corp.com",
            "Bob",
            Some("bob-id"),
            "2026-06-02T00:00:00Z",
        )
        .unwrap();
        db.record_assignee_interaction("org1", "bob@corp.com", "Bob", None, "2026-06-03T00:00:00Z")
            .unwrap();

        let entries = db.list_assignee_history("org1", 10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].unique_name, "bob@corp.com");
        assert_eq!(entries[0].display_name, "Bob");
        assert_eq!(entries[0].user_id.as_deref(), Some("bob-id"));
        assert_eq!(entries[1].unique_name, "alice@corp.com");

        // Assignee history must stay separate from mention history.
        assert!(db.list_mention_history("org1", 10).unwrap().is_empty());
    }

    #[test]
    fn search_work_items_fts_falls_back_to_like_for_cjk_substrings() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_organization(&conn, make_org_draft("org1")).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO work_items(org_id, project_id, project_name, id, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["org1", "p1", "Project One", 7_i64, "ユーザーログイン機能を修正"],
        )
        .unwrap();

        // Mid-string CJK term: FTS prefix queries cannot match, LIKE fallback should.
        let results = search_work_items_fts(&conn, "org1", "修正").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 7);

        let results = search_work_items_fts(&conn, "org1", "存在しない語").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn update_my_work_item_removes_row_when_reassigned_away() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let mine = CachedWorkItem {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            id: 5,
            title: "owned by me".to_string(),
            work_item_type: None,
            state: Some("Active".to_string()),
            assigned_to: Some("Me".to_string()),
            assigned_to_unique_name: Some("me@example.com".to_string()),
            changed_date: None,
            web_url: None,
        };
        db.replace_work_items(
            "org1",
            &["p1"],
            std::slice::from_ref(&mine),
            std::slice::from_ref(&mine),
        )
        .unwrap();
        assert_eq!(db.list_my_work_items("org1").unwrap().len(), 1);

        // Reassigned to someone else: the row must leave the my_work_items view.
        let reassigned = CachedWorkItem {
            assigned_to: Some("Other".to_string()),
            assigned_to_unique_name: Some("other@example.com".to_string()),
            ..mine.clone()
        };
        db.update_my_work_item_if_present(&reassigned, Some("me@example.com"))
            .unwrap();
        assert!(
            db.list_my_work_items("org1").unwrap().is_empty(),
            "reassigning away should drop the row immediately"
        );
    }

    #[test]
    fn update_my_work_item_keeps_row_when_still_mine() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let mine = CachedWorkItem {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            id: 5,
            title: "owned by me".to_string(),
            work_item_type: None,
            state: Some("Active".to_string()),
            assigned_to: Some("Me".to_string()),
            assigned_to_unique_name: Some("me@example.com".to_string()),
            changed_date: None,
            web_url: None,
        };
        db.replace_work_items(
            "org1",
            &["p1"],
            std::slice::from_ref(&mine),
            std::slice::from_ref(&mine),
        )
        .unwrap();

        // State edit while still assigned to me: row stays and is updated.
        let updated = CachedWorkItem {
            state: Some("Closed".to_string()),
            ..mine.clone()
        };
        db.update_my_work_item_if_present(&updated, Some("ME@EXAMPLE.COM"))
            .unwrap();
        let rows = db.list_my_work_items("org1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state.as_deref(), Some("Closed"));
    }

    #[test]
    fn replace_work_items_clears_and_repopulates_both_tables() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let make_item = |id: i64, title: &str| CachedWorkItem {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            id,
            title: title.to_string(),
            work_item_type: None,
            state: None,
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: None,
            web_url: None,
        };

        // Seed both tables (distinct IDs per table: work=1, my=10)
        db.replace_work_items(
            "org1",
            &["p1"],
            &[make_item(1, "all-A")],
            &[make_item(10, "my-A")],
        )
        .unwrap();

        // Replace with B-rows (work=2, my=20); A-rows must disappear
        db.replace_work_items(
            "org1",
            &["p1"],
            &[make_item(2, "all-B")],
            &[make_item(20, "my-B")],
        )
        .unwrap();

        let all = db
            .search_work_items("org1", None, None, None, None)
            .unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, 2, "work_items should contain only all-B");

        let my = db.list_my_work_items("org1").unwrap();
        assert_eq!(my.len(), 1);
        assert_eq!(my[0].id, 20, "my_work_items should contain only my-B");
    }

    #[test]
    fn replace_work_items_preserves_unsynced_project_rows() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let make_item = |id: i64, project_id: &str| CachedWorkItem {
            org_id: "org1".to_string(),
            project_id: project_id.to_string(),
            project_name: project_id.to_uppercase(),
            id,
            title: format!("item-{id}"),
            work_item_type: None,
            state: None,
            assigned_to: None,
            assigned_to_unique_name: None,
            changed_date: None,
            web_url: None,
        };

        // Seed p1 and p2
        db.replace_work_items(
            "org1",
            &["p1", "p2"],
            &[make_item(1, "p1"), make_item(2, "p2")],
            &[make_item(10, "p1"), make_item(20, "p2")],
        )
        .unwrap();

        // Re-sync only p1 — p2 must be preserved
        db.replace_work_items(
            "org1",
            &["p1"],
            &[make_item(3, "p1")],
            &[make_item(30, "p1")],
        )
        .unwrap();

        let all_ids: Vec<i64> = db
            .search_work_items("org1", None, None, None, None)
            .unwrap()
            .iter()
            .map(|w| w.id)
            .collect();
        assert!(!all_ids.contains(&1), "old p1 row must be replaced");
        assert!(all_ids.contains(&2), "p2 row must be preserved");
        assert!(all_ids.contains(&3), "new p1 row must be present");

        let my_ids: Vec<i64> = db
            .list_my_work_items("org1")
            .unwrap()
            .iter()
            .map(|w| w.id)
            .collect();
        assert!(!my_ids.contains(&10), "old p1 my row must be replaced");
        assert!(my_ids.contains(&20), "p2 my row must be preserved");
        assert!(my_ids.contains(&30), "new p1 my row must be present");
    }

    #[test]
    fn migrate_v3_db_upgrades_to_v4() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        {
            let conn = db.open().unwrap();
            // Bring the DB to v3 manually
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
                .unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                    display_name TEXT, base_url TEXT NOT NULL, auth_provider TEXT NOT NULL,
                    credential_key TEXT NOT NULL, authenticated_user_id TEXT,
                    authenticated_user_display_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE work_items(
                    org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                    id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                    assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
                CREATE TABLE my_work_items(
                    org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                    id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                    assigned_to TEXT, changed_date TEXT, web_url TEXT, PRIMARY KEY (org_id, id));
                INSERT INTO organizations VALUES('org1','org1',NULL,'https://dev.azure.com/org1','pat','key',NULL,NULL,'2024-01-01','2024-01-01');
                INSERT INTO work_items(org_id, project_id, project_name, id, title, assigned_to)
                    VALUES('org1', 'p1', 'P1', 1, 'Old item', 'Alice');
                PRAGMA user_version = 3;
                "#,
            )
            .unwrap();
        }
        db.initialize().unwrap();

        let version: i64 = db
            .open()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // Pre-existing row survived and assigned_to_unique_name defaulted to NULL
        let results = db
            .search_work_items("org1", None, None, None, None)
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].assigned_to.as_deref(), Some("Alice"));
    }

    #[test]
    fn migrate_v4_db_upgrades_to_v5() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        {
            let conn = db.open().unwrap();
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
                .unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                    display_name TEXT, base_url TEXT NOT NULL, auth_provider TEXT NOT NULL,
                    credential_key TEXT NOT NULL, authenticated_user_id TEXT,
                    authenticated_user_display_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE work_items(
                    org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                    id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                    assigned_to TEXT, changed_date TEXT, web_url TEXT,
                    assigned_to_unique_name TEXT,
                    PRIMARY KEY (org_id, id));
                CREATE TABLE my_work_items(
                    org_id TEXT NOT NULL, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
                    id INTEGER NOT NULL, title TEXT NOT NULL, work_item_type TEXT, state TEXT,
                    assigned_to TEXT, changed_date TEXT, web_url TEXT,
                    assigned_to_unique_name TEXT,
                    PRIMARY KEY (org_id, id));
                CREATE VIRTUAL TABLE work_items_fts USING fts5(
                    org_id UNINDEXED, item_id UNINDEXED, title);
                CREATE TRIGGER work_items_fts_ai AFTER INSERT ON work_items BEGIN
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                    VALUES (new.rowid, new.org_id, new.id, new.title);
                END;
                CREATE TRIGGER work_items_fts_ad AFTER DELETE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                END;
                CREATE TRIGGER work_items_fts_au AFTER UPDATE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title)
                    VALUES (new.rowid, new.org_id, new.id, new.title);
                END;
                INSERT INTO organizations VALUES('org1','org1',NULL,'https://dev.azure.com/org1','pat','key',NULL,NULL,'2024-01-01','2024-01-01');
                INSERT INTO work_items(org_id, project_id, project_name, id, title, work_item_type, assigned_to)
                    VALUES('org1', 'p1', 'P1', 1, 'Fix login', 'Bug', 'Alice');
                PRAGMA user_version = 4;
                "#,
            )
            .unwrap();
        }
        db.initialize().unwrap();

        let version: i64 = db
            .open()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // Pre-existing row is still present and searchable by assignee name via FTS
        let results = db.search_work_items_fts("org1", "Alice").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].assigned_to.as_deref(), Some("Alice"));
    }

    #[test]
    fn replace_commits_for_repo_scopes_to_repository() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let make_commit = |repo_id: &str, commit_id: &str| CachedCommit {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            repository_id: repo_id.to_string(),
            repository_name: repo_id.to_string(),
            commit_id: commit_id.to_string(),
            comment: "msg".to_string(),
            author_name: None,
            author_email: None,
            author_date: None,
            web_url: None,
        };

        // Seed both repos
        db.replace_commits_for_repo("org1", "repoA", &[make_commit("repoA", "a1")])
            .unwrap();
        db.replace_commits_for_repo("org1", "repoB", &[make_commit("repoB", "b1")])
            .unwrap();

        // Replace repoA only
        db.replace_commits_for_repo("org1", "repoA", &[make_commit("repoA", "a2")])
            .unwrap();

        let a = db
            .search_commits("org1", Some("repoA"), None, None, None)
            .unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].commit_id, "a2", "repoA should contain only a2");

        let b = db
            .search_commits("org1", Some("repoB"), None, None, None)
            .unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].commit_id, "b1", "repoB should be untouched");
    }

    #[test]
    fn purge_old_commits_removes_dated_rows_only() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let make_commit_dated = |commit_id: &str, date: Option<&str>| CachedCommit {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            repository_id: "repo1".to_string(),
            repository_name: "Repo1".to_string(),
            commit_id: commit_id.to_string(),
            comment: "msg".to_string(),
            author_name: None,
            author_email: None,
            author_date: date.map(|s| s.to_string()),
            web_url: None,
        };

        db.replace_commits_for_repo(
            "org1",
            "repo1",
            &[
                make_commit_dated("old", Some("2020-01-01T00:00:00+00:00")),
                make_commit_dated("new", Some("2030-01-01T00:00:00+00:00")),
            ],
        )
        .unwrap();

        db.purge_old_commits("org1", "2025-01-01T00:00:00+00:00")
            .unwrap();

        let remaining = db.search_commits("org1", None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].commit_id, "new");
    }

    #[test]
    fn purge_old_commits_removes_null_author_date() {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        db.upsert_organization(make_org_draft("org1")).unwrap();

        let make_commit_dated = |commit_id: &str, date: Option<&str>| CachedCommit {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            repository_id: "repo1".to_string(),
            repository_name: "Repo1".to_string(),
            commit_id: commit_id.to_string(),
            comment: "msg".to_string(),
            author_name: None,
            author_email: None,
            author_date: date.map(|s| s.to_string()),
            web_url: None,
        };

        db.replace_commits_for_repo(
            "org1",
            "repo1",
            &[
                make_commit_dated("undated", None),
                make_commit_dated("new", Some("2030-01-01T00:00:00+00:00")),
            ],
        )
        .unwrap();

        db.purge_old_commits("org1", "2025-01-01T00:00:00+00:00")
            .unwrap();

        // A NULL author_date means the date is unknown; treat it as old and
        // purge it so such commits do not linger forever.
        let remaining = db.search_commits("org1", None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].commit_id, "new");
    }
}
