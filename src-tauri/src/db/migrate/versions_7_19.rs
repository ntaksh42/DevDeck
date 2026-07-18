use rusqlite::Connection;

use crate::error::Result;

use super::super::{table_column_exists, table_exists};

pub(super) fn migrate(conn: &Connection, current: i64) -> Result<()> {
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
    if current < 13 {
        if !table_column_exists(conn, "review_pull_requests", "ci_status")? {
            conn.execute_batch("ALTER TABLE review_pull_requests ADD COLUMN ci_status TEXT;")?;
        }
        if !table_column_exists(conn, "review_pull_requests", "ci_context")? {
            conn.execute_batch("ALTER TABLE review_pull_requests ADD COLUMN ci_context TEXT;")?;
        }
        if !table_column_exists(conn, "review_pull_requests", "ci_check_count")? {
            conn.execute_batch(
                "ALTER TABLE review_pull_requests ADD COLUMN ci_check_count INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        if !table_column_exists(conn, "review_pull_requests", "ci_status_updated_at")? {
            conn.execute_batch(
                "ALTER TABLE review_pull_requests ADD COLUMN ci_status_updated_at TEXT;",
            )?;
        }
        conn.execute_batch("PRAGMA user_version = 13;")?;
    }
    if current < 14 {
        // On-demand cache of the pull requests that contain a given commit.
        // `fetched_at` records when the lookup ran so it can be refreshed after
        // a TTL; a commit with zero related PRs still records a marker row with
        // pull_request_id = NULL so "no PRs" is cached without re-querying.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS commit_prs(
                org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                repository_id     TEXT NOT NULL,
                commit_id         TEXT NOT NULL,
                pull_request_id   INTEGER,
                pr_repository_id  TEXT,
                title             TEXT,
                status            TEXT,
                my_vote           INTEGER NOT NULL DEFAULT 0,
                my_vote_label     TEXT NOT NULL DEFAULT '',
                web_url           TEXT,
                fetched_at        TEXT NOT NULL,
                PRIMARY KEY (org_id, repository_id, commit_id, pull_request_id)
            );

            PRAGMA user_version = 14;
            "#,
        )?;
    }
    if current < 15 {
        // Rebuild the work item FTS index so unique names (e.g. email
        // addresses) are full-text searchable, not just display names.
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
                assigned_to,
                assigned_to_unique_name
            );

            CREATE TRIGGER work_items_fts_ai
                AFTER INSERT ON work_items BEGIN
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to, assigned_to_unique_name)
                    VALUES (new.rowid, new.org_id, new.id, new.title, new.work_item_type, new.assigned_to, new.assigned_to_unique_name);
                END;

            CREATE TRIGGER work_items_fts_ad
                AFTER DELETE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                END;

            CREATE TRIGGER work_items_fts_au
                AFTER UPDATE ON work_items BEGIN
                    DELETE FROM work_items_fts WHERE rowid = old.rowid;
                    INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to, assigned_to_unique_name)
                    VALUES (new.rowid, new.org_id, new.id, new.title, new.work_item_type, new.assigned_to, new.assigned_to_unique_name);
                END;

            INSERT INTO work_items_fts(rowid, org_id, item_id, title, work_item_type, assigned_to, assigned_to_unique_name)
                SELECT rowid, org_id, id, title, work_item_type, assigned_to, assigned_to_unique_name FROM work_items;

            PRAGMA user_version = 15;
            "#,
        )?;
    }
    if current < 16 {
        // PR search can now exclude draft PRs, so the active-PR cache needs to
        // remember which rows are drafts. Existing rows default to non-draft and
        // are corrected on the next sync. The table-exists guard keeps partial
        // historical databases (e.g. migration tests that start past step 2)
        // from tripping over a not-yet-created pull_requests table.
        if table_exists(conn, "pull_requests")?
            && !table_column_exists(conn, "pull_requests", "is_draft")?
        {
            conn.execute_batch(
                "ALTER TABLE pull_requests ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        conn.execute_batch("PRAGMA user_version = 16;")?;
    }
    if current < 17 {
        // Connections can now point at different platforms. `provider_kind`
        // distinguishes Azure DevOps from GitHub; existing rows default to
        // `azdo` so prior connections keep working unchanged. The table-exists
        // guard keeps partial historical databases from tripping over a
        // not-yet-created organizations table.
        if table_exists(conn, "organizations")?
            && !table_column_exists(conn, "organizations", "provider_kind")?
        {
            conn.execute_batch(
                "ALTER TABLE organizations ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'azdo';",
            )?;
        }
        conn.execute_batch("PRAGMA user_version = 17;")?;
    }
    if current < 18 {
        // The work item grid now shows a Tags column, so the cache needs to
        // remember each item's `System.Tags` value. Existing rows default to
        // NULL (no tags) and are populated on the next sync. The table-exists
        // guards keep partial historical databases from tripping over tables
        // that a truncated migration path has not created yet.
        if table_exists(conn, "work_items")? && !table_column_exists(conn, "work_items", "tags")? {
            conn.execute_batch("ALTER TABLE work_items ADD COLUMN tags TEXT;")?;
        }
        if table_exists(conn, "my_work_items")?
            && !table_column_exists(conn, "my_work_items", "tags")?
        {
            conn.execute_batch("ALTER TABLE my_work_items ADD COLUMN tags TEXT;")?;
        }
        conn.execute_batch("PRAGMA user_version = 18;")?;
    }
    if current < 19 {
        // Notification history: sync now persists desktop-notification-worthy
        // events so the frontend can show a durable inbox, not just a
        // fire-and-forget toast.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS notifications(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                organization_id TEXT,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                payload TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_unread
                ON notifications(is_read, id DESC);

            PRAGMA user_version = 19;
            "#,
        )?;
    }
    Ok(())
}
