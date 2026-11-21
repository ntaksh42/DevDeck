//! Items the user excluded from automatic runs, kept in `auto-agent/excluded.json`.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{key, Key};
use crate::agent_notes::NoteTarget;
use crate::db::AppDatabase;
use crate::error::{AppError, Result};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedItem {
    pub organization_id: String,
    pub target: NoteTarget,
    pub id: i64,
    pub title: String,
    pub scope: String,
    #[serde(default)]
    pub scope_id: String,
    #[serde(default)]
    pub excluded_at: Option<DateTime<Utc>>,
}

fn excluded_path(db: &AppDatabase) -> PathBuf {
    db.data_dir().join("auto-agent").join("excluded.json")
}

pub(super) fn read_excluded(db: &AppDatabase) -> Vec<ExcludedItem> {
    fs::read(excluded_path(db))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Items automatic runs leave alone.
pub(in crate::auto_agent) fn excluded_keys(db: &AppDatabase) -> HashSet<Key> {
    read_excluded(db)
        .into_iter()
        .map(|e| key(&e.organization_id, e.target, e.id))
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetExcludedInput {
    #[serde(flatten)]
    pub item: ExcludedItem,
    pub excluded: bool,
}

/// Serializes the read-modify-write below: excluding several items sends one
/// command each, and they run on separate threads.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn set_excluded(db: &AppDatabase, input: SetExcludedInput) -> Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let SetExcludedInput { mut item, excluded } = input;
    let wanted = key(&item.organization_id, item.target, item.id);
    let path = excluded_path(db);
    // An unreadable list must not be replaced by one holding only this item.
    let mut items: Vec<ExcludedItem> = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            AppError::InvalidInput(format!("the excluded items list is unreadable: {e}"))
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    items.retain(|e| key(&e.organization_id, e.target, e.id) != wanted);
    if excluded {
        item.excluded_at = Some(Utc::now());
        items.push(item);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(&items).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes)?;
    fs::rename(temp, path)?;
    Ok(())
}
