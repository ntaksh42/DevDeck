use rusqlite::Connection;

use crate::error::{AppError, Result};

use super::{table_column_exists, table_exists, SCHEMA_VERSION};

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
    Ok(())
}
