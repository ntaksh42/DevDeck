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
