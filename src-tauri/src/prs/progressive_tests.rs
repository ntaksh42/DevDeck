use super::*;
use crate::{
    db::{AppDatabase, OrganizationDraft},
    secrets::SecretStore,
};
use azdo_client::PatProvider;
use serde_json::{json, Value};
use std::sync::atomic::AtomicUsize;
use url::Url;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, Request, Respond, ResponseTemplate,
};

fn input() -> SearchPullRequestsInput {
    SearchPullRequestsInput {
        progressive: Some(true),
        search_id: Some("search-1".into()),
        statuses: Some(vec!["completed".into()]),
        ..Default::default()
    }
}
fn pr(id: i64, title: &str) -> Value {
    json!({ "pullRequestId": id, "title": title, "status": "completed", "creationDate": "2026-01-10T00:00:00Z",
        "closedDate": "2026-01-11T00:00:00Z", "sourceRefName": "refs/heads/fix/bug", "targetRefName": "refs/heads/main",
        "createdBy": {"id":"author", "displayName":"Alex"},
        "repository": {"id":"repo", "name":"Portal", "project":{"id":"p","name":"Platform"}} })
}
fn response(value: Vec<Value>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({"value": value}))
}
fn skip(request: &Request) -> usize {
    request
        .url
        .query_pairs()
        .find(|(k, _)| k == "$skip")
        .unwrap()
        .1
        .parse()
        .unwrap()
}
async fn fixture() -> (
    tempfile::NamedTempFile,
    PullRequestService,
    Organization,
    MockServer,
    AdoClient,
) {
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(file.path().into());
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            id: "org".into(),
            name: "org".into(),
            display_name: None,
            base_url: "https://dev.azure.com/org".into(),
            auth_provider: "pat".into(),
            credential_key: "test-only-not-stored".into(),
            authenticated_user_id: Some("me-id".into()),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"p","name":"Platform"}]})),
        )
        .mount(&server)
        .await;
    let client = AdoClient::new("org", Arc::new(PatProvider::new("test")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
    (
        file,
        PullRequestService::new(db, SecretStore),
        org,
        server,
        client,
    )
}
async fn mount<R: Respond + 'static>(server: &MockServer, responder: R) {
    Mock::given(method("GET"))
        .and(path("/p/_apis/git/pullrequests"))
        .respond_with(responder)
        .mount(server)
        .await;
}
fn next(
    mut input: SearchPullRequestsInput,
    result: &PullRequestSearchResult,
) -> SearchPullRequestsInput {
    input.continuation_token = result.continuation_token.clone();
    input
}

#[tokio::test]
async fn finds_a_match_beyond_project_500_cap() {
    let (_file, service, org, server, client) = fixture().await;
    mount(&server, |r: &Request| {
        let from = skip(r);
        response(
            (from..(from + 200).min(601))
                .map(|i| pr(i as i64 + 1, if i == 600 { "needle" } else { "other" }))
                .collect(),
        )
    })
    .await;
    let mut input = input();
    input.query = Some("needle".into());
    let result = service
        .search_progressive_with_client(&client, &org, input)
        .await
        .unwrap();
    assert_eq!(result.pull_requests.len(), 1);
    assert_eq!(result.pull_requests[0].pull_request_id, 601);
    assert_eq!(result.scanned_count, Some(601));
    assert_eq!(result.search_complete, Some(true));
    let requests = server.received_requests().await.unwrap();
    assert!(requests
        .iter()
        .any(|r| r.url.query_pairs().any(|(k, v)| k == "$skip" && v == "600")));
}

#[tokio::test]
async fn short_pages_and_zero_matches_can_continue() {
    let (_file, service, org, server, client) = fixture().await;
    mount(&server, |r: &Request| {
        let n = skip(r);
        response(if n > 10 {
            vec![]
        } else {
            vec![pr(n as i64 + 1, if n == 10 { "needle" } else { "other" })]
        })
    })
    .await;
    let mut input = input();
    input.query = Some("needle".into());
    let first = service
        .search_progressive_with_client(&client, &org, input.clone())
        .await
        .unwrap();
    assert!(first.pull_requests.is_empty());
    assert_eq!(first.has_more, Some(true));
    assert_eq!(first.scanned_count, Some(10));
    let last = service
        .search_progressive_with_client(&client, &org, next(input, &first))
        .await
        .unwrap();
    assert_eq!(last.pull_requests[0].pull_request_id, 11);
    assert_eq!(last.search_complete, Some(true));
}

#[tokio::test]
async fn buffers_rows_deduplicates_and_advances_by_actual_page_size() {
    let (_file, service, org, server, client) = fixture().await;
    mount(&server, |r: &Request| {
        if skip(r) == 0 {
            let mut rows = (1..=150).map(|n| pr(n, "fix")).collect::<Vec<_>>();
            rows.push(pr(1, "fix"));
            response(rows)
        } else {
            assert_eq!(skip(r), 151);
            response(vec![])
        }
    })
    .await;
    let input = input();
    let first = service
        .search_progressive_with_client(&client, &org, input.clone())
        .await
        .unwrap();
    assert_eq!(first.pull_requests.len(), 100);
    assert_eq!(first.total, 100);
    assert_eq!(first.has_more, Some(true));
    let last = service
        .search_progressive_with_client(&client, &org, next(input, &first))
        .await
        .unwrap();
    assert_eq!(last.pull_requests.len(), 50);
    assert_eq!(last.total, 150);
    assert_eq!(last.search_complete, Some(true));
    assert_eq!(last.scanned_count, Some(151));
    let ids = first
        .pull_requests
        .iter()
        .chain(last.pull_requests.iter())
        .map(|p| p.pull_request_id)
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), 150);
}

#[tokio::test]
async fn failed_scopes_retry_without_losing_successful_progress() {
    let (_file, service, org, server, client) = fixture().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"value":[{"id":"p","name":"Platform"},{"id":"bad","name":"Broken"}]}),
        ))
        .with_priority(1)
        .mount(&server)
        .await;
    mount(&server, response(vec![])).await;
    let attempt = Arc::new(AtomicUsize::new(0));
    let counter = attempt.clone();
    Mock::given(method("GET"))
        .and(path("/bad/_apis/git/pullrequests"))
        .respond_with(move |r: &Request| {
            if counter.fetch_add(1, Ordering::Relaxed) == 0 {
                ResponseTemplate::new(403)
            } else if skip(r) == 0 {
                response(vec![pr(900, "fixed")])
            } else {
                response(vec![])
            }
        })
        .mount(&server)
        .await;
    let input = input();
    let first = service
        .search_progressive_with_client(&client, &org, input.clone())
        .await
        .unwrap();
    assert_eq!(first.has_more, Some(false));
    assert_eq!(first.search_complete, Some(false));
    assert_eq!(first.failed_scopes.as_ref().unwrap().len(), 1);
    let mut input = next(input, &first);
    input.retry_failed = Some(true);
    let last = service
        .search_progressive_with_client(&client, &org, input)
        .await
        .unwrap();
    assert_eq!(last.pull_requests[0].pull_request_id, 900);
    assert_eq!(last.search_complete, Some(true));
}

#[tokio::test]
async fn continuation_cannot_change_query_organization_or_reuse_old_token() {
    let (_file, service, org, server, client) = fixture().await;
    mount(&server, |r: &Request| {
        response(if skip(r) == 0 {
            (1..=200).map(|n| pr(n, "fix")).collect()
        } else {
            vec![]
        })
    })
    .await;
    let input = input();
    let first = service
        .search_progressive_with_client(&client, &org, input.clone())
        .await
        .unwrap();
    let mut changed = next(input.clone(), &first);
    changed.query = Some("other".into());
    assert!(service
        .search_progressive_with_client(&client, &org, changed)
        .await
        .is_err());
    let mut other = org.clone();
    other.id = "other".into();
    assert!(service
        .search_progressive_with_client(&client, &other, next(input.clone(), &first))
        .await
        .is_err());
    let continuation = next(input, &first);
    let _ = service
        .search_progressive_with_client(&client, &org, continuation.clone())
        .await
        .unwrap();
    assert!(service
        .search_progressive_with_client(&client, &org, continuation)
        .await
        .is_err());
}

#[tokio::test]
async fn stop_keeps_in_flight_page_and_can_resume() {
    let (_file, service, org, server, client) = fixture().await;
    mount(&server, |r: &Request| {
        if skip(r) == 0 {
            response(vec![pr(1, "fix")]).set_delay(Duration::from_millis(120))
        } else {
            response(vec![])
        }
    })
    .await;
    let input = input();
    let search = service.search_progressive_with_client(&client, &org, input.clone());
    let stop = async {
        tokio::time::sleep(Duration::from_millis(40)).await;
        service
            .stop_search(StopPullRequestSearchInput {
                organization_id: Some(org.id.clone()),
                search_id: "search-1".into(),
            })
            .await
            .unwrap();
    };
    let (first, _) = tokio::join!(search, stop);
    let first = first.unwrap();
    assert_eq!(first.pull_requests.len(), 1);
    assert_eq!(first.has_more, Some(true));
    let last = service
        .search_progressive_with_client(&client, &org, next(input, &first))
        .await
        .unwrap();
    assert_eq!(last.total, 1);
    assert_eq!(last.search_complete, Some(true));
}

#[tokio::test]
async fn expires_idle_search_and_rejects_invalid_text_before_http() {
    let (_file, service, org, server, client) = fixture().await;
    let mut invalid = input();
    invalid.query = Some("\"unclosed".into());
    assert!(service
        .search_progressive_with_client(&client, &org, invalid)
        .await
        .is_err());
    assert!(server.received_requests().await.unwrap().is_empty());
    mount(&server, |r: &Request| {
        response(if skip(r) == 0 {
            (1..=200).map(|n| pr(n, "fix")).collect()
        } else {
            vec![]
        })
    })
    .await;
    let input = input();
    let first = service
        .search_progressive_with_client(&client, &org, input.clone())
        .await
        .unwrap();
    service
        .search_sessions
        .lock()
        .unwrap()
        .get_mut("search-1")
        .unwrap()
        .touched = Instant::now() - TTL - Duration::from_secs(1);
    assert!(service
        .search_progressive_with_client(&client, &org, next(input, &first))
        .await
        .is_err());
}

#[tokio::test]
async fn repository_people_and_date_filters_reach_the_api() {
    let (_file, service, org, server, client) = fixture().await;
    Mock::given(method("GET"))
        .and(path("/_apis/git/repositories/repo/pullrequests"))
        .respond_with(response(vec![]))
        .expect(1)
        .mount(&server)
        .await;
    let mut input = input();
    input.repository_ids = Some(vec!["repo".into()]);
    input.author_id = Some("author-id".into());
    input.reviewer_id = Some("me".into());
    input.target_branches = Some(vec!["main".into()]);
    input.from_date = Some("2026-01-01".into());
    input.to_date = Some("2026-02-01".into());
    input.date_basis = Some("closed".into());
    let result = service
        .search_progressive_with_client(&client, &org, input)
        .await
        .unwrap();
    assert_eq!(result.search_complete, Some(true));
    let requests = server.received_requests().await.unwrap();
    let params = requests[0].url.query_pairs().collect::<HashMap<_, _>>();
    for (key, value) in [
        ("api-version", "7.1"),
        ("$top", "200"),
        ("$skip", "0"),
        ("searchCriteria.creatorId", "author-id"),
        ("searchCriteria.reviewerId", "me-id"),
        ("searchCriteria.queryTimeRangeType", "closed"),
        ("searchCriteria.targetRefName", "refs/heads/main"),
    ] {
        assert_eq!(params.get(key).unwrap(), value);
    }
    assert!(params
        .get("searchCriteria.minTime")
        .unwrap()
        .starts_with("2026-01-01"));
}
