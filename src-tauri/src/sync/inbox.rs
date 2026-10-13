//! Inbox items that mirror a *condition* rather than a one-off event: a review
//! that is waiting for the user's vote, a returned PR, a newly assigned work
//! item. They are written after the PR / work item cache refresh and closed by
//! the same pass once the condition ends (voted, completed, reassigned), so the
//! Inbox never shows something that no longer needs the user.

use std::collections::{HashMap, HashSet};

use chrono::Utc;

use crate::db::{AppDatabase, CachedReviewPr, CachedWorkItem, NewInboxItem, Organization};
use crate::prs::InboxUpdate;

pub(super) const KIND_REVIEW_REQUEST: &str = "pr_review_request";
pub(super) const KIND_RETURNED: &str = "pr_returned";
pub(super) const KIND_WI_ASSIGNED: &str = "wi_assigned";

fn review_item(
    org: &Organization,
    pr: &CachedReviewPr,
    kind: &str,
    comment_id: i64,
) -> NewInboxItem {
    NewInboxItem {
        organization_id: org.id.clone(),
        kind: kind.to_string(),
        subject_id: pr.pull_request_id,
        project_id: pr.project_id.clone(),
        project_name: pr.project_name.clone(),
        repository_id: pr.repository_id.clone(),
        repository_name: pr.repository_name.clone(),
        thread_id: 0,
        comment_id,
        title: pr.title.clone(),
        author: pr.created_by.clone(),
        snippet: None,
        web_url: pr.web_url.clone(),
        file_path: None,
        line: None,
    }
}

/// Returned PRs from the review-PR cache.
///
/// When the user's vote on a non-draft review PR went from set to unset
/// between the two snapshots (the author pushed), it is a returned PR. A PR
/// merely waiting for a vote is not an item: My Reviews already lists those,
/// and a mention on one arrives as its own item. Request rows stored by earlier
/// versions are finished here. Returned items whose PR no longer waits for a
/// vote (voted, draft, completed, removed) are finished.
pub(super) fn update_review_state_items(
    db: &AppDatabase,
    org: &Organization,
    previous: &[CachedReviewPr],
    current: &[CachedReviewPr],
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let previous_by_key: HashMap<(&str, i64), &CachedReviewPr> = previous
        .iter()
        .map(|pr| ((pr.repository_id.as_str(), pr.pull_request_id), pr))
        .collect();
    let now_secs = Utc::now().timestamp();

    let mut waiting: HashSet<(String, i64)> = HashSet::new();
    let mut new_items = Vec::new();
    for pr in current {
        if pr.is_draft || pr.my_vote != 0 {
            continue;
        }
        waiting.insert((pr.repository_id.clone(), pr.pull_request_id));
        let was_voted = previous_by_key
            .get(&(pr.repository_id.as_str(), pr.pull_request_id))
            .is_some_and(|prev| prev.my_vote != 0);
        if was_voted {
            // A returned PR is told apart per push, so a later return after a
            // finished one is a new item.
            new_items.push(review_item(org, pr, KIND_RETURNED, now_secs));
        }
    }
    match db.insert_inbox_items(&new_items) {
        Ok(count) => update.added += count,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to store review items")
        }
    }

    match db.unfinished_inbox_refs(&org.id, &[KIND_REVIEW_REQUEST, KIND_RETURNED]) {
        Ok(open) => {
            let finished: Vec<i64> = open
                .into_iter()
                .filter(|item| {
                    item.kind == KIND_REVIEW_REQUEST
                        || !waiting.contains(&(item.repository_id.clone(), item.subject_id))
                })
                .map(|item| item.id)
                .collect();
            if !finished.is_empty() {
                match db.set_inbox_item_state(&finished, "done", None) {
                    Ok(count) => update.resolved += count,
                    Err(e) => {
                        tracing::warn!(org = %org.name, error = ?e, "inbox: failed to close review items")
                    }
                }
            }
        }
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read review items")
        }
    }
    update
}

/// Newly assigned work items. Like the assignment notification, nothing is
/// created on the organization's very first sync (`baseline_established` is
/// false), where every assigned item would otherwise look new. Items that left
/// the user's assigned set (completed, reassigned) are finished.
pub(super) fn update_assigned_work_item_items(
    db: &AppDatabase,
    org: &Organization,
    previous: &[CachedWorkItem],
    current: &[CachedWorkItem],
    baseline_established: bool,
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let previous_ids: HashSet<i64> = previous.iter().map(|item| item.id).collect();
    let current_ids: HashSet<i64> = current.iter().map(|item| item.id).collect();

    if baseline_established {
        let new_items: Vec<NewInboxItem> = current
            .iter()
            .filter(|item| !previous_ids.contains(&item.id))
            .map(|item| NewInboxItem {
                organization_id: org.id.clone(),
                kind: KIND_WI_ASSIGNED.to_string(),
                subject_id: item.id,
                project_id: item.project_id.clone(),
                project_name: item.project_name.clone(),
                repository_id: String::new(),
                repository_name: String::new(),
                thread_id: 0,
                comment_id: 0,
                title: item.title.clone(),
                author: None,
                snippet: Some(
                    [item.work_item_type.as_deref(), item.state.as_deref()]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" · "),
                )
                .filter(|text| !text.is_empty()),
                web_url: item.web_url.clone(),
                file_path: None,
                line: None,
            })
            .collect();
        match db.insert_inbox_items(&new_items) {
            Ok(count) => update.added += count,
            Err(e) => {
                tracing::warn!(org = %org.name, error = ?e, "inbox: failed to store assigned items")
            }
        }
    }

    match db.unfinished_inbox_refs(&org.id, &[KIND_WI_ASSIGNED]) {
        Ok(open) => {
            let finished: Vec<i64> = open
                .into_iter()
                .filter(|item| !current_ids.contains(&item.subject_id))
                .map(|item| item.id)
                .collect();
            if !finished.is_empty() {
                match db.set_inbox_item_state(&finished, "done", None) {
                    Ok(count) => update.resolved += count,
                    Err(e) => {
                        tracing::warn!(org = %org.name, error = ?e, "inbox: failed to close assigned items")
                    }
                }
            }
        }
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read assigned items")
        }
    }
    update
}

#[cfg(test)]
mod tests {
    use tempfile::NamedTempFile;

    use super::*;
    use crate::db::{InboxListState, OrganizationDraft};

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

    fn pr(id: i64, vote: i32, draft: bool) -> CachedReviewPr {
        CachedReviewPr {
            org_id: "org1".into(),
            project_id: "proj".into(),
            project_name: "Project".into(),
            repository_id: "repo".into(),
            repository_name: "api".into(),
            pull_request_id: id,
            title: format!("PR {id}"),
            created_by: Some("Tanaka".into()),
            creation_date: "2026-10-01T00:00:00Z".into(),
            target_ref_name: "refs/heads/main".into(),
            web_url: None,
            my_vote: vote,
            my_vote_label: String::new(),
            my_is_required: false,
            is_draft: draft,
            merge_status: None,
            ci_status: None,
            ci_context: None,
            ci_check_count: 0,
        }
    }

    fn work_item(id: i64) -> CachedWorkItem {
        CachedWorkItem {
            org_id: "org1".into(),
            project_id: "proj".into(),
            project_name: "Project".into(),
            id,
            title: format!("WI {id}"),
            work_item_type: Some("Bug".into()),
            state: Some("Active".into()),
            assigned_to: Some("Me".into()),
            assigned_to_unique_name: None,
            changed_date: None,
            web_url: None,
            tags: None,
        }
    }

    fn open_kinds(db: &AppDatabase) -> Vec<(String, i64)> {
        let mut rows: Vec<(String, i64)> = db
            .list_inbox_items(None, InboxListState::Open, 100)
            .unwrap()
            .into_iter()
            .map(|item| (item.kind, item.subject_id))
            .collect();
        rows.sort();
        rows
    }

    #[test]
    fn a_pr_waiting_for_a_vote_is_not_an_item() {
        let (_tf, db, org) = setup();
        let current = [pr(1, 0, false), pr(2, 10, false), pr(3, 0, true)];
        let update = update_review_state_items(&db, &org, &current, &current);
        assert_eq!(update.added, 0);
        assert!(open_kinds(&db).is_empty());
    }

    #[test]
    fn request_rows_from_earlier_versions_are_finished() {
        let (_tf, db, org) = setup();
        let waiting = [pr(1, 0, false)];
        db.insert_inbox_items(&[review_item(&org, &waiting[0], KIND_REVIEW_REQUEST, 0)])
            .unwrap();
        assert_eq!(open_kinds(&db), vec![("pr_review_request".into(), 1)]);

        // Still waiting for a vote, yet the row is closed.
        let update = update_review_state_items(&db, &org, &waiting, &waiting);
        assert_eq!(update.resolved, 1);
        assert!(open_kinds(&db).is_empty());
    }

    #[test]
    fn voting_or_losing_the_pr_finishes_the_returned_item() {
        let (_tf, db, org) = setup();
        let voted = [pr(1, 10, false), pr(2, 10, false)];
        let reset = [pr(1, 0, false), pr(2, 0, false)];
        update_review_state_items(&db, &org, &voted, &reset);
        assert_eq!(open_kinds(&db).len(), 2);

        // PR 1 voted again, PR 2 left the review list.
        let after = [pr(1, 10, false)];
        let update = update_review_state_items(&db, &org, &reset, &after);
        assert_eq!(update.resolved, 2);
        assert!(open_kinds(&db).is_empty());
    }

    #[test]
    fn a_vote_reset_becomes_a_single_returned_item() {
        let (_tf, db, org) = setup();
        let voted = [pr(1, 10, false)];
        update_review_state_items(&db, &org, &[], &voted);
        assert!(open_kinds(&db).is_empty());

        let reset = [pr(1, 0, false)];
        update_review_state_items(&db, &org, &voted, &reset);
        assert_eq!(open_kinds(&db), vec![("pr_returned".into(), 1)]);

        // The next sync (vote still unset) does not add a request beside it.
        update_review_state_items(&db, &org, &reset, &reset);
        assert_eq!(open_kinds(&db), vec![("pr_returned".into(), 1)]);

        // Finishing the returned item keeps it finished.
        let id = db.list_inbox_items(None, InboxListState::Open, 10).unwrap()[0].id;
        db.set_inbox_item_state(&[id], "done", None).unwrap();
        update_review_state_items(&db, &org, &reset, &reset);
        assert!(open_kinds(&db).is_empty());
    }

    #[test]
    fn new_assignments_are_added_after_the_baseline_and_close_when_gone() {
        let (_tf, db, org) = setup();
        let existing = [work_item(1)];
        // First sync of the organization: nothing is created.
        let first = update_assigned_work_item_items(&db, &org, &[], &existing, false);
        assert_eq!(first.added, 0);

        let now = [work_item(1), work_item(2)];
        let update = update_assigned_work_item_items(&db, &org, &existing, &now, true);
        assert_eq!(update.added, 1);
        assert_eq!(open_kinds(&db), vec![("wi_assigned".into(), 2)]);
        let item = db
            .list_inbox_items(None, InboxListState::Open, 10)
            .unwrap()
            .remove(0);
        assert_eq!(item.snippet.as_deref(), Some("Bug · Active"));

        // WI 2 is completed / reassigned and drops out of the assigned set.
        let later = [work_item(1)];
        let update = update_assigned_work_item_items(&db, &org, &now, &later, true);
        assert_eq!(update.resolved, 1);
        assert!(open_kinds(&db).is_empty());
    }
}
