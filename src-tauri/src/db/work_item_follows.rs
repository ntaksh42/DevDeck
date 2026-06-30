use rusqlite::{params, Connection};

use crate::error::Result;

use super::AppDatabase;

/// A locally followed work item. Fields beyond the identity (org + id) are a
/// snapshot captured at follow time, not a live join against the work item
/// cache — see the schema-version-18 migration step for why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedFollowedWorkItem {
    pub work_item_id: i64,
    pub project_id: String,
    pub project_name: String,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub web_url: Option<String>,
    pub followed_at: String,
}

impl AppDatabase {
    pub fn upsert_followed_work_item(
        &self,
        org_id: &str,
        item: &CachedFollowedWorkItem,
    ) -> Result<()> {
        let conn = self.open()?;
        upsert_followed_work_item(&conn, org_id, item)
    }

    pub fn delete_followed_work_item(&self, org_id: &str, work_item_id: i64) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM followed_work_items WHERE organization_id = ?1 AND work_item_id = ?2",
            params![org_id, work_item_id],
        )?;
        Ok(())
    }

    pub fn list_followed_work_items(&self, org_id: &str) -> Result<Vec<CachedFollowedWorkItem>> {
        let conn = self.open()?;
        list_followed_work_items(&conn, org_id)
    }
}

pub(crate) fn upsert_followed_work_item(
    conn: &Connection,
    org_id: &str,
    item: &CachedFollowedWorkItem,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO followed_work_items(
            organization_id, work_item_id, project_id, project_name, title,
            work_item_type, state, assigned_to, web_url, followed_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(organization_id, work_item_id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            title = excluded.title,
            work_item_type = excluded.work_item_type,
            state = excluded.state,
            assigned_to = excluded.assigned_to,
            web_url = excluded.web_url,
            followed_at = excluded.followed_at
        "#,
        params![
            org_id,
            item.work_item_id,
            item.project_id,
            item.project_name,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.web_url,
            item.followed_at,
        ],
    )?;
    Ok(())
}

pub(crate) fn list_followed_work_items(
    conn: &Connection,
    org_id: &str,
) -> Result<Vec<CachedFollowedWorkItem>> {
    let mut stmt = conn.prepare(
        "SELECT work_item_id, project_id, project_name, title, work_item_type, state, \
         assigned_to, web_url, followed_at \
         FROM followed_work_items WHERE organization_id = ?1 ORDER BY followed_at DESC",
    )?;
    let rows = stmt.query_map(params![org_id], |row| {
        Ok(CachedFollowedWorkItem {
            work_item_id: row.get(0)?,
            project_id: row.get(1)?,
            project_name: row.get(2)?,
            title: row.get(3)?,
            work_item_type: row.get(4)?,
            state: row.get(5)?,
            assigned_to: row.get(6)?,
            web_url: row.get(7)?,
            followed_at: row.get(8)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}
