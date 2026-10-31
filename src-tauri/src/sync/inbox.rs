//! The Inbox lists only comments addressed to the user (mentions, replies,
//! comments on the user's own PRs). Earlier versions also stored *condition*
//! rows — a review request, a returned PR, a newly assigned work item — which
//! My Reviews and My Items already show. Those rows are finished here so they
//! leave the Inbox after the first sync of this version.

use crate::db::{AppDatabase, Organization};
use crate::prs::InboxUpdate;

const RETIRED_KINDS: [&str; 3] = ["pr_review_request", "pr_returned", "wi_assigned"];

/// Records the Inbox scan of one sync kind (`inbox_prs` / `inbox_wi`) in Sync
/// health, so a scan that left something out shows as "Limited" instead of
/// silently missing comments.
pub(super) fn record_inbox_health(
    db: &AppDatabase,
    org: &Organization,
    kind: &str,
    warning: Option<&str>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = db.update_sync_state(
        &format!("{kind}:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        warning,
    ) {
        tracing::warn!(org = %org.name, error = ?e, "inbox: failed to record the scan in sync health");
    }
}

/// Finishes any open row of a kind the Inbox no longer lists.
pub(super) fn retire_condition_items(db: &AppDatabase, org: &Organization) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let ids: Vec<i64> = match db.unfinished_inbox_refs(&org.id, &RETIRED_KINDS) {
        Ok(open) => open.into_iter().map(|item| item.id).collect(),
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read retired items");
            return update;
        }
    };
    if ids.is_empty() {
        return update;
    }
    match db.set_inbox_item_state(&ids, "done", None) {
        Ok(count) => update.resolved += count,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to finish retired items")
        }
    }
    update
}

#[cfg(test)]
mod tests {
    use tempfile::NamedTempFile;

    use super::*;
    use crate::db::{InboxListState, NewInboxItem, OrganizationDraft};

    fn setup() -> (NamedTempFile, AppDatabase, Organization) {
        let tf = NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        let org = db
            .upsert_organization(OrganizationDraft {
                id: "org1".into(),
                name: "org1".into(),
                display_name: None,
                base_url: "https://dev.azure.com/org1".into(),
                auth_provider: "pat".into(),
                credential_key: "azdodeck:org:org1:pat".into(),
                authenticated_user_id: Some("me".into()),
                authenticated_user_display_name: None,
                authenticated_user_unique_name: None,
                provider_kind: "azdo".into(),
            })
            .unwrap();
        (tf, db, org)
    }

    fn item(kind: &str, subject_id: i64) -> NewInboxItem {
        NewInboxItem {
            organization_id: "org1".into(),
            kind: kind.into(),
            subject_id,
            project_id: "proj".into(),
            project_name: "Project".into(),
            repository_id: "repo".into(),
            repository_name: "api".into(),
            thread_id: 0,
            comment_id: subject_id,
            title: format!("item {subject_id}"),
            author: None,
            snippet: None,
            web_url: None,
            file_path: None,
            line: None,
        }
    }

    #[test]
    fn condition_rows_from_earlier_versions_are_finished_and_comments_stay() {
        let (_tf, db, org) = setup();
        db.insert_inbox_items(&[
            item("pr_review_request", 1),
            item("pr_returned", 2),
            item("wi_assigned", 3),
            item("pr_mention", 4),
        ])
        .unwrap();
        let update = retire_condition_items(&db, &org);
        assert_eq!(update.resolved, 3);
        let open: Vec<String> = db
            .list_inbox_items(None, InboxListState::Open, 100)
            .unwrap()
            .into_iter()
            .map(|item| item.kind)
            .collect();
        assert_eq!(open, vec!["pr_mention".to_string()]);
    }
}
