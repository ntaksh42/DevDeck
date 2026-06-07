use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::error::{AppError, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteSearchInput {
    pub organization_id: Option<String>,
    pub query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteSearchResults {
    pub work_items: Vec<CommandPaletteWorkItemResult>,
    pub pull_requests: Vec<CommandPalettePullRequestResult>,
    pub commits: Vec<CommandPaletteCommitResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteWorkItemResult {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPalettePullRequestResult {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteCommitResult {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SearchService {
    db: AppDatabase,
}

impl SearchService {
    pub fn new(db: AppDatabase) -> Self {
        Self { db }
    }

    pub fn command_palette(
        &self,
        input: CommandPaletteSearchInput,
    ) -> Result<CommandPaletteSearchResults> {
        let query = input.query.trim();
        if query.len() < 2 {
            return Ok(CommandPaletteSearchResults {
                work_items: Vec::new(),
                pull_requests: Vec::new(),
                commits: Vec::new(),
            });
        }

        let conn = self.db.open()?;
        let organization_id = match input.organization_id {
            Some(id) => id,
            None => conn
                .query_row("SELECT id FROM organizations ORDER BY created_at LIMIT 1", [], |row| {
                    row.get::<_, String>(0)
                })
                .optional()?
                .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))?,
        };
        let direct_id = query.strip_prefix('#').and_then(|value| value.parse::<i64>().ok());
        let like = format!("%{}%", query.to_ascii_lowercase());
        let fts_query = fts5_query(query);

        Ok(CommandPaletteSearchResults {
            work_items: search_work_items(&conn, &organization_id, &fts_query, direct_id)?,
            pull_requests: search_pull_requests(&conn, &organization_id, &like, direct_id)?,
            commits: search_commits(&conn, &organization_id, &fts_query)?,
        })
    }
}

fn search_work_items(
    conn: &rusqlite::Connection,
    org_id: &str,
    fts_query: &str,
    direct_id: Option<i64>,
) -> Result<Vec<CommandPaletteWorkItemResult>> {
    if let Some(id) = direct_id {
        let row = conn
            .query_row(
                r#"
                SELECT org_id, project_id, project_name, id, title, work_item_type, state, web_url
                FROM work_items
                WHERE org_id = ?1 AND id = ?2
                "#,
                params![org_id, id],
                map_work_item,
            )
            .optional()?;
        return Ok(row.into_iter().collect());
    }

    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT w.org_id, w.project_id, w.project_name, w.id, w.title,
               w.work_item_type, w.state, w.web_url
        FROM work_items w
        WHERE w.org_id = ?2
          AND w.id IN (
              SELECT item_id FROM work_items_fts
              WHERE work_items_fts MATCH ?1 AND org_id = ?2
          )
        ORDER BY w.changed_date DESC
        LIMIT 25
        "#,
    )?;
    let rows = stmt.query_map(params![fts_query, org_id], map_work_item)?;
    collect_rows(rows)
}

fn search_pull_requests(
    conn: &rusqlite::Connection,
    org_id: &str,
    like: &str,
    direct_id: Option<i64>,
) -> Result<Vec<CommandPalettePullRequestResult>> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    let id_filter = direct_id.unwrap_or(-1);

    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               pull_request_id, title, status, web_url
        FROM pull_requests
        WHERE org_id = ?1
          AND (
            (?2 >= 0 AND pull_request_id = ?2)
            OR (?2 < 0 AND (lower(title) LIKE ?3 OR lower(repository_name) LIKE ?3))
          )
        ORDER BY creation_date DESC
        LIMIT 25
        "#,
    )?;
    for row in stmt.query_map(params![org_id, id_filter, like], map_pull_request)? {
        let pr = row?;
        let key = format!("{}:{}", pr.repository_id, pr.pull_request_id);
        if seen.insert(key) {
            results.push(pr);
        }
    }

    let mut review_stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, repository_id, repository_name,
               pull_request_id, title, web_url
        FROM review_pull_requests
        WHERE org_id = ?1
          AND (
            (?2 >= 0 AND pull_request_id = ?2)
            OR (?2 < 0 AND (lower(title) LIKE ?3 OR lower(repository_name) LIKE ?3))
          )
        ORDER BY creation_date DESC
        LIMIT 25
        "#,
    )?;
    let review_rows = review_stmt.query_map(params![org_id, id_filter, like], |row| {
        Ok(CommandPalettePullRequestResult {
            organization_id: row.get(0)?,
            project_id: row.get(1)?,
            project_name: row.get(2)?,
            repository_id: row.get(3)?,
            repository_name: row.get(4)?,
            pull_request_id: row.get(5)?,
            title: row.get(6)?,
            status: "active".to_string(),
            web_url: row.get(7)?,
        })
    })?;
    for row in review_rows {
        let pr = row?;
        let key = format!("{}:{}", pr.repository_id, pr.pull_request_id);
        if seen.insert(key) {
            results.push(pr);
        }
    }

    results.truncate(25);
    Ok(results)
}

fn search_commits(
    conn: &rusqlite::Connection,
    org_id: &str,
    fts_query: &str,
) -> Result<Vec<CommandPaletteCommitResult>> {
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT c.org_id, c.project_id, c.project_name, c.repository_id, c.repository_name,
               c.commit_id, substr(c.commit_id, 1, 8), c.comment, c.author_name, c.web_url
        FROM commits c
        WHERE c.org_id = ?2
          AND c.commit_id IN (
              SELECT commit_id FROM commits_fts
              WHERE commits_fts MATCH ?1 AND org_id = ?2
          )
        ORDER BY c.author_date DESC
        LIMIT 25
        "#,
    )?;
    let rows = stmt.query_map(params![fts_query, org_id], map_commit)?;
    collect_rows(rows)
}

fn fts5_query(input: &str) -> String {
    input
        .split_whitespace()
        .map(|word| word.trim_matches('#'))
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{}\"*", word.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
) -> Result<Vec<T>> {
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn map_work_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommandPaletteWorkItemResult> {
    Ok(CommandPaletteWorkItemResult {
        organization_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        id: row.get(3)?,
        title: row.get(4)?,
        work_item_type: row.get(5)?,
        state: row.get(6)?,
        web_url: row.get(7)?,
    })
}

fn map_pull_request(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommandPalettePullRequestResult> {
    Ok(CommandPalettePullRequestResult {
        organization_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        pull_request_id: row.get(5)?,
        title: row.get(6)?,
        status: row.get(7)?,
        web_url: row.get(8)?,
    })
}

fn map_commit(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommandPaletteCommitResult> {
    Ok(CommandPaletteCommitResult {
        organization_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        commit_id: row.get(5)?,
        short_commit_id: row.get(6)?,
        comment: row.get(7)?,
        author_name: row.get(8)?,
        web_url: row.get(9)?,
    })
}
