use rusqlite::{params, Connection};

use crate::error::Result;

use super::util::{escape_like_pattern, fts5_query, push_in_clause};
use super::{CachedCommit, CachedRepository};

pub(crate) fn upsert_commits(conn: &Connection, commits: &[CachedCommit]) -> Result<()> {
    // Commits are immutable; only project/repo display metadata can change
    // (e.g. a repository rename), so unchanged rows are skipped.
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO commits(
            org_id, project_id, project_name, repository_id, repository_name,
            commit_id, comment, author_name, author_email, author_date, web_url,
            author_image_url, committer_name, committer_email, committer_date
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(org_id, repository_id, commit_id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            repository_name = excluded.repository_name,
            web_url = excluded.web_url
        WHERE excluded.project_name IS NOT commits.project_name
           OR excluded.repository_name IS NOT commits.repository_name
           OR excluded.web_url IS NOT commits.web_url
        "#,
    )?;
    for c in commits {
        stmt.execute(params![
            c.org_id,
            c.project_id,
            c.project_name,
            c.repository_id,
            c.repository_name,
            c.commit_id,
            c.comment,
            c.author_name,
            c.author_email,
            c.author_date,
            c.web_url,
            c.author_image_url,
            c.committer_name,
            c.committer_email,
            c.committer_date
        ])?;
    }
    Ok(())
}

pub(crate) fn search_commits(
    conn: &Connection,
    org_id: &str,
    repository_ids: Option<&[String]>,
    author: Option<&str>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<CachedCommit>> {
    // Match the in-memory author filter (commits.rs): case-insensitive
    // substring against author name OR email. Applying it in SQL keeps the
    // LIMIT 500 cap from dropping matching commits that sort after the cap.
    let author_pattern = author.map(|a| format!("%{}%", escape_like_pattern(&a.to_lowercase())));
    let mut sql = String::from(
        "SELECT org_id, project_id, project_name, repository_id, repository_name, \
                commit_id, comment, author_name, author_email, author_date, web_url, \
                author_image_url, committer_name, committer_email, committer_date \
         FROM commits \
         WHERE org_id = ?1",
    );
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(org_id.to_string())];
    push_in_clause(&mut sql, &mut bind, "repository_id", repository_ids);
    if let Some(pattern) = author_pattern.as_ref() {
        let idx = bind.len() + 1;
        sql.push_str(&format!(
            " AND (lower(author_name) LIKE ?{idx} ESCAPE '\\' \
               OR lower(author_email) LIKE ?{idx} ESCAPE '\\')"
        ));
        bind.push(Box::new(pattern.clone()));
    }
    if let Some(from_date) = from_date {
        sql.push_str(&format!(" AND author_date >= ?{}", bind.len() + 1));
        bind.push(Box::new(from_date.to_string()));
    }
    if let Some(to_date) = to_date {
        sql.push_str(&format!(" AND author_date <= ?{}", bind.len() + 1));
        bind.push(Box::new(to_date.to_string()));
    }
    sql.push_str(" ORDER BY author_date DESC LIMIT 500");

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|value| value.as_ref()).collect();
    let rows = stmt.query_map(params.as_slice(), map_cached_commit)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(crate) fn search_commits_fts(
    conn: &Connection,
    org_id: &str,
    query: &str,
    repository_ids: Option<&[String]>,
) -> Result<Vec<CachedCommit>> {
    let fts_query = fts5_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    // ?1 = fts_query, ?2 = org_id, then one bind per repository id. The repo
    // filter is referenced twice (outer query and FTS subquery), so the same
    // placeholders are reused with the right table prefix in each spot.
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(fts_query), Box::new(org_id.to_string())];
    let placeholders: Vec<String> = match repository_ids.filter(|values| !values.is_empty()) {
        Some(values) => {
            let start = bind.len() + 1;
            let placeholders = (0..values.len())
                .map(|offset| format!("?{}", start + offset))
                .collect::<Vec<_>>();
            for value in values {
                bind.push(Box::new(value.clone()));
            }
            placeholders
        }
        None => Vec::new(),
    };
    let repo_clause = |prefix: &str| {
        if placeholders.is_empty() {
            String::new()
        } else {
            format!(
                " AND {prefix}repository_id IN ({})",
                placeholders.join(", ")
            )
        }
    };
    let sql = format!(
        "SELECT c.org_id, c.project_id, c.project_name, c.repository_id, c.repository_name, \
                c.commit_id, c.comment, c.author_name, c.author_email, c.author_date, c.web_url, \
                c.author_image_url, c.committer_name, c.committer_email, c.committer_date \
         FROM commits c \
         WHERE c.org_id = ?2{outer} \
           AND c.commit_id IN ( \
               SELECT commit_id FROM commits_fts \
               WHERE commits_fts MATCH ?1 AND org_id = ?2{inner} \
           ) \
         ORDER BY c.author_date DESC \
         LIMIT 200",
        outer = repo_clause("c."),
        inner = repo_clause(""),
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|value| value.as_ref()).collect();
    let rows = stmt.query_map(params.as_slice(), map_cached_commit)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(crate) fn list_commit_repositories(
    conn: &Connection,
    org_id: &str,
) -> Result<Vec<CachedRepository>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT DISTINCT project_id, project_name, repository_id, repository_name
        FROM commits WHERE org_id = ?1
        ORDER BY project_name, repository_name
        "#,
    )?;
    let rows = stmt.query_map([org_id], |row| {
        Ok(CachedRepository {
            project_id: row.get(0)?,
            project_name: row.get(1)?,
            repository_id: row.get(2)?,
            repository_name: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// Aggregates commit counts per calendar day for the activity heatmap. The
/// author filter matches the name or email as a case-insensitive substring,
/// mirroring the commit search behaviour. Dates are derived from `author_date`
/// via SQLite's `date()`; commits without an `author_date` are skipped.
pub(crate) fn commit_activity(
    conn: &Connection,
    org_id: &str,
    project_id: Option<&str>,
    repository_id: Option<&str>,
    author: Option<&str>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<(String, i64)>> {
    let author_like = author.map(|a| format!("%{}%", a.to_lowercase()));
    let mut stmt = conn.prepare(
        r#"
        SELECT date(author_date) AS day, COUNT(*) AS count
        FROM commits
        WHERE org_id = ?1
          AND author_date IS NOT NULL
          AND (?2 IS NULL OR project_id = ?2)
          AND (?3 IS NULL OR repository_id = ?3)
          AND (?4 IS NULL
               OR lower(IFNULL(author_name, '')) LIKE ?4
               OR lower(IFNULL(author_email, '')) LIKE ?4)
          AND (?5 IS NULL OR author_date >= ?5)
          AND (?6 IS NULL OR author_date <= ?6)
        GROUP BY day
        ORDER BY day
        "#,
    )?;
    let rows = stmt.query_map(
        params![
            org_id,
            project_id,
            repository_id,
            author_like,
            from_date,
            to_date
        ],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn map_cached_commit(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedCommit> {
    Ok(CachedCommit {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        repository_id: row.get(3)?,
        repository_name: row.get(4)?,
        commit_id: row.get(5)?,
        comment: row.get(6)?,
        author_name: row.get(7)?,
        author_email: row.get(8)?,
        author_date: row.get(9)?,
        web_url: row.get(10)?,
        author_image_url: row.get(11)?,
        committer_name: row.get(12)?,
        committer_email: row.get(13)?,
        committer_date: row.get(14)?,
    })
}
