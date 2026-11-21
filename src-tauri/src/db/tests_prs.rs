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
        created_by_id: None,
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

fn cached_pr(id: i64, creator: &str, status: &str) -> CachedPr {
    CachedPr {
        org_id: "org1".to_string(),
        project_id: "proj1".to_string(),
        project_name: "Project One".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo One".to_string(),
        pull_request_id: id,
        title: format!("PR {id}"),
        status: status.to_string(),
        created_by: Some("Alice".to_string()),
        created_by_id: Some(creator.to_string()),
        creation_date: format!("2024-01-0{id}T00:00:00Z"),
        source_ref_name: "feature".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    }
}

#[test]
fn created_pull_requests_are_the_users_active_prs_with_their_approvals() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();
    db.replace_pull_requests_for_projects(
        "org1",
        &["proj1"],
        &[
            cached_pr(1, "ME-ID", "active"),
            cached_pr(2, "me-id", "active"),
            cached_pr(3, "other", "active"),
            cached_pr(4, "me-id", "completed"),
        ],
    )
    .unwrap();
    let counts = |approvals| PrReviewerCount {
        repository_id: "repo1".to_string(),
        pull_request_id: 2,
        approvals,
        reviewer_count: 3,
    };
    db.save_pr_reviewer_counts("org1", &[counts(2)]).unwrap();

    let rows = db.list_created_pull_requests("org1", "me-id").unwrap();
    let ids: Vec<i64> = rows.iter().map(|row| row.pr.pull_request_id).collect();
    // Newest first; the identity matches case-insensitively; others' and closed PRs stay out.
    assert_eq!(ids, [2, 1]);
    assert_eq!((rows[0].approvals, rows[0].reviewer_count), (2, 3));
    // A PR whose tally was never saved reads as 0 of 0.
    assert_eq!((rows[1].approvals, rows[1].reviewer_count), (0, 0));

    // Tallies of PRs that left the cache are dropped.
    db.replace_pull_requests_for_projects("org1", &["proj1"], &[cached_pr(1, "me-id", "active")])
        .unwrap();
    db.save_pr_reviewer_counts("org1", &[]).unwrap();
    let conn = db.open().unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM pr_reviewer_counts", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(left, 0);
}
