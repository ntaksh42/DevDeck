use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, Result};

const SCHEMA_VERSION: i64 = 1;

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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct AppDatabase {
    path: PathBuf,
}

impl AppDatabase {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn initialize(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = self.open()?;
        migrate(&conn)?;
        Ok(())
    }

    pub fn open(&self) -> Result<Connection> {
        Ok(Connection::open(&self.path)?)
    }

    pub fn list_organizations(&self) -> Result<Vec<Organization>> {
        let conn = self.open()?;
        list_organizations(&conn)
    }

    pub fn get_organization(&self, id: &str) -> Result<Option<Organization>> {
        let conn = self.open()?;
        get_organization(&conn, id)
    }

    pub fn upsert_organization(&self, draft: OrganizationDraft) -> Result<Organization> {
        let conn = self.open()?;
        upsert_organization(&conn, draft)
    }
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
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(AppError::Database(format!(
            "database schema version {current} is newer than supported version {SCHEMA_VERSION}"
        )));
    }
    if current == 0 {
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
    Ok(())
}

fn list_organizations(conn: &Connection) -> Result<Vec<Organization>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, name, display_name, base_url, auth_provider, credential_key,
               authenticated_user_id, authenticated_user_display_name, created_at, updated_at
        FROM organizations
        ORDER BY name ASC
        "#,
    )?;

    let rows = stmt.query_map([], map_organization)?;
    let mut organizations = Vec::new();
    for row in rows {
        organizations.push(row?);
    }
    Ok(organizations)
}

fn upsert_organization(conn: &Connection, draft: OrganizationDraft) -> Result<Organization> {
    let now = Utc::now().to_rfc3339();
    let created_at = existing_created_at(conn, &draft.id)?.unwrap_or_else(|| now.clone());

    conn.execute(
        r#"
        INSERT INTO organizations(
            id, name, display_name, base_url, auth_provider, credential_key,
            authenticated_user_id, authenticated_user_display_name, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            display_name = excluded.display_name,
            base_url = excluded.base_url,
            auth_provider = excluded.auth_provider,
            credential_key = excluded.credential_key,
            authenticated_user_id = excluded.authenticated_user_id,
            authenticated_user_display_name = excluded.authenticated_user_display_name,
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

fn get_organization(conn: &Connection, id: &str) -> Result<Option<Organization>> {
    Ok(conn
        .query_row(
            r#"
            SELECT id, name, display_name, base_url, auth_provider, credential_key,
                   authenticated_user_id, authenticated_user_display_name, created_at, updated_at
            FROM organizations
            WHERE id = ?1
            "#,
            [id],
            map_organization,
        )
        .optional()?)
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
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_repeatable() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn upsert_preserves_created_at_and_updates_user() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let first = upsert_organization(
            &conn,
            OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: Some("Contoso".to_string()),
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: Some("user-1".to_string()),
                authenticated_user_display_name: Some("First User".to_string()),
            },
        )
        .unwrap();

        let second = upsert_organization(
            &conn,
            OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: Some("Contoso".to_string()),
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: Some("user-2".to_string()),
                authenticated_user_display_name: Some("Second User".to_string()),
            },
        )
        .unwrap();

        assert_eq!(first.created_at, second.created_at);
        assert_eq!(
            second.authenticated_user_display_name.as_deref(),
            Some("Second User")
        );
        assert_eq!(list_organizations(&conn).unwrap().len(), 1);
    }
}
