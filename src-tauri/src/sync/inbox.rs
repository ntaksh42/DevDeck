//! The Inbox lists only comments addressed to the user (mentions, replies,
//! comments on the user's own PRs). Earlier versions also stored *condition*
//! rows — a review request, a returned PR, a newly assigned work item — which
//! My Reviews and My Items already show. Those rows are finished here so they
//! leave the Inbox after the first sync of this version.

use std::collections::{BTreeMap, HashSet};

use azdo_client::AdoClient;

use crate::db::{AppDatabase, Organization};
use crate::prs::{is_ado_not_found, InboxUpdate, ScannedPr, KIND_PR_MENTION, KIND_PR_REPLY};

use super::SyncBudget;

const RETIRED_KINDS: [&str; 3] = ["pr_review_request", "pr_returned", "wi_assigned"];
/// PRs looked up per sync for their state; the rest wait for the next sync.
const CLOSED_PR_CHECKS: usize = 10;

/// Finishes open comment items of PRs that were completed, abandoned or
/// deleted. Those PRs drop out of the scanned review / authored lists, so
/// their threads are never read again and the items would stay open forever.
/// A PR the sync did not scan is looked up once to learn its state.
pub(super) async fn retire_closed_pr_items(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    scanned: &[ScannedPr],
    budget: &SyncBudget,
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let open = match db.unfinished_inbox_refs(&org.id, &[KIND_PR_MENTION, KIND_PR_REPLY]) {
        Ok(open) => open,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read PR items");
            return update;
        }
    };
    let scanned_keys: HashSet<(&str, i64)> = scanned
        .iter()
        .map(|pr| (pr.pr.repository_id.as_str(), pr.pr.pull_request_id))
        .collect();
    // (project, repository, PR) -> item ids, for PRs the sync did not scan.
    let mut unscanned: BTreeMap<(String, String, i64), Vec<i64>> = BTreeMap::new();
    for item in open {
        if !scanned_keys.contains(&(item.repository_id.as_str(), item.subject_id)) {
            unscanned
                .entry((item.project_id, item.repository_id, item.subject_id))
                .or_default()
                .push(item.id);
        }
    }
    for ((project_id, repository_id, pull_request_id), ids) in
        unscanned.into_iter().take(CLOSED_PR_CHECKS)
    {
        let Ok(_permit) = budget.clone().acquire_owned().await else {
            break;
        };
        let closed = match client
            .get_pull_request_detail(&project_id, &repository_id, pull_request_id)
            .await
        {
            Ok(pr) => pr
                .status
                .as_deref()
                .is_some_and(|status| !status.eq_ignore_ascii_case("active")),
            Err(e) if is_ado_not_found(&e) => true,
            Err(e) => {
                tracing::warn!(org = %org.name, pr = pull_request_id, error = ?e, "inbox: failed to read PR state");
                false
            }
        };
        if !closed {
            continue;
        }
        match db.set_inbox_item_state(&ids, "done", None) {
            Ok(count) => update.resolved += count,
            Err(e) => {
                tracing::warn!(org = %org.name, pr = pull_request_id, error = ?e, "inbox: failed to finish items of a closed PR")
            }
        }
    }
    update
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

    #[tokio::test]
    async fn items_of_a_completed_pr_are_finished() {
        use std::sync::Arc;

        use azdo_client::PatProvider;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let (_tf, db, org) = setup();
        let mut completed = item("pr_mention", 5);
        completed.repository_id = "repo-a".into();
        let mut active = item("pr_reply", 6);
        active.repository_id = "repo-b".into();
        db.insert_inbox_items(&[completed, active]).unwrap();

        let server = MockServer::start().await;
        let pr = |id: i64, status: &str| {
            serde_json::json!({
                "pullRequestId": id, "title": "t", "sourceRefName": "a", "targetRefName": "b",
                "status": status,
            })
        };
        Mock::given(method("GET"))
            .and(path("/proj/_apis/git/repositories/repo-a/pullrequests/5"))
            .respond_with(ResponseTemplate::new(200).set_body_json(pr(5, "completed")))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/proj/_apis/git/repositories/repo-b/pullrequests/6"))
            .respond_with(ResponseTemplate::new(200).set_body_json(pr(6, "active")))
            .mount(&server)
            .await;
        let client = AdoClient::new("org1", Arc::new(PatProvider::new("pat")))
            .unwrap()
            .with_base_url(url::Url::parse(&format!("{}/", server.uri())).unwrap());
        let budget: SyncBudget = Arc::new(tokio::sync::Semaphore::new(4));

        let update = retire_closed_pr_items(&db, &client, &org, &[], &budget).await;
        assert_eq!(update.resolved, 1);
        let open: Vec<i64> = db
            .list_inbox_items(None, InboxListState::Open, 100)
            .unwrap()
            .into_iter()
            .map(|item| item.subject_id)
            .collect();
        assert_eq!(open, vec![6]);
    }
}
