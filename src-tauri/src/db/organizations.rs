use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, Result};

use super::AppDatabase;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub base_url: String,
    pub auth_provider: String,
    pub credential_key: String,
    pub authenticated_user_id: Option<String>,
    pub authenticated_user_display_name: Option<String>,
    pub authenticated_user_unique_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct OrganizationDraft {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub base_url: String,
    pub auth_provider: String,
    pub credential_key: String,
    pub authenticated_user_id: Option<String>,
    pub authenticated_user_display_name: Option<String>,
    pub authenticated_user_unique_name: Option<String>,
}

impl AppDatabase {
    pub fn list_organizations(&self) -> Result<Vec<Organization>> {
        let conn = self.open()?;
        list_organizations(&conn)
    }

    pub fn get_organization(&self, id: &str) -> Result<Option<Organization>> {
        let conn = self.open()?;
        get_organization(&conn, id)
    }

    /// Resolves an organization by id, or falls back to the first configured
    /// organization when no id is given.
    pub fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }
        self.list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }

    pub fn upsert_organization(&self, draft: OrganizationDraft) -> Result<Organization> {
        let conn = self.open()?;
        upsert_organization(&conn, draft)
    }

    pub fn delete_organization(&self, id: &str) -> Result<()> {
        let conn = self.open()?;
        delete_organization(&conn, id)
    }
}

pub(crate) fn list_organizations(conn: &Connection) -> Result<Vec<Organization>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, name, display_name, base_url, auth_provider, credential_key,
               authenticated_user_id, authenticated_user_display_name,
               authenticated_user_unique_name, created_at, updated_at
        FROM organizations
        ORDER BY name ASC
        "#,
    )?;
    let rows = stmt.query_map([], map_organization)?;
    let mut orgs = Vec::new();
    for row in rows {
        orgs.push(row?);
    }
    Ok(orgs)
}

fn get_organization(conn: &Connection, id: &str) -> Result<Option<Organization>> {
    Ok(conn
        .query_row(
            r#"
            SELECT id, name, display_name, base_url, auth_provider, credential_key,
                   authenticated_user_id, authenticated_user_display_name,
                   authenticated_user_unique_name, created_at, updated_at
            FROM organizations WHERE id = ?1
            "#,
            [id],
            map_organization,
        )
        .optional()?)
}

pub(crate) fn upsert_organization(
    conn: &Connection,
    draft: OrganizationDraft,
) -> Result<Organization> {
    let now = Utc::now().to_rfc3339();
    let created_at = existing_created_at(conn, &draft.id)?.unwrap_or_else(|| now.clone());
    conn.execute(
        r#"
        INSERT INTO organizations(
            id, name, display_name, base_url, auth_provider, credential_key,
            authenticated_user_id, authenticated_user_display_name,
            authenticated_user_unique_name, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            display_name = excluded.display_name,
            base_url = excluded.base_url,
            auth_provider = excluded.auth_provider,
            credential_key = excluded.credential_key,
            authenticated_user_id = excluded.authenticated_user_id,
            authenticated_user_display_name = excluded.authenticated_user_display_name,
            authenticated_user_unique_name = excluded.authenticated_user_unique_name,
            updated_at = excluded.updated_at
        "#,
        params![
            draft.id,
            draft.name,
            draft.display_name,
            draft.base_url,
            draft.auth_provider,
            draft.credential_key,
            draft.authenticated_user_id,
            draft.authenticated_user_display_name,
            draft.authenticated_user_unique_name,
            created_at,
            now
        ],
    )?;
    get_organization(conn, &draft.id)?
        .ok_or_else(|| AppError::Database("organization was not persisted".to_string()))
}

fn existing_created_at(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT created_at FROM organizations WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?)
}

fn delete_organization(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM organizations WHERE id = ?1", [id])?;
    Ok(())
}

fn map_organization(row: &rusqlite::Row<'_>) -> rusqlite::Result<Organization> {
    Ok(Organization {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        base_url: row.get(3)?,
        auth_provider: row.get(4)?,
        credential_key: row.get(5)?,
        authenticated_user_id: row.get(6)?,
        authenticated_user_display_name: row.get(7)?,
        authenticated_user_unique_name: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}
