use rusqlite::{params, OptionalExtension};

use crate::error::{AppError, Result};

use super::AppDatabase;
use super::{
    list_my_work_items, search_work_items, search_work_items_fts, update_my_work_item_if_present,
    upsert_my_work_items, upsert_work_items,
};

#[derive(Debug, Clone)]
pub struct CachedWorkItem {
    pub org_id: String,
    pub project_id: String,
    pub project_name: String,
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

impl AppDatabase {
    pub fn upsert_work_items(&self, items: &[CachedWorkItem]) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        upsert_work_items(&conn, items)
    }

    pub fn search_work_items(
        &self,
        org_id: &str,
        project_ids: Option<&[String]>,
        states: Option<&[String]>,
        work_item_types: Option<&[String]>,
        assigned_to: Option<&str>,
    ) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        search_work_items(
            &conn,
            org_id,
            project_ids,
            states,
            work_item_types,
            assigned_to,
        )
    }

    pub fn search_work_items_fts(&self, org_id: &str, query: &str) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        search_work_items_fts(&conn, org_id, query)
    }

    pub fn list_my_work_items(&self, org_id: &str) -> Result<Vec<CachedWorkItem>> {
        let conn = self.open()?;
        list_my_work_items(&conn, org_id)
    }

    /// Reads just one work item's cached `System.ChangedDate` by id, avoiding a
    /// full my_work_items scan for callers (e.g. snooze baseline capture) that
    /// only need a single item's activity marker.
    pub fn my_work_item_changed_date(&self, org_id: &str, id: i64) -> Result<Option<String>> {
        let conn = self.open()?;
        conn.query_row(
            "SELECT changed_date FROM my_work_items WHERE org_id = ?1 AND id = ?2",
            params![org_id, id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|opt| opt.flatten())
        .map_err(AppError::from)
    }

    /// Keeps the my_work_items snapshot consistent after a single-item edit.
    ///
    /// When `my_unique_name` is known and the item is no longer assigned to that
    /// user, the row is removed so a reassignment drops out of My Work Items
    /// immediately instead of lingering until the next full sync. Otherwise the
    /// existing row (if any) is updated in place.
    pub fn update_my_work_item_if_present(
        &self,
        item: &CachedWorkItem,
        my_unique_name: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        update_my_work_item_if_present(&conn, item, my_unique_name)
    }

    /// Reflects a batch of single-item edits (the successful subset of a bulk
    /// state/assignee/priority operation) into the local cache in a single
    /// connection and transaction, instead of reopening SQLite once per item.
    pub fn apply_work_item_updates(
        &self,
        items: &[CachedWorkItem],
        my_unique_name: Option<&str>,
    ) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        upsert_work_items(&tx, items)?;
        for item in items {
            update_my_work_item_if_present(&tx, item, my_unique_name)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn replace_work_items(
        &self,
        org_id: &str,
        synced_project_ids: &[&str],
        all_items: &[CachedWorkItem],
        my_items: &[CachedWorkItem],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        // Delete only rows that left the snapshot instead of rewriting every
        // row; unchanged rows keep their rowid so the FTS triggers stay idle.
        tx.execute_batch("CREATE TEMP TABLE sync_work_item_ids(id INTEGER PRIMARY KEY) ")?;
        {
            let mut insert =
                tx.prepare_cached("INSERT OR IGNORE INTO sync_work_item_ids(id) VALUES (?1)")?;
            for item in all_items {
                insert.execute([item.id])?;
            }
        }
        for &project_id in synced_project_ids {
            tx.execute(
                "DELETE FROM work_items WHERE org_id = ?1 AND project_id = ?2 AND id NOT IN (SELECT id FROM sync_work_item_ids)",
                rusqlite::params![org_id, project_id],
            )?;
            tx.execute(
                "DELETE FROM my_work_items WHERE org_id = ?1 AND project_id = ?2",
                rusqlite::params![org_id, project_id],
            )?;
        }
        upsert_work_items(&tx, all_items)?;
        upsert_my_work_items(&tx, my_items)?;
        tx.execute_batch("DROP TABLE sync_work_item_ids")?;
        tx.commit()?;
        Ok(())
    }

    // Delta sync: merge changed work items without touching rows that are
    // absent from the snapshot. Deletions are reconciled by the periodic full
    // sync via `replace_work_items`. The my_work_items view is always a full
    // snapshot so assignment removals stay correct.
    pub fn apply_work_items_delta(
        &self,
        org_id: &str,
        synced_project_ids: &[&str],
        delta_items: &[CachedWorkItem],
        my_items: &[CachedWorkItem],
    ) -> Result<()> {
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        upsert_work_items(&tx, delta_items)?;
        for &project_id in synced_project_ids {
            tx.execute(
                "DELETE FROM my_work_items WHERE org_id = ?1 AND project_id = ?2",
                rusqlite::params![org_id, project_id],
            )?;
        }
        upsert_my_work_items(&tx, my_items)?;
        tx.commit()?;
        Ok(())
    }
}
