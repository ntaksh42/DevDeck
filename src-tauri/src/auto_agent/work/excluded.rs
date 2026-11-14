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

pub fn set_excluded(db: &AppDatabase, input: SetExcludedInput) -> Result<()> {
    let SetExcludedInput { mut item, excluded } = input;
    let wanted = key(&item.organization_id, item.target, item.id);
    let mut items = read_excluded(db);
    items.retain(|e| key(&e.organization_id, e.target, e.id) != wanted);
    if excluded {
        item.excluded_at = Some(Utc::now());
        items.push(item);
    }
    let path = excluded_path(db);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(&items).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    fs::write(path, bytes)?;
    Ok(())
}
