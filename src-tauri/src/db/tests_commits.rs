use rusqlite::params;
use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn make_cached_commit(commit_id: &str, comment: &str) -> CachedCommit {
    CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "Project One".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "repo-one".to_string(),
        commit_id: commit_id.to_string(),
        comment: comment.to_string(),
        author_name: Some("Alice".to_string()),
        author_email: None,
        author_date: Some("2026-06-01T00:00:00Z".to_string()),
        author_image_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: None,
        web_url: None,
    }
}

#[test]
fn replace_commits_skips_unchanged_rows_and_deletes_stale() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            make_cached_commit("aaa111", "refactor auth middleware"),
            make_cached_commit("bbb222", "tune retry delays"),
        ],
    )
    .unwrap();

    let conn = db.open().unwrap();
    let rowid_query = "SELECT rowid FROM commits WHERE org_id = 'org1' AND commit_id = 'aaa111'";
    let rowid_before: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();

    // Next sync window: aaa111 unchanged, bbb222 gone, ccc333 new.
    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            make_cached_commit("aaa111", "refactor auth middleware"),
            make_cached_commit("ccc333", "add palette search"),
        ],
    )
    .unwrap();

    let rowid_after: i64 = conn.query_row(rowid_query, [], |row| row.get(0)).unwrap();
    assert_eq!(
        rowid_before, rowid_after,
        "unchanged rows must not be rewritten"
    );
    assert!(search_commits_fts(&conn, "org1", "retry", None)
        .unwrap()
        .is_empty());
    let results = search_commits_fts(&conn, "org1", "palette", None).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].commit_id, "ccc333");
}

#[test]
fn commits_fts_roundtrip() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();

    conn.execute(
        r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        params!["org1", "p1", "Proj", "repo1", "Repo", "abc123", "refactor auth middleware"],
    )
    .unwrap();

    let results = search_commits_fts(&conn, "org1", "auth", None).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].commit_id, "abc123");

    // Re-upsert same PK: FTS must not duplicate
    conn.execute(
        r#"INSERT OR REPLACE INTO commits(org_id, project_id, project_name, repository_id, repository_name, commit_id, comment)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        params!["org1", "p1", "Proj", "repo1", "Repo", "abc123", "refactor auth and session middleware"],
    )
    .unwrap();

    let fts_count: i64 = conn
        .query_row("SELECT count(*) FROM commits_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fts_count, 1);

    let results = search_commits_fts(&conn, "org1", "session", None).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].comment, "refactor auth and session middleware");
}

#[test]
fn search_commits_author_filter_survives_limit_cap() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    // 600 commits ordered newest-first. The single commit by the target
    // author is the oldest, so it sorts past the LIMIT 500 cap. An
    // in-memory author filter would drop it; the SQL filter must keep it.
    let mut commits = Vec::new();
    for i in 0..600 {
        let is_target = i == 599;
        let year = 2000 + (599 - i); // larger i => older date
        commits.push(CachedCommit {
            org_id: "org1".to_string(),
            project_id: "p1".to_string(),
            project_name: "P1".to_string(),
            repository_id: "repo1".to_string(),
            repository_name: "Repo1".to_string(),
            commit_id: format!("c{i}"),
            comment: "msg".to_string(),
            author_name: Some(if is_target {
                "Grace Hopper".to_string()
            } else {
                "Someone Else".to_string()
            }),
            author_email: Some(if is_target {
                "grace@example.com".to_string()
            } else {
                "other@example.com".to_string()
            }),
            author_date: Some(format!("{year:04}-01-01T00:00:00+00:00")),
            author_image_url: None,
            committer_name: None,
            committer_email: None,
            committer_date: None,
            web_url: None,
        });
    }
    db.replace_commits_for_repo("org1", "repo1", &commits)
        .unwrap();

    // Substring, case-insensitive, matches on name.
    let by_name = db
        .search_commits("org1", None, Some("grace"), None, None)
        .unwrap();
    assert_eq!(by_name.len(), 1);
    assert_eq!(by_name[0].commit_id, "c599");

    // Also matches on email.
    let by_email = db
        .search_commits("org1", None, Some("grace@example"), None, None)
        .unwrap();
    assert_eq!(by_email.len(), 1);
    assert_eq!(by_email[0].commit_id, "c599");

    // No filter still hits the cap.
    let all = db.search_commits("org1", None, None, None, None).unwrap();
    assert_eq!(all.len(), 500);
}

#[test]
fn replace_commits_for_repo_scopes_to_repository() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make_commit = |repo_id: &str, commit_id: &str| CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        repository_id: repo_id.to_string(),
        repository_name: repo_id.to_string(),
        commit_id: commit_id.to_string(),
        comment: "msg".to_string(),
        author_name: None,
        author_email: None,
        author_date: None,
        author_image_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: None,
        web_url: None,
    };

    // Seed both repos
    db.replace_commits_for_repo("org1", "repoA", &[make_commit("repoA", "a1")])
        .unwrap();
    db.replace_commits_for_repo("org1", "repoB", &[make_commit("repoB", "b1")])
        .unwrap();

    // Replace repoA only
    db.replace_commits_for_repo("org1", "repoA", &[make_commit("repoA", "a2")])
        .unwrap();

    let a = db
        .search_commits("org1", Some(&["repoA".to_string()]), None, None, None)
        .unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].commit_id, "a2", "repoA should contain only a2");

    let b = db
        .search_commits("org1", Some(&["repoB".to_string()]), None, None, None)
        .unwrap();
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].commit_id, "b1", "repoB should be untouched");
}

#[test]
fn purge_old_commits_removes_dated_rows_only() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make_commit_dated = |commit_id: &str, date: Option<&str>| CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo1".to_string(),
        commit_id: commit_id.to_string(),
        comment: "msg".to_string(),
        author_name: None,
        author_email: None,
        author_date: date.map(|s| s.to_string()),
        author_image_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: None,
        web_url: None,
    };

    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            make_commit_dated("old", Some("2020-01-01T00:00:00+00:00")),
            make_commit_dated("new", Some("2030-01-01T00:00:00+00:00")),
        ],
    )
    .unwrap();

    db.purge_old_commits("org1", "2025-01-01T00:00:00+00:00")
        .unwrap();

    let remaining = db.search_commits("org1", None, None, None, None).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].commit_id, "new");
}

#[test]
fn purge_old_commits_removes_null_author_date() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make_commit_dated = |commit_id: &str, date: Option<&str>| CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo1".to_string(),
        commit_id: commit_id.to_string(),
        comment: "msg".to_string(),
        author_name: None,
        author_email: None,
        author_date: date.map(|s| s.to_string()),
        author_image_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: None,
        web_url: None,
    };

    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            make_commit_dated("undated", None),
            make_commit_dated("new", Some("2030-01-01T00:00:00+00:00")),
        ],
    )
    .unwrap();

    db.purge_old_commits("org1", "2025-01-01T00:00:00+00:00")
        .unwrap();

    // A NULL author_date means the date is unknown; treat it as old and
    // purge it so such commits do not linger forever.
    let remaining = db.search_commits("org1", None, None, None, None).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].commit_id, "new");
}

#[test]
fn commit_activity_groups_by_day_and_filters_by_author() {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let make = |commit_id: &str, date: Option<&str>, name: &str, email: &str| CachedCommit {
        org_id: "org1".to_string(),
        project_id: "p1".to_string(),
        project_name: "P1".to_string(),
        repository_id: "repo1".to_string(),
        repository_name: "Repo1".to_string(),
        commit_id: commit_id.to_string(),
        comment: "msg".to_string(),
        author_name: Some(name.to_string()),
        author_email: Some(email.to_string()),
        author_date: date.map(|s| s.to_string()),
        author_image_url: None,
        committer_name: None,
        committer_email: None,
        committer_date: None,
        web_url: None,
    };

    db.replace_commits_for_repo(
        "org1",
        "repo1",
        &[
            make(
                "a",
                Some("2026-05-01T08:00:00+00:00"),
                "Alice",
                "alice@x.com",
            ),
            make(
                "b",
                Some("2026-05-01T20:00:00+00:00"),
                "Alice",
                "alice@x.com",
            ),
            make("c", Some("2026-05-02T08:00:00+00:00"), "Bob", "bob@x.com"),
            make("d", None, "Alice", "alice@x.com"),
        ],
    )
    .unwrap();

    // All authors: two commits on 05-01, one on 05-02. NULL date is skipped.
    let all = db
        .commit_activity("org1", None, None, None, None, None)
        .unwrap();
    assert_eq!(
        all,
        vec![("2026-05-01".to_string(), 2), ("2026-05-02".to_string(), 1),]
    );

    // Author substring filter (case-insensitive) narrows to Alice's days.
    let alice = db
        .commit_activity("org1", None, None, Some("ALICE"), None, None)
        .unwrap();
    assert_eq!(alice, vec![("2026-05-01".to_string(), 2)]);

    // Date range filter clamps the window.
    let ranged = db
        .commit_activity(
            "org1",
            None,
            None,
            None,
            Some("2026-05-02T00:00:00+00:00"),
            None,
        )
        .unwrap();
    assert_eq!(ranged, vec![("2026-05-02".to_string(), 1)]);
}

#[test]
fn commit_prs_cache_round_trips_and_respects_freshness() {
    let db_file = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(make_org_draft("org1")).unwrap();

    let pr = CachedCommitPr {
        pull_request_id: 7,
        pr_repository_id: "repo1".to_string(),
        title: "Land the fix".to_string(),
        status: "completed".to_string(),
        my_vote: 10,
        my_vote_label: "Approved".to_string(),
        web_url: Some("https://example/pr/7".to_string()),
    };
    db.replace_commit_prs("org1", "repo1", "sha1", &[pr])
        .unwrap();

    // A miss with a future freshness bound forces a refresh (None).
    let future = "2999-01-01T00:00:00+00:00";
    assert!(db
        .get_cached_commit_prs("org1", "repo1", "sha1", future)
        .unwrap()
        .is_none());

    // Cached and still fresh: returns the stored row.
    let past = "2000-01-01T00:00:00+00:00";
    let cached = db
        .get_cached_commit_prs("org1", "repo1", "sha1", past)
        .unwrap()
        .expect("cached");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].pull_request_id, 7);
    assert_eq!(cached[0].my_vote_label, "Approved");

    // An unknown commit is None, not an empty Vec.
    assert!(db
        .get_cached_commit_prs("org1", "repo1", "unknown", past)
        .unwrap()
        .is_none());

    // "No related PRs" is cached as an empty Vec, distinct from None.
    db.replace_commit_prs("org1", "repo1", "sha1", &[]).unwrap();
    let empty = db
        .get_cached_commit_prs("org1", "repo1", "sha1", past)
        .unwrap()
        .expect("empty marker cached");
    assert!(empty.is_empty());
}
