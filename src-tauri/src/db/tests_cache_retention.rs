//! What the cache keeps across sync passes: CI verdicts that were not refetched.

use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn open_db() -> (AppDatabase, NamedTempFile) {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();
    (db, tf)
}

fn review_pr(ci_status: Option<&str>) -> CachedReviewPr {
    CachedReviewPr {
        org_id: "org1".to_string(),
        project_id: "project".to_string(),
        project_name: "Project".to_string(),
        repository_id: "repo".to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id: 1,
        title: "Title".to_string(),
        created_by: None,
        creation_date: "2026-06-19T09:00:00Z".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        my_vote: 0,
        my_vote_label: "No vote".to_string(),
        my_is_required: false,
        is_draft: false,
        merge_status: None,
        ci_status: ci_status.map(ToString::to_string),
        ci_context: ci_status.map(|_| "build".to_string()),
        ci_check_count: if ci_status.is_some() { 2 } else { 0 },
    }
}

#[test]
fn an_unfetched_ci_verdict_keeps_the_previous_one() {
    let (db, _tf) = open_db();
    db.replace_review_pull_requests("org1", &[review_pr(Some("failed"))])
        .unwrap();

    db.replace_review_pull_requests_for_projects("org1", &["project"], &[review_pr(None)])
        .unwrap();
    let row = db.list_review_pull_requests("org1").unwrap().remove(0);
    assert_eq!(row.ci_status.as_deref(), Some("failed"));
    assert_eq!(row.ci_context.as_deref(), Some("build"));
    assert_eq!(row.ci_check_count, 2);

    db.replace_review_pull_requests_for_projects(
        "org1",
        &["project"],
        &[review_pr(Some("succeeded"))],
    )
    .unwrap();
    let row = db.list_review_pull_requests("org1").unwrap().remove(0);
    assert_eq!(row.ci_status.as_deref(), Some("succeeded"));
}
