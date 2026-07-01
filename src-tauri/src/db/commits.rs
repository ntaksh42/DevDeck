use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::AppDatabase;
use super::{
    commit_activity, list_commit_repositories, search_commits, search_commits_fts, upsert_commits,
};

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
    pub author_image_url: Option<String>,
    pub committer_name: Option<String>,
    pub committer_email: Option<String>,
    pub committer_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedCommitPr {
    pub pull_request_id: i64,
    pub pr_repository_id: String,
    pub title: String,
    pub status: String,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CachedRepository {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
}

impl AppDatabase {
    pub fn search_commits(
        &self,
        org_id: &str,
        repository_ids: Option<&[String]>,
        author: Option<&str>,
        from_date: Option<&str>,
        to_date: Option<&str>,
    ) -> Result<Vec<CachedCommit>> {
        let conn = self.open()?;
        search_commits(&conn, org_id, repository_ids, author, from_date, to_date)
    }

    pub fn search_commits_fts(
        &self,
        org_id: &str,
        query: &str,
        repository_ids: Option<&[String]>,
        from_date: Option<&str>,
        to_date: Option<&str>,
    ) -> Result<Vec<CachedCommit>> {
        let conn = self.open()?;
        search_commits_fts(&conn, org_id, query, repository_ids, from_date, to_date)
    }

    pub fn list_commit_repositories(&self, org_id: &str) -> Result<Vec<CachedRepository>> {
        let conn = self.open()?;
        list_commit_repositories(&conn, org_id)
    }

    pub fn commit_activity(
        &self,
        org_id: &str,
        project_id: Option<&str>,
        repository_id: Option<&str>,
        author: Option<&str>,
        from_date: Option<&str>,
        to_date: Option<&str>,
    ) -> Result<Vec<(String, i64)>> {
        let conn = self.open()?;
        commit_activity(
            &conn,
            org_id,
            project_id,
            repository_id,
            author,
            from_date,
            to_date,
        )
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

    /// Delta-sync write: upsert the freshly fetched commits without deleting any
    /// existing rows. Used by the incremental commit sync, which only fetches
    /// commits newer than the last sync; deletions and rewrites are reconciled by
    /// the next periodic full sync (which calls `replace_commits_for_repo`).
    pub fn merge_commits(&self, commits: &[CachedCommit]) -> Result<()> {
        if commits.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        upsert_commits(&tx, commits)?;
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

    /// Returns cached PRs for a commit, or `None` when the commit has never been
    /// looked up or its cached lookup is older than `fresh_after`. An empty
    /// `Vec` means "looked up recently, no related PRs" — distinct from `None`.
    pub fn get_cached_commit_prs(
        &self,
        org_id: &str,
        repository_id: &str,
        commit_id: &str,
        fresh_after: &str,
    ) -> Result<Option<Vec<CachedCommitPr>>> {
        let conn = self.open()?;
        let fetched_at: Option<String> = conn
            .query_row(
                "SELECT MAX(fetched_at) FROM commit_prs \
                 WHERE org_id = ?1 AND repository_id = ?2 AND commit_id = ?3",
                params![org_id, repository_id, commit_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        let Some(fetched_at) = fetched_at else {
            return Ok(None);
        };
        if fetched_at.as_str() < fresh_after {
            return Ok(None);
        }
        let mut stmt = conn.prepare(
            "SELECT pull_request_id, pr_repository_id, title, status, my_vote, my_vote_label, web_url \
             FROM commit_prs \
             WHERE org_id = ?1 AND repository_id = ?2 AND commit_id = ?3 AND pull_request_id IS NOT NULL \
             ORDER BY pull_request_id DESC",
        )?;
        let rows = stmt.query_map(params![org_id, repository_id, commit_id], |row| {
            Ok(CachedCommitPr {
                pull_request_id: row.get(0)?,
                pr_repository_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                my_vote: row.get(4)?,
                my_vote_label: row.get(5)?,
                web_url: row.get(6)?,
            })
        })?;
        let mut prs = Vec::new();
        for row in rows {
            prs.push(row?);
        }
        Ok(Some(prs))
    }

    /// Replaces the cached PR list for a single commit. An empty slice records a
    /// marker row (pull_request_id = NULL) so "no related PRs" is cached.
    pub fn replace_commit_prs(
        &self,
        org_id: &str,
        repository_id: &str,
        commit_id: &str,
        prs: &[CachedCommitPr],
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM commit_prs WHERE org_id = ?1 AND repository_id = ?2 AND commit_id = ?3",
            params![org_id, repository_id, commit_id],
        )?;
        if prs.is_empty() {
            tx.execute(
                "INSERT INTO commit_prs(org_id, repository_id, commit_id, pull_request_id, fetched_at) \
                 VALUES (?1, ?2, ?3, NULL, ?4)",
                params![org_id, repository_id, commit_id, now],
            )?;
        } else {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO commit_prs(\
                    org_id, repository_id, commit_id, pull_request_id, pr_repository_id, \
                    title, status, my_vote, my_vote_label, web_url, fetched_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for pr in prs {
                stmt.execute(params![
                    org_id,
                    repository_id,
                    commit_id,
                    pr.pull_request_id,
                    pr.pr_repository_id,
                    pr.title,
                    pr.status,
                    pr.my_vote,
                    pr.my_vote_label,
                    pr.web_url,
                    now
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}
