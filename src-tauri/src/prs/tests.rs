use std::collections::HashSet;
use std::sync::Arc;

use azdo_client::{
    AdoClient, AdoError, GitThread, GitThreadComment, IdentityRef, IdentityRefWithVote,
    PatProvider, PullRequestStatus,
};
use serde_json::json;
use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::db::{AppDatabase, CachedPr, OrganizationDraft};
use crate::sync::SyncBudget;

fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
    GitThreadComment {
        id,
        parent_comment_id: None,
        content: Some(content.into()),
        comment_type: Some("text".into()),
        author: Some(IdentityRef {
            id: Some(author_id.into()),
            display_name: Some(author_id.into()),
            unique_name: None,
        }),
        published_date: None,
        is_deleted: false,
    }
}

fn thread(id: i64, comments: Vec<GitThreadComment>) -> GitThread {
    GitThread {
        id,
        status: Some("active".into()),
        is_deleted: false,
        comments: Some(comments),
        thread_context: None,
    }
}

#[test]
fn comment_items_suppressed_on_first_observation() {
    let threads = vec![thread(
        1,
        vec![comment(10, "me", "q"), comment(11, "other", "a")],
    )];
    let (hits, max) = pr_comment_notification_items(&threads, Some("me"), None);
    assert!(hits.is_empty());
    assert_eq!(max, Some(11));
}

#[test]
fn comment_items_detects_reply_to_my_thread() {
    let threads = vec![thread(
        1,
        vec![comment(10, "me", "q"), comment(12, "other", "a")],
    )];
    let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(11));
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].author.as_deref(), Some("other"));
    assert_eq!(max, Some(12));
}

#[test]
fn comment_items_detects_mention_without_my_thread() {
    let threads = vec![thread(
        1,
        vec![comment(20, "other", "hello @<me-guid> please")],
    )];
    let (hits, _max) = pr_comment_notification_items(&threads, Some("me-guid"), Some(0));
    assert_eq!(hits.len(), 1);
}

#[test]
fn comment_items_ignores_my_own_and_seen() {
    let threads = vec![thread(
        1,
        vec![comment(30, "me", "note"), comment(31, "other", "unrelated")],
    )];
    let (hits, _max) = pr_comment_notification_items(&threads, Some("me"), Some(31));
    assert!(hits.is_empty());
}

#[test]
fn comment_items_ignores_unrelated_thread() {
    let threads = vec![thread(
        1,
        vec![comment(40, "alice", "hi"), comment(41, "bob", "yo")],
    )];
    let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(0));
    assert!(hits.is_empty());
    assert_eq!(max, Some(41));
}

#[tokio::test]
async fn pr_sync_skips_failing_project_and_preserves_its_cache() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 2,
            "value": [
                { "id": "project-ok", "name": "Platform" },
                { "id": "project-bad", "name": "Broken" }
            ]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-ok/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "pullRequestId": 1,
                "title": "Fresh PR",
                "status": "active",
                "creationDate": "2026-06-09T00:00:00Z",
                "repository": {
                    "id": "repo-ok",
                    "name": "Good Repo",
                    "project": { "id": "project-ok", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/feature",
                "targetRefName": "refs/heads/main"
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-bad/_apis/git/pullrequests"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;

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
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
        })
        .unwrap();
    // Pre-existing cached PRs: one in the project that is about to fail
    // (must survive) and one in the healthy project (must be replaced).
    db.replace_pull_requests_for_projects(
        &org.id,
        &["project-bad", "project-ok"],
        &[
            CachedPr {
                org_id: org.id.clone(),
                project_id: "project-bad".to_string(),
                project_name: "Broken".to_string(),
                repository_id: "repo-bad".to_string(),
                repository_name: "Bad Repo".to_string(),
                pull_request_id: 99,
                title: "Stale but preserved".to_string(),
                status: "active".to_string(),
                created_by: None,
                creation_date: "2026-06-01T00:00:00Z".to_string(),
                source_ref_name: "feature".to_string(),
                target_ref_name: "main".to_string(),
                web_url: None,
                is_draft: false,
            },
            CachedPr {
                org_id: org.id.clone(),
                project_id: "project-ok".to_string(),
                project_name: "Platform".to_string(),
                repository_id: "repo-ok".to_string(),
                repository_name: "Good Repo".to_string(),
                pull_request_id: 98,
                title: "Closed since last sync".to_string(),
                status: "active".to_string(),
                created_by: None,
                creation_date: "2026-06-01T00:00:00Z".to_string(),
                source_ref_name: "feature".to_string(),
                target_ref_name: "main".to_string(),
                web_url: None,
                is_draft: false,
            },
        ],
    )
    .unwrap();

    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url);

    let projects = client.list_projects().await.unwrap();
    let budget: SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let result = do_sync_prs(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let cached = db.search_pull_requests(&org.id, None, None, None).unwrap();
    let titles: Vec<&str> = cached.iter().map(|pr| pr.title.as_str()).collect();
    assert!(titles.contains(&"Fresh PR"));
    assert!(titles.contains(&"Stale but preserved"));
    // The healthy project was fully replaced, so its stale row is gone.
    assert!(!titles.contains(&"Closed since last sync"));
    assert!(result
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("Broken")));
}

#[test]
fn normalize_optional_trims_and_rejects_blank() {
    assert_eq!(
        normalize_optional(Some(" project-1 ".to_string())),
        Some("project-1".to_string())
    );
    assert_eq!(normalize_optional(Some("all".to_string())), None);
    assert_eq!(normalize_optional(Some(" ".to_string())), None);
    assert_eq!(normalize_optional(None), None);
}

#[test]
fn parse_search_statuses_routes_active_to_cache_and_others_live() {
    // Nothing selected defaults to the cached active path.
    assert!(matches!(
        parse_search_statuses(None).as_deref().unwrap(),
        [SearchStatus::CachedActive]
    ));
    assert!(matches!(
        parse_search_statuses(Some(&[])).as_deref().unwrap(),
        [SearchStatus::CachedActive]
    ));

    let owned = [" Active ".to_string(), "completed".to_string()];
    assert!(matches!(
        parse_search_statuses(Some(&owned)).as_deref().unwrap(),
        [
            SearchStatus::CachedActive,
            SearchStatus::Live(PullRequestStatus::Completed)
        ]
    ));

    // Duplicates collapse to a single entry.
    let dupes = ["active".to_string(), "Active".to_string()];
    assert_eq!(
        parse_search_statuses(Some(&dupes)).unwrap().len(),
        1,
        "duplicate statuses should be de-duplicated"
    );

    let abandoned = ["abandoned".to_string()];
    assert!(matches!(
        parse_search_statuses(Some(&abandoned)).as_deref().unwrap(),
        [SearchStatus::Live(PullRequestStatus::Abandoned)]
    ));

    let bad = ["draft".to_string()];
    assert!(parse_search_statuses(Some(&bad)).is_err());
}

#[test]
fn normalize_set_drops_blanks_and_empty() {
    assert_eq!(normalize_set(None), None);
    assert_eq!(normalize_set(Some(vec![" ".to_string()])), None);
    assert_eq!(
        normalize_set(Some(vec![" repo-1 ".to_string(), "".to_string()])),
        Some(HashSet::from(["repo-1".to_string()]))
    );
}

#[test]
fn parse_date_bound_spans_start_and_end_of_day() {
    let from = parse_date_bound(Some("2026-05-01"), false)
        .unwrap()
        .unwrap();
    let to = parse_date_bound(Some(" 2026-05-31 "), true)
        .unwrap()
        .unwrap();
    assert!(from.starts_with("2026-05-01T00:00:00"));
    assert!(to.starts_with("2026-05-31T23:59:59"));
    assert_eq!(parse_date_bound(None, false).unwrap(), None);
    assert_eq!(parse_date_bound(Some("  "), false).unwrap(), None);
    assert!(parse_date_bound(Some("not-a-date"), false).is_err());
}

#[test]
fn within_window_is_inclusive_and_open_ended() {
    assert!(within_window("2026-05-10T00:00:00+00:00", None, None));
    assert!(within_window(
        "2026-05-10T00:00:00+00:00",
        Some("2026-05-01T00:00:00+00:00"),
        Some("2026-05-31T23:59:59+00:00"),
    ));
    assert!(!within_window(
        "2026-04-30T00:00:00+00:00",
        Some("2026-05-01T00:00:00+00:00"),
        None,
    ));
    assert!(!within_window(
        "2026-06-01T00:00:00+00:00",
        None,
        Some("2026-05-31T23:59:59+00:00"),
    ));
}

#[test]
fn parse_date_basis_and_sort_by_default_and_match() {
    assert!(matches!(parse_date_basis(None), DateBasis::Created));
    assert!(matches!(
        parse_date_basis(Some("closed")),
        DateBasis::Closed
    ));
    assert_eq!(DateBasis::Closed.query_value(), "closed");
    assert!(matches!(parse_sort_by(None), SortBy::Created));
    assert!(matches!(parse_sort_by(Some("closed")), SortBy::Closed));
    assert!(matches!(parse_sort_by(Some("title")), SortBy::Title));
    assert!(matches!(parse_sort_by(Some("bogus")), SortBy::Created));
}

#[test]
fn sort_summaries_orders_by_close_then_title() {
    let make = |id: i64, title: &str, created: &str, closed: Option<&str>| PullRequestSummary {
        organization_id: "o".into(),
        project_id: "p".into(),
        project_name: "P".into(),
        repository_id: "r".into(),
        repository_name: "R".into(),
        pull_request_id: id,
        title: title.into(),
        status: "completed".into(),
        created_by: None,
        creation_date: created.into(),
        closed_date: closed.map(str::to_string),
        source_ref_name: "f".into(),
        target_ref_name: "main".into(),
        web_url: None,
        is_draft: false,
    };
    let mut rows = vec![
        make(
            1,
            "banana",
            "2026-05-01T00:00:00Z",
            Some("2026-05-10T00:00:00Z"),
        ),
        make(2, "apple", "2026-05-02T00:00:00Z", None),
        make(
            3,
            "cherry",
            "2026-05-03T00:00:00Z",
            Some("2026-05-20T00:00:00Z"),
        ),
    ];

    sort_summaries(&mut rows, SortBy::Closed);
    // Most recent close first; the PR with no close date sorts last.
    assert_eq!(
        rows.iter().map(|r| r.pull_request_id).collect::<Vec<_>>(),
        vec![3, 1, 2]
    );

    sort_summaries(&mut rows, SortBy::Title);
    assert_eq!(
        rows.iter().map(|r| r.title.clone()).collect::<Vec<_>>(),
        vec!["apple", "banana", "cherry"]
    );
}

#[test]
fn short_ref_removes_heads_prefix() {
    assert_eq!(short_ref("refs/heads/feature/prs"), "feature/prs");
    assert_eq!(short_ref("refs/tags/v1"), "refs/tags/v1");
}

fn reviewer(id: &str, vote: i32, is_required: bool) -> IdentityRefWithVote {
    IdentityRefWithVote {
        id: Some(id.to_string()),
        display_name: None,
        unique_name: None,
        vote,
        is_required,
        voted_for: None,
    }
}

#[test]
fn resolve_reviewer_vote_prefers_direct_reviewer() {
    let reviewers = vec![reviewer("me", 10, true), reviewer("other", -10, false)];
    assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (10, true));
}

#[test]
fn resolve_reviewer_vote_uses_group_rollup_when_not_direct() {
    // The user is not a direct reviewer; they voted via a required group whose
    // votedFor rolls up the member vote.
    let mut group = reviewer("team-guid", 0, true);
    group.voted_for = Some(vec![reviewer("me", 5, false)]);
    let reviewers = vec![reviewer("other", -10, false), group];
    // Member's vote, but the group's required flag.
    assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (5, true));
}

#[test]
fn resolve_reviewer_vote_defaults_when_absent() {
    let reviewers = vec![reviewer("other", -10, true)];
    assert_eq!(resolve_reviewer_vote(&reviewers, "me"), (0, false));
}

#[test]
fn matches_query_checks_title_repo_author_and_branches() {
    let summary = PullRequestSummary {
        organization_id: "contoso".to_string(),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "azdo-dashboard".to_string(),
        pull_request_id: 42,
        title: "Add pull request search".to_string(),
        status: "active".to_string(),
        created_by: Some("Test User".to_string()),
        creation_date: "2026-05-24T00:00:00Z".to_string(),
        closed_date: None,
        source_ref_name: "feature/pr-search".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    };

    assert!(matches_query(&summary, "dashboard"));
    assert!(matches_query(&summary, "test user"));
    assert!(matches_query(&summary, "pr-search"));
    assert!(!matches_query(&summary, "work item"));
}

#[test]
fn matches_query_matches_pr_number_by_prefix() {
    let summary = PullRequestSummary {
        organization_id: "contoso".to_string(),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "azdo-dashboard".to_string(),
        pull_request_id: 421,
        title: "Add pull request search".to_string(),
        status: "active".to_string(),
        created_by: Some("Test User".to_string()),
        creation_date: "2026-05-24T00:00:00Z".to_string(),
        closed_date: None,
        source_ref_name: "feature/pr-search".to_string(),
        target_ref_name: "main".to_string(),
        web_url: None,
        is_draft: false,
    };

    assert!(matches_query(&summary, "421"));
    assert!(matches_query(&summary, "42"));
    assert!(!matches_query(&summary, "21"));
}

#[test]
fn is_ado_not_found_only_matches_404_api_errors() {
    assert!(is_ado_not_found(&AdoError::api(
        404,
        "not found".to_string()
    )));
    assert!(!is_ado_not_found(&AdoError::api(
        500,
        "server error".to_string()
    )));
    assert!(!is_ado_not_found(&AdoError::Unauthorized));
}
