//! Completed or abandoned PRs must leave the cached grids: when the group
//! lookup fails, My Reviews keeps unresolved rows only while they may still be
//! active, and a PR closed from this app is dropped right away.

use std::sync::Arc;

use azdo_client::{AdoClient, PatProvider};
use serde_json::json;
use tokio::sync::Semaphore;
use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::sync::do_sync_prs;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, OrganizationDraft, PrReviewerCount};
use crate::sync::SyncBudget;

fn pr_json(id: i64) -> serde_json::Value {
    json!({
        "pullRequestId": id,
        "title": format!("PR {id}"),
        "status": "active",
        "creationDate": "2026-06-09T00:00:00Z",
        "repository": {
            "id": "repo-1",
            "name": "Repo",
            "project": { "id": "project-1", "name": "Platform" }
        },
        "sourceRefName": "refs/heads/feature",
        "targetRefName": "refs/heads/main"
    })
}

fn review_row(org_id: &str, id: i64) -> CachedReviewPr {
    CachedReviewPr {
        org_id: org_id.to_string(),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id: id,
        title: format!("PR {id}"),
        created_by: None,
        creation_date: "2026-06-09T00:00:00Z".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        my_vote: 0,
        my_vote_label: "No vote".to_string(),
        my_is_required: false,
        is_draft: false,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn new_db(user: Option<&str>) -> (AppDatabase, String, tempfile::NamedTempFile) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: user.map(str::to_owned),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".to_string(),
        })
        .unwrap();
    (db, org.id, db_file)
}

#[tokio::test]
async fn unresolved_group_reviews_drop_prs_missing_from_the_complete_active_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-1", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.reviewerId", "me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "count": 0, "value": [] })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "count": 1, "value": [pr_json(1)] })),
        )
        .mount(&server)
        .await;

    let (db, org_id, _file) = new_db(Some("me"));
    // 1 is still active (maybe a group review); 2 was completed upstream.
    db.replace_review_pull_requests(&org_id, &[review_row(&org_id, 1), review_row(&org_id, 2)])
        .unwrap();
    let org = db.resolve_organization(Some(&org_id)).unwrap();

    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);
    let projects = client.list_projects().await.unwrap();
    let budget: SyncBudget = Arc::new(Semaphore::new(8));
    let result = do_sync_prs(&db, &client, &org, &projects, &budget, true)
        .await
        .unwrap();

    // The membership lookup is not mocked, so group reviews stay unresolved.
    assert!(result.warning.unwrap().contains("could not be resolved"));
    let ids: Vec<i64> = db
        .list_review_pull_requests(&org_id)
        .unwrap()
        .into_iter()
        .map(|pr| pr.pull_request_id)
        .collect();
    assert_eq!(ids, [1]);
}

#[test]
fn a_closed_pr_leaves_every_cached_grid() {
    let (db, org_id, _file) = new_db(Some("me"));
    let pr = |id: i64| CachedPr {
        org_id: org_id.clone(),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id: id,
        title: format!("PR {id}"),
        status: "active".to_string(),
        created_by: None,
        created_by_id: Some("me".to_string()),
        creation_date: "2026-06-09T00:00:00Z".to_string(),
        source_ref_name: "feature".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    };
    db.replace_pull_requests_for_projects(&org_id, &["project-1"], &[pr(1), pr(2)])
        .unwrap();
    db.replace_review_pull_requests(&org_id, &[review_row(&org_id, 1), review_row(&org_id, 2)])
        .unwrap();
    let count = |id| PrReviewerCount {
        repository_id: "repo-1".to_string(),
        pull_request_id: id,
        approvals: 1,
        reviewer_count: 1,
    };
    db.save_pr_reviewer_counts(&org_id, &[count(1), count(2)])
        .unwrap();

    db.forget_closed_pull_request(&org_id, "repo-1", 2).unwrap();

    let active: Vec<i64> = db
        .search_pull_requests(&org_id, None, None, None)
        .unwrap()
        .into_iter()
        .map(|pr| pr.pull_request_id)
        .collect();
    assert_eq!(active, [1]);
    let created: Vec<i64> = db
        .list_created_pull_requests(&org_id, "me")
        .unwrap()
        .into_iter()
        .map(|row| row.pr.pull_request_id)
        .collect();
    assert_eq!(created, [1]);
    let reviews: Vec<i64> = db
        .list_review_pull_requests(&org_id)
        .unwrap()
        .into_iter()
        .map(|pr| pr.pull_request_id)
        .collect();
    assert_eq!(reviews, [1]);
}
