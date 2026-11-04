//! Clears answered "remind me if no one replies" reminders and raises the
//! overdue ones as Inbox rows (see `db/reply_reminders.rs`). Cheap and
//! repeatable, so it runs after each part of the sync that files Inbox rows.

use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::db::{AppDatabase, Organization};

pub(super) fn reconcile(db: &AppDatabase, handle: &AppHandle, org: &Organization) {
    let outcome = match db.reconcile_reply_reminders(&org.id) {
        Ok(outcome) => outcome,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to update reply reminders");
            return;
        }
    };
    if outcome.cleared == 0 && outcome.fired.is_empty() {
        return;
    }
    if let Err(e) = handle.emit("action-inbox:updated", json!({})) {
        tracing::warn!(org = %org.name, error = ?e, "sync: failed to emit action inbox update");
    }
    if outcome.fired.is_empty() {
        return;
    }
    let event = json!({
        "organizationId": org.id,
        "organizationName": org.name,
        "items": outcome.fired,
    });
    if let Err(e) = handle.emit("inbox:reply-reminders-due", event) {
        tracing::warn!(org = %org.name, error = ?e, "sync: failed to emit reply reminder event");
    }
}
