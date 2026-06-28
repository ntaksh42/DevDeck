use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn make_review_pr(org_id: &str, repository_id: &str, pull_request_id: i64) -> CachedReviewPr {
    CachedReviewPr {
        org_id: org_id.to_string(),
        project_id: "project".to_string(),
        project_name: "Project".to_string(),
        repository_id: repository_id.to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id,
        title: "Title".to_string(),
        created_by: None,
        creation_date: "2026-06-19T09:00:00Z".to_string(),
        target_ref_name: "refs/heads/main".to_string(),
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

#[test]
fn update_review_pr_vote_updates_cached_row() {
    let db_file = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    {
        let conn = db.open().unwrap();
        upsert_organization(&conn, make_org_draft("org")).unwrap();
    }
    db.replace_review_pull_requests("org", &[make_review_pr("org", "repo", 42)])
        .unwrap();

    let updated = db
        .update_review_pr_vote("org", "repo", 42, 10, "Approved")
        .unwrap();
    assert_eq!(updated, 1, "matching cached row should be updated");

    let rows = db.list_review_pull_requests("org").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].my_vote, 10);
    assert_eq!(rows[0].my_vote_label, "Approved");
}

#[test]
fn update_review_pr_vote_reports_zero_when_pr_absent() {
    let db_file = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    {
        let conn = db.open().unwrap();
        upsert_organization(&conn, make_org_draft("org")).unwrap();
    }

    // PR was opened from search or a direct URL, so no My Reviews row exists.
    let updated = db
        .update_review_pr_vote("org", "repo", 999, 10, "Approved")
        .unwrap();
    assert_eq!(updated, 0, "missing cached row should report zero updates");
}

#[test]
fn pull_requests_search() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let pr = CachedPr {
        org_id: "org1".to_string(),
        project_id: "proj1".to_string(),
        project_name: "Project One".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo One".to_string(),
        pull_request_id: 1,
        title: "Add feature X".to_string(),
        status: "active".to_string(),
        created_by: Some("Alice".to_string()),
        creation_date: "2024-01-01T00:00:00Z".to_string(),
        source_ref_name: "refs/heads/feature".to_string(),
        target_ref_name: "refs/heads/main".to_string(),
        web_url: None,
        is_draft: false,
    };
    db.replace_pull_requests_for_projects("org1", &["p1"], &[pr])
        .unwrap();

    let results = db
        .search_pull_requests("org1", None, None, Some("active"))
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].pull_request_id, 1);

    let no_results = db
        .search_pull_requests("org1", None, None, Some("completed"))
        .unwrap();
    assert!(no_results.is_empty());
}
