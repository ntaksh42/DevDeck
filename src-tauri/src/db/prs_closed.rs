use rusqlite::params;

use crate::error::Result;

use super::AppDatabase;

impl AppDatabase {
    /// Drops a PR that was just completed or abandoned from the synced PR
    /// caches (My Pull Requests, My Reviews, the cached-active search), so the
    /// grids stop listing it before the next sync confirms the change.
    pub fn forget_closed_pull_request(
        &self,
        org_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        for table in [
            "pull_requests",
            "review_pull_requests",
            "pr_reviewer_counts",
        ] {
            tx.execute(
                &format!(
                    "DELETE FROM {table} WHERE org_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3"
                ),
                params![org_id, repository_id, pull_request_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

/// Identity and creation date of one cached active PR.
#[derive(Debug, Clone)]
pub struct CachedPrKey {
    pub repository_id: String,
    pub pull_request_id: i64,
    pub creation_date: String,
}

impl AppDatabase {
    /// Every cached active PR of one project, unpaged.
    pub fn list_cached_pr_keys(&self, org_id: &str, project_id: &str) -> Result<Vec<CachedPrKey>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT repository_id, pull_request_id, creation_date FROM pull_requests
             WHERE org_id = ?1 AND project_id = ?2 ORDER BY pull_request_id",
        )?;
        let rows = stmt
            .query_map(params![org_id, project_id], |row| {
                Ok(CachedPrKey {
                    repository_id: row.get(0)?,
                    pull_request_id: row.get(1)?,
                    creation_date: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
