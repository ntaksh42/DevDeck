use rusqlite::{params, Connection};

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedWorkItem {
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub assigned_to_unique_name: Option<String>,
    pub changed_date: Option<String>,
    pub web_url: Option<String>,
    pub tags: Option<String>,
}

#[cfg(test)]
fn read_work_items(
    conn: &Connection,
    organization: &str,
    project: &str,
) -> Result<Vec<SharedWorkItem>> {
    let mut statement = conn.prepare(
        "SELECT id, title, work_item_type, state, assigned_to, assigned_to_unique_name,
                changed_date, web_url, tags
         FROM work_items WHERE organization = ?1 AND project = ?2",
    )?;
    let rows = statement.query_map(params![organization, project], |row| {
        Ok(SharedWorkItem {
            id: row.get(0)?,
            title: row.get(1)?,
            work_item_type: row.get(2)?,
            state: row.get(3)?,
            assigned_to: row.get(4)?,
            assigned_to_unique_name: row.get(5)?,
            changed_date: row.get(6)?,
            web_url: row.get(7)?,
            tags: row.get(8)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Replaces every work item row for `(organization, project)` with `rows`.
///
/// The insert upserts on the `work_items` primary key, `(organization, id)`,
/// which deliberately does not include `project`: a work item can move between
/// projects (and a project can be renamed), while the delete above only clears
/// rows still filed under the project being written. Without the upsert the
/// first sync after such a move hits a UNIQUE violation, aborts the whole
/// transaction, and the shared cache stops updating for that project entirely.
/// [`upsert_work_items`] already resolves the same conflict this way.
pub fn write_work_items(
    conn: &mut Connection,
    organization: &str,
    project: &str,
    rows: &[SharedWorkItem],
) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM work_items WHERE organization = ?1 AND project = ?2",
        params![organization, project],
    )?;
    {
        let mut statement = tx.prepare(
            "INSERT INTO work_items
             (organization, project, id, title, work_item_type, state, assigned_to,
              assigned_to_unique_name, changed_date, web_url, tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(organization, id) DO UPDATE SET
                project = excluded.project,
                title = excluded.title,
                work_item_type = excluded.work_item_type,
                state = excluded.state,
                assigned_to = excluded.assigned_to,
                assigned_to_unique_name = excluded.assigned_to_unique_name,
                changed_date = excluded.changed_date,
                web_url = excluded.web_url,
                tags = excluded.tags",
        )?;
        for row in rows {
            statement.execute(params![
                organization,
                project,
                row.id,
                row.title,
                row.work_item_type,
                row.state,
                row.assigned_to,
                row.assigned_to_unique_name,
                row.changed_date,
                row.web_url,
                row.tags,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Upserts `rows` without deleting existing rows absent from `rows`. A delta
/// sync only fetches items that changed since the last sync, so a full
/// `DELETE`-then-insert (as `write_work_items` does) would wipe out every
/// unchanged item; this preserves them.
pub fn upsert_work_items(
    conn: &mut Connection,
    organization: &str,
    project: &str,
    rows: &[SharedWorkItem],
) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    {
        let mut statement = tx.prepare(
            "INSERT INTO work_items
             (organization, project, id, title, work_item_type, state, assigned_to,
              assigned_to_unique_name, changed_date, web_url, tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(organization, id) DO UPDATE SET
                project = excluded.project,
                title = excluded.title,
                work_item_type = excluded.work_item_type,
                state = excluded.state,
                assigned_to = excluded.assigned_to,
                assigned_to_unique_name = excluded.assigned_to_unique_name,
                changed_date = excluded.changed_date,
                web_url = excluded.web_url,
                tags = excluded.tags",
        )?;
        for row in rows {
            statement.execute(params![
                organization,
                project,
                row.id,
                row.title,
                row.work_item_type,
                row.state,
                row.assigned_to,
                row.assigned_to_unique_name,
                row.changed_date,
                row.web_url,
                row.tags,
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
            "CREATE TABLE work_items (
                organization TEXT NOT NULL, project TEXT NOT NULL, id INTEGER NOT NULL,
                title TEXT NOT NULL, work_item_type TEXT, state TEXT, assigned_to TEXT,
                assigned_to_unique_name TEXT, changed_date TEXT, web_url TEXT, tags TEXT,
                PRIMARY KEY (organization, id)
            );",
        )
        .unwrap();
    }

    fn sample(id: i64) -> SharedWorkItem {
        SharedWorkItem {
            id,
            title: format!("Item {id}"),
            work_item_type: Some("Bug".to_string()),
            state: Some("Active".to_string()),
            assigned_to: Some("Alice".to_string()),
            assigned_to_unique_name: Some("alice@example.com".to_string()),
            changed_date: Some("2026-01-01T00:00:00Z".to_string()),
            web_url: Some(format!(
                "https://dev.azure.com/org/proj/_workitems/edit/{id}"
            )),
            tags: Some("triaged; needs-repro".to_string()),
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_work_items(&mut conn, "org", "proj", &[sample(1)]).unwrap();
        assert_eq!(
            read_work_items(&conn, "org", "proj").unwrap(),
            vec![sample(1)]
        );
    }

    #[test]
    fn upsert_preserves_rows_absent_from_the_batch() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_work_items(&mut conn, "org", "proj", &[sample(1), sample(2)]).unwrap();

        // A delta result only carries what changed (item 1), not item 2.
        let mut changed = sample(1);
        changed.title = "Item 1 (updated)".to_string();
        upsert_work_items(&mut conn, "org", "proj", &[changed.clone()]).unwrap();

        let mut rows = read_work_items(&conn, "org", "proj").unwrap();
        rows.sort_by_key(|row| row.id);
        assert_eq!(rows, vec![changed, sample(2)]);
    }

    #[test]
    fn upsert_with_an_empty_batch_is_a_no_op() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_work_items(&mut conn, "org", "proj", &[sample(1)]).unwrap();
        upsert_work_items(&mut conn, "org", "proj", &[]).unwrap();
        assert_eq!(
            read_work_items(&conn, "org", "proj").unwrap(),
            vec![sample(1)]
        );
    }

    #[test]
    fn a_work_item_moved_to_another_project_replaces_its_old_row() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_work_items(&mut conn, "org", "proj-a", &[sample(1)]).unwrap();

        // The item moves to another project (or its project is renamed), so
        // the next sync writes it under a different project name. The delete
        // only clears rows still filed under "proj-b" -- none -- so the insert
        // collides with the row left behind under "proj-a" on the
        // (organization, id) primary key. Before the upsert this aborted the
        // transaction and the shared cache stopped updating for good.
        write_work_items(&mut conn, "org", "proj-b", &[sample(1)]).unwrap();

        assert_eq!(
            read_work_items(&conn, "org", "proj-b").unwrap(),
            vec![sample(1)],
            "the item should be readable under the project it now belongs to"
        );
        assert!(
            read_work_items(&conn, "org", "proj-a").unwrap().is_empty(),
            "and should no longer be readable under the old project"
        );
    }

    #[test]
    fn write_replaces_the_previous_snapshot_for_that_project_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        write_work_items(&mut conn, "org", "proj-a", &[sample(1)]).unwrap();
        write_work_items(&mut conn, "org", "proj-b", &[sample(2)]).unwrap();

        write_work_items(&mut conn, "org", "proj-a", &[sample(3)]).unwrap();
        assert_eq!(
            read_work_items(&conn, "org", "proj-a").unwrap(),
            vec![sample(3)]
        );
        assert_eq!(
            read_work_items(&conn, "org", "proj-b").unwrap(),
            vec![sample(2)]
        );
    }
}
