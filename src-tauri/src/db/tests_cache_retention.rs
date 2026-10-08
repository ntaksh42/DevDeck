//! What the cache keeps across sync passes: CI verdicts that were not refetched,
//! commits whose commit date is inside the window, and commit -> PR lookups.

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

fn commit(id: &str, author_date: Option<&str>, committer_date: Option<&str>) -> CachedCommit {
    CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo1".to_string(),
        commit_id: id.to_string(),
        comment: "msg".to_string(),
        author_name: None,
        author_email: None,
        author_date: author_date.map(ToString::to_string),
        web_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: committer_date.map(ToString::to_string),
    }
}

#[test]
fn purge_uses_the_commit_date_the_sync_window_filters_on() {
    let (db, _tf) = open_db();
    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            // Authored long ago but rebased into the window: kept.
            commit(
                "rebased",
                Some("2020-01-01T00:00:00+00:00"),
                Some("2030-01-01T00:00:00+00:00"),
            ),
            commit(
                "old",
                Some("2020-01-01T00:00:00+00:00"),
                Some("2020-01-02T00:00:00+00:00"),
            ),
            // No committer date: falls back to the author date.
            commit("author-only", Some("2030-01-01T00:00:00+00:00"), None),
        ],
    )
    .unwrap();

    db.purge_old_commits("org1", "2025-01-01T00:00:00+00:00")
        .unwrap();

    let mut remaining: Vec<String> = db
        .search_commits("org1", None, None, None, None)
        .unwrap()
        .into_iter()
        .map(|c| c.commit_id)
        .collect();
    remaining.sort();
    assert_eq!(remaining, vec!["author-only", "rebased"]);
}

#[test]
fn purge_drops_commit_pr_lookups_older_than_the_window() {
    let (db, _tf) = open_db();
    db.replace_commit_prs_many(
        "org1",
        "repo1",
        &[
            ("c1".to_string(), Vec::new()),
            ("c2".to_string(), Vec::new()),
        ],
    )
    .unwrap();
    let all = ["c1".to_string(), "c2".to_string()];
    assert_eq!(
        db.get_cached_commit_prs_many("org1", "repo1", &all, "2000-01-01T00:00:00+00:00")
            .unwrap()
            .len(),
        2
    );

    // Everything was fetched "now", so a purge boundary in the future drops it.
    db.purge_old_commits("org1", "2999-01-01T00:00:00+00:00")
        .unwrap();
    assert!(db
        .get_cached_commit_prs_many("org1", "repo1", &all, "2000-01-01T00:00:00+00:00")
        .unwrap()
        .is_empty());
}
