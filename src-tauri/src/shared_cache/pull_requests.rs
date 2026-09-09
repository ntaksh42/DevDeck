use rusqlite::{params, Connection};

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedPullRequest {
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub created_by_id: Option<String>,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub is_draft: bool,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedReviewer {
    pub repository_id: String,
    pub pull_request_id: i64,
    pub reviewer_id: String,
    pub vote: i32,
    pub is_required: bool,
}

pub fn read_pull_requests(
    conn: &Connection,
    organization: &str,
    project: &str,
) -> Result<Vec<SharedPullRequest>> {
    let mut statement = conn.prepare(
        "SELECT repository_id, repository_name, pull_request_id, title, status,
                created_by, created_by_id, creation_date, source_ref_name,
                target_ref_name, is_draft, web_url
         FROM pull_requests WHERE organization = ?1 AND project = ?2",
    )?;
    let rows = statement.query_map(params![organization, project], |row| {
        Ok(SharedPullRequest {
            repository_id: row.get(0)?,
            repository_name: row.get(1)?,
            pull_request_id: row.get(2)?,
            title: row.get(3)?,
            status: row.get(4)?,
            created_by: row.get(5)?,
            created_by_id: row.get(6)?,
            creation_date: row.get(7)?,
            source_ref_name: row.get(8)?,
            target_ref_name: row.get(9)?,
            is_draft: row.get::<_, i64>(10)? != 0,
            web_url: row.get(11)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Replaces every PR/reviewer row for `(organization, project)` with `rows` /
/// `reviewers`. Both tables are scoped by project, so a caller that only
/// fetched a subset of an org's projects does not clobber the others.
///
/// The insert upserts on the `pull_requests` primary key, which is
/// `(organization, repository_id, pull_request_id)` and deliberately does not
/// include `project`: a PR belongs to exactly one project at a time, but the
/// project it is filed under can change name, and the delete above only clears
/// rows still filed under the *old* name. Without the upsert the first sync
/// after a rename hits a UNIQUE violation, aborts the whole transaction, and
/// the shared cache stops updating for that project entirely. Taking the newer
/// row and rewriting `project` mirrors what `upsert_work_items` already does.
pub fn write_pull_requests(
    conn: &mut Connection,
    organization: &str,
    project: &str,
    rows: &[SharedPullRequest],
    reviewers: &[SharedReviewer],
) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM pull_requests WHERE organization = ?1 AND project = ?2",
        params![organization, project],
    )?;
    tx.execute(
        "DELETE FROM pull_request_reviewers WHERE organization = ?1 AND project = ?2",
        params![organization, project],
    )?;
    {
        let mut statement = tx.prepare(
            "INSERT INTO pull_requests
             (organization, project, repository_id, repository_name, pull_request_id,
              title, status, created_by, created_by_id, creation_date, source_ref_name,
              target_ref_name, is_draft, web_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(organization, repository_id, pull_request_id) DO UPDATE SET
                project = excluded.project,
                repository_name = excluded.repository_name,
                title = excluded.title,
                status = excluded.status,
                created_by = excluded.created_by,
                created_by_id = excluded.created_by_id,
                creation_date = excluded.creation_date,
                source_ref_name = excluded.source_ref_name,
                target_ref_name = excluded.target_ref_name,
                is_draft = excluded.is_draft,
                web_url = excluded.web_url",
        )?;
        for row in rows {
            statement.execute(params![
                organization,
                project,
                row.repository_id,
                row.repository_name,
                row.pull_request_id,
                row.title,
                row.status,
                row.created_by,
                row.created_by_id,
                row.creation_date,
                row.source_ref_name,
                row.target_ref_name,
                row.is_draft as i64,
                row.web_url,
            ])?;
        }
    }
    {
        let mut statement = tx.prepare(
            "INSERT INTO pull_request_reviewers
             (organization, project, repository_id, pull_request_id, reviewer_id, vote, is_required)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for reviewer in reviewers {
            statement.execute(params![
                organization,
                project,
                reviewer.repository_id,
                reviewer.pull_request_id,
                reviewer.reviewer_id,
                reviewer.vote,
                reviewer.is_required as i64,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE pull_requests (
                organization TEXT NOT NULL, project TEXT NOT NULL, repository_id TEXT NOT NULL,
                repository_name TEXT NOT NULL, pull_request_id INTEGER NOT NULL, title TEXT NOT NULL,
                status TEXT NOT NULL, created_by TEXT, created_by_id TEXT, creation_date TEXT NOT NULL,
                source_ref_name TEXT NOT NULL, target_ref_name TEXT NOT NULL,
                is_draft INTEGER NOT NULL DEFAULT 0, web_url TEXT,
                PRIMARY KEY (organization, repository_id, pull_request_id)
            );
            CREATE TABLE pull_request_reviewers (
                organization TEXT NOT NULL, project TEXT NOT NULL, repository_id TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL, reviewer_id TEXT NOT NULL, vote INTEGER NOT NULL,
                is_required INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (organization, project, repository_id, pull_request_id, reviewer_id)
            );",
        )
        .unwrap();
    }

    fn sample(id: i64) -> SharedPullRequest {
        SharedPullRequest {
            repository_id: "repo1".to_string(),
            repository_name: "Repo One".to_string(),
            pull_request_id: id,
            title: format!("PR {id}"),
            status: "active".to_string(),
            created_by: Some("Alice".to_string()),
            created_by_id: Some("guid-1".to_string()),
            creation_date: "2026-01-01T00:00:00Z".to_string(),
            source_ref_name: "refs/heads/feature".to_string(),
            target_ref_name: "refs/heads/main".to_string(),
            is_draft: false,
            web_url: Some(format!(
                "https://dev.azure.com/org/proj/_git/repo1/pullrequest/{id}"
            )),
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        let reviewer = SharedReviewer {
            repository_id: "repo1".to_string(),
            pull_request_id: 1,
            reviewer_id: "guid-2".to_string(),
            vote: 10,
            is_required: true,
        };
        write_pull_requests(&mut conn, "org", "proj", &[sample(1)], &[reviewer]).unwrap();

        let rows = read_pull_requests(&conn, "org", "proj").unwrap();
        assert_eq!(rows, vec![sample(1)]);

        // DevDeck never reads reviewers back (it has no use for them), so
        // verify the write directly instead of through a read helper.
        let (reviewer_id, vote, is_required): (String, i32, i64) = conn
            .query_row(
                "SELECT reviewer_id, vote, is_required FROM pull_request_reviewers
                 WHERE organization = 'org' AND project = 'proj'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(reviewer_id, "guid-2");
        assert_eq!(vote, 10);
        assert_eq!(is_required, 1);
    }

    #[test]
    fn a_pr_refiled_under_a_renamed_project_replaces_its_old_row() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_pull_requests(&mut conn, "org", "Old Name", &[sample(1)], &[]).unwrap();

        // The project is renamed, so the next sync writes the same PR under a
        // new project name. The delete only clears rows still filed under
        // "New Name" -- none -- so the insert collides with the row left
        // behind under "Old Name" on the (organization, repository_id,
        // pull_request_id) primary key. Before the upsert this aborted the
        // transaction and the shared cache stopped updating for good.
        write_pull_requests(&mut conn, "org", "New Name", &[sample(1)], &[]).unwrap();

        assert_eq!(
            read_pull_requests(&conn, "org", "New Name").unwrap(),
            vec![sample(1)],
            "the PR should be readable under the project it is now filed under"
        );
        assert!(
            read_pull_requests(&conn, "org", "Old Name")
                .unwrap()
                .is_empty(),
            "and should no longer be readable under the stale project name"
        );
    }

    #[test]
    fn write_replaces_the_previous_snapshot_for_that_project_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_pull_requests(&mut conn, "org", "proj-a", &[sample(1)], &[]).unwrap();
        write_pull_requests(&mut conn, "org", "proj-b", &[sample(2)], &[]).unwrap();

        // Re-writing proj-a with a new snapshot drops the old row (1) but
        // leaves proj-b untouched.
        write_pull_requests(&mut conn, "org", "proj-a", &[sample(3)], &[]).unwrap();
        assert_eq!(
            read_pull_requests(&conn, "org", "proj-a").unwrap(),
            vec![sample(3)]
        );
        assert_eq!(
            read_pull_requests(&conn, "org", "proj-b").unwrap(),
            vec![sample(2)]
        );
    }
}
