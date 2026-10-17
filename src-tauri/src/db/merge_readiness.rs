use rusqlite::{params, Connection, OptionalExtension};

use super::AppDatabase;
use crate::error::Result;

pub(super) fn migrate_v29(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pr_merge_readiness (
        org_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        pull_request_id INTEGER NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0,
        notified INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (org_id, repository_id, pull_request_id)
    ); PRAGMA user_version = 29;",
    )?;
    Ok(())
}

impl AppDatabase {
    pub fn pr_ready_to_merge(&self, org: &str, repo: &str, id: i64) -> Result<bool> {
        let conn = self.open()?;
        Ok(conn.query_row(
            "SELECT ready FROM pr_merge_readiness WHERE org_id=?1 AND repository_id=?2 AND pull_request_id=?3",
            params![org, repo, id], |row| row.get(0),
        ).optional()?.unwrap_or(false))
    }

    /// Update the badge even when notifications are muted. The returned claim
    /// is persistent and atomic, so each PR notifies at most once.
    pub fn update_pr_readiness(
        &self,
        org: &str,
        repo: &str,
        id: i64,
        ready: bool,
        record: Option<&super::NewNotification>,
    ) -> Result<bool> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO pr_merge_readiness(org_id,repository_id,pull_request_id,ready)
            VALUES (?1,?2,?3,?4) ON CONFLICT(org_id,repository_id,pull_request_id)
            DO UPDATE SET ready=excluded.ready",
            params![org, repo, id, ready],
        )?;
        let claimed = ready && record.is_some() && tx.execute(
            "UPDATE pr_merge_readiness SET notified=1 WHERE org_id=?1 AND repository_id=?2 AND pull_request_id=?3 AND notified=0",
            params![org, repo, id],
        )? == 1;
        if claimed {
            super::notifications::insert_notifications(&tx, std::slice::from_ref(record.unwrap()))?;
        }
        tx.commit()?;
        Ok(claimed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_notifications_survive_restart_and_are_scoped_to_org_and_repo() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(file.path().to_path_buf());
        db.initialize().unwrap();
        let record = super::super::NewNotification {
            organization_id: Some("org".into()),
            kind: "prReadyToMerge".into(),
            title: "Ready to merge: !42".into(),
            body: None,
            payload: serde_json::json!({}),
        };
        assert!(!db.pr_ready_to_merge("org", "repo", 42).unwrap());
        assert!(!db
            .update_pr_readiness("org", "repo", 42, false, Some(&record))
            .unwrap());
        // Muted notifications still update the badge without consuming a claim.
        assert!(!db
            .update_pr_readiness("org", "repo", 42, true, None)
            .unwrap());
        assert!(db.pr_ready_to_merge("org", "repo", 42).unwrap());
        assert!(db
            .update_pr_readiness("org", "repo", 42, true, Some(&record))
            .unwrap());
        let db = AppDatabase::new(file.path().to_path_buf());
        assert!(!db
            .update_pr_readiness("org", "repo", 42, false, Some(&record))
            .unwrap());
        assert!(!db.pr_ready_to_merge("org", "repo", 42).unwrap());
        assert!(!db
            .update_pr_readiness("org", "repo", 42, true, Some(&record))
            .unwrap());
        assert!(db
            .update_pr_readiness("org", "other", 42, true, Some(&record))
            .unwrap());
        assert!(db
            .update_pr_readiness("other", "repo", 42, true, Some(&record))
            .unwrap());
        assert_eq!(
            db.list_notifications(20, None, false, None, None)
                .unwrap()
                .items
                .len(),
            3
        );
    }
}
