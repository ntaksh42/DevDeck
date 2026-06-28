use rusqlite::{params, Connection};

use crate::error::Result;

use super::AppDatabase;

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
    pub is_draft: bool,
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
    /// Aggregate CI verdict: `succeeded` | `failed` | `in_progress` | `none`.
    /// `None` means CI was never fetched for this PR (e.g. beyond the sync cap
    /// or the status fetch failed), which the UI renders the same as `none`.
    pub ci_status: Option<String>,
    /// Name of the most relevant status check, shown in the CI tooltip.
    pub ci_context: Option<String>,
    /// How many checks the verdict was aggregated from.
    pub ci_check_count: i64,
}

impl AppDatabase {
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
    /// not show a stale vote until the next background sync. Returns the number
    /// of rows updated; `0` means the PR is not in the My Reviews cache (e.g.
    /// it was opened from search or a direct URL), so the caller can decide
    /// whether the miss matters instead of treating it as a silent success.
    pub fn update_review_pr_vote(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
        vote: i32,
        vote_label: &str,
    ) -> Result<usize> {
        let conn = self.open()?;
        let updated = conn.execute(
            "UPDATE review_pull_requests SET my_vote = ?4, my_vote_label = ?5 \
             WHERE org_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id, vote, vote_label],
        )?;
        Ok(updated)
    }
}

fn upsert_pull_requests(conn: &Connection, prs: &[CachedPr]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO pull_requests(
            org_id, project_id, project_name, repository_id, repository_name,
            pull_request_id, title, status, created_by, creation_date,
            source_ref_name, target_ref_name, web_url, is_draft
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
            web_url = excluded.web_url,
            is_draft = excluded.is_draft
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
            pr.web_url,
            pr.is_draft
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
               source_ref_name, target_ref_name, web_url, is_draft
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

fn upsert_review_pull_requests(conn: &Connection, prs: &[CachedReviewPr]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO review_pull_requests(
            org_id, project_id, project_name, repository_id, repository_name,
            pull_request_id, title, created_by, creation_date, target_ref_name,
            web_url, my_vote, my_vote_label, my_is_required, is_draft, merge_status,
            ci_status, ci_context, ci_check_count, ci_status_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
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
            merge_status = excluded.merge_status,
            ci_status = excluded.ci_status,
            ci_context = excluded.ci_context,
            ci_check_count = excluded.ci_check_count,
            ci_status_updated_at = excluded.ci_status_updated_at
        "#,
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    for pr in prs {
        // Only stamp a fetch time when CI was actually resolved for this PR.
        let ci_updated_at = pr.ci_status.as_ref().map(|_| now.as_str());
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
            pr.merge_status,
            pr.ci_status,
            pr.ci_context,
            pr.ci_check_count,
            ci_updated_at
        ])?;
    }
    Ok(())
}

fn list_review_pull_requests(conn: &Connection, org_id: &str) -> Result<Vec<CachedReviewPr>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               pull_request_id, title, created_by, creation_date, target_ref_name,
               web_url, my_vote, my_vote_label, my_is_required, is_draft, merge_status,
               ci_status, ci_context, ci_check_count
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
        is_draft: row.get(13)?,
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
        ci_status: row.get(16)?,
        ci_context: row.get(17)?,
        ci_check_count: row.get(18)?,
    })
}
