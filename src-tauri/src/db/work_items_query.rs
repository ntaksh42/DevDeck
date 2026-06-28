use rusqlite::{params, Connection};

use crate::error::Result;

use super::util::{escape_like_pattern, fts5_query, push_in_clause};
use super::{CachedWorkItem, MY_WORK_ITEMS_LIMIT};

pub(crate) fn upsert_work_items(conn: &Connection, items: &[CachedWorkItem]) -> Result<()> {
    // Azure DevOps bumps System.ChangedDate on every revision, so it works as
    // a version stamp: rows with an unchanged date are skipped entirely and
    // the FTS update trigger never fires for them.
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT INTO work_items(
            org_id, project_id, project_name, id, title,
            work_item_type, state, assigned_to, changed_date, web_url,
            assigned_to_unique_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(org_id, id) DO UPDATE SET
            project_id = excluded.project_id,
            project_name = excluded.project_name,
            title = excluded.title,
            work_item_type = excluded.work_item_type,
            state = excluded.state,
            assigned_to = excluded.assigned_to,
            changed_date = excluded.changed_date,
            web_url = excluded.web_url,
            assigned_to_unique_name = excluded.assigned_to_unique_name
        WHERE excluded.changed_date IS NOT work_items.changed_date
        "#,
    )?;
    for item in items {
        stmt.execute(params![
            item.org_id,
            item.project_id,
            item.project_name,
            item.id,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.changed_date,
            item.web_url,
            item.assigned_to_unique_name
        ])?;
    }
    Ok(())
}

/// Keeps the my_work_items snapshot consistent after a single-item edit.
///
/// When `my_unique_name` is known and the item is no longer assigned to that
/// user, the row is removed so a reassignment drops out of My Work Items
/// immediately instead of lingering until the next full sync. Otherwise the
/// existing row (if any) is updated in place.
pub(crate) fn update_my_work_item_if_present(
    conn: &Connection,
    item: &CachedWorkItem,
    my_unique_name: Option<&str>,
) -> Result<()> {
    let still_mine = match (my_unique_name, item.assigned_to_unique_name.as_deref()) {
        (Some(me), Some(assignee)) => me.eq_ignore_ascii_case(assignee),
        // Unknown identity or unassigned: fall back to update-only to avoid
        // dropping a row we cannot confidently say left the snapshot.
        (None, _) => true,
        (Some(_), None) => false,
    };

    if !still_mine {
        conn.execute(
            "DELETE FROM my_work_items WHERE org_id=?1 AND id=?2",
            rusqlite::params![item.org_id, item.id],
        )?;
        return Ok(());
    }
    conn.execute(
        "UPDATE my_work_items SET title=?3, work_item_type=?4, state=?5, \
         assigned_to=?6, assigned_to_unique_name=?7, changed_date=?8, web_url=?9 \
         WHERE org_id=?1 AND id=?2",
        rusqlite::params![
            item.org_id,
            item.id,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.assigned_to_unique_name,
            item.changed_date,
            item.web_url
        ],
    )?;
    Ok(())
}

pub(crate) fn search_work_items(
    conn: &Connection,
    org_id: &str,
    project_ids: Option<&[String]>,
    states: Option<&[String]>,
    work_item_types: Option<&[String]>,
    assigned_to: Option<&str>,
) -> Result<Vec<CachedWorkItem>> {
    // Build the WHERE clause dynamically so each multi-value filter expands to
    // an `IN (...)` list, keeping the filtering server-side (before the LIMIT).
    let mut sql = String::from(
        "SELECT org_id, project_id, project_name, id, title, \
                work_item_type, state, assigned_to, changed_date, web_url, \
                assigned_to_unique_name \
         FROM work_items \
         WHERE org_id = ?1",
    );
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(org_id.to_string())];

    push_in_clause(&mut sql, &mut bind, "project_id", project_ids);
    push_in_clause(&mut sql, &mut bind, "state", states);
    push_in_clause(&mut sql, &mut bind, "work_item_type", work_item_types);
    if let Some(assigned_to) = assigned_to {
        sql.push_str(&format!(" AND assigned_to = ?{}", bind.len() + 1));
        bind.push(Box::new(assigned_to.to_string()));
    }
    sql.push_str(" ORDER BY changed_date DESC LIMIT 500");

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|value| value.as_ref()).collect();
    let rows = stmt.query_map(params.as_slice(), map_cached_work_item)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(crate) fn search_work_items_fts(
    conn: &Connection,
    org_id: &str,
    query: &str,
) -> Result<Vec<CachedWorkItem>> {
    // Numeric queries also match work item IDs (exact match first, then prefix).
    let mut result = if !query.is_empty() && query.bytes().all(|b| b.is_ascii_digit()) {
        search_work_items_by_id_prefix(conn, org_id, query)?
    } else {
        Vec::new()
    };
    let fts_query = fts5_query(query);
    if fts_query.is_empty() {
        return Ok(result);
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT w.org_id, w.project_id, w.project_name, w.id, w.title,
               w.work_item_type, w.state, w.assigned_to, w.changed_date, w.web_url,
               w.assigned_to_unique_name
        FROM work_items w
        WHERE w.org_id = ?2
          AND w.id IN (
              SELECT item_id FROM work_items_fts
              WHERE work_items_fts MATCH ?1 AND org_id = ?2
          )
        ORDER BY w.changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![fts_query, org_id], map_cached_work_item)?;
    let mut text_matches = Vec::new();
    for row in rows {
        text_matches.push(row?);
    }
    if text_matches.is_empty() {
        // FTS tokenization cannot match substrings inside CJK text; fall back
        // to a LIKE scan so Japanese queries still find cached work items.
        text_matches = search_work_items_like(conn, org_id, query)?;
    }
    if result.is_empty() {
        return Ok(text_matches);
    }
    for item in text_matches {
        if !result
            .iter()
            .any(|r| r.id == item.id && r.project_id == item.project_id)
        {
            result.push(item);
        }
    }
    // The id-prefix and text matches are each ordered by changed_date DESC, but
    // concatenating them breaks that order. Re-sort so the combined result stays
    // date-descending, matching the ordering the search palette expects.
    result.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
    Ok(result)
}

fn search_work_items_by_id_prefix(
    conn: &Connection,
    org_id: &str,
    digits: &str,
) -> Result<Vec<CachedWorkItem>> {
    let pattern = format!("{digits}%");
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM work_items
        WHERE org_id = ?1
          AND CAST(id AS TEXT) LIKE ?2
        ORDER BY (CAST(id AS TEXT) = ?3) DESC, changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![org_id, pattern, digits], map_cached_work_item)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn search_work_items_like(
    conn: &Connection,
    org_id: &str,
    query: &str,
) -> Result<Vec<CachedWorkItem>> {
    let pattern = format!("%{}%", escape_like_pattern(query));
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM work_items
        WHERE org_id = ?1
          AND (title LIKE ?2 ESCAPE '\'
               OR work_item_type LIKE ?2 ESCAPE '\'
               OR assigned_to LIKE ?2 ESCAPE '\'
               OR assigned_to_unique_name LIKE ?2 ESCAPE '\')
        ORDER BY changed_date DESC
        LIMIT 200
        "#,
    )?;
    let rows = stmt.query_map(params![org_id, pattern], map_cached_work_item)?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(crate) fn upsert_my_work_items(conn: &Connection, items: &[CachedWorkItem]) -> Result<()> {
    let mut stmt = conn.prepare_cached(
        r#"
        INSERT OR REPLACE INTO my_work_items(
            org_id, project_id, project_name, id, title,
            work_item_type, state, assigned_to, changed_date, web_url,
            assigned_to_unique_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
    )?;
    for item in items {
        stmt.execute(params![
            item.org_id,
            item.project_id,
            item.project_name,
            item.id,
            item.title,
            item.work_item_type,
            item.state,
            item.assigned_to,
            item.changed_date,
            item.web_url,
            item.assigned_to_unique_name
        ])?;
    }
    Ok(())
}

pub(crate) fn list_my_work_items(conn: &Connection, org_id: &str) -> Result<Vec<CachedWorkItem>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT org_id, project_id, project_name, id, title,
               work_item_type, state, assigned_to, changed_date, web_url,
               assigned_to_unique_name
        FROM my_work_items
        WHERE org_id = ?1
        ORDER BY changed_date DESC
        LIMIT ?2
        "#,
    )?;
    let rows = stmt.query_map(
        params![org_id, MY_WORK_ITEMS_LIMIT as i64],
        map_cached_work_item,
    )?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn map_cached_work_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedWorkItem> {
    Ok(CachedWorkItem {
        org_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        id: row.get(3)?,
        title: row.get(4)?,
        work_item_type: row.get(5)?,
        state: row.get(6)?,
        assigned_to: row.get(7)?,
        changed_date: row.get(8)?,
        web_url: row.get(9)?,
        assigned_to_unique_name: row.get(10)?,
    })
}
