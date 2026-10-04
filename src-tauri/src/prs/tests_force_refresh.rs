//! An explicit user refresh must not be satisfied from a shared cache that the
//! other app wrote moments ago (#648); automatic syncs still may be.

use std::sync::Arc;

use azdo_client::{AdoClient, PatProvider, TeamProject};
use serde_json::json;
use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::db::Organization;
use crate::shared_cache::{self, SharedPullRequest};

use super::sync_fetch::fetch_active_prs_for_project;

fn org() -> Organization {
    Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: None,
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: "2026-06-01T00:00:00Z".to_string(),
        updated_at: "2026-06-01T00:00:00Z".to_string(),
        provider_kind: "azdo".to_string(),
    }
}

fn project() -> TeamProject {
    TeamProject {
        id: "project-1".to_string(),
        name: "Platform".to_string(),
    }
}

fn seed_fresh_shared_cache(org: &Organization, project: &TeamProject) {
    let mut conn = shared_cache::open().unwrap();
    let stale = SharedPullRequest {
        repository_id: "repo-1".to_string(),
        repository_name: "Repo".to_string(),
        pull_request_id: 7,
        title: "Already completed in the browser".to_string(),
        status: "active".to_string(),
        created_by: None,
        created_by_id: None,
        creation_date: "2026-06-01T00:00:00Z".to_string(),
        source_ref_name: "refs/heads/feature".to_string(),
        target_ref_name: "refs/heads/main".to_string(),
        is_draft: false,
        web_url: None,
    };
    shared_cache::write_pull_requests(&mut conn, &org.name, &project.name, &[stale], &[]).unwrap();
    shared_cache::mark_synced(
        &conn,
        &org.name,
        &project.name,
        shared_cache::KIND_PULL_REQUESTS,
        "waypoint",
    )
    .unwrap();
}

async fn client_with_live_pr(server: &MockServer) -> AdoClient {
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/pullrequests"))
        .and(query_param("searchCriteria.status", "active"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "pullRequestId": 8,
                "title": "Live PR",
                "status": "active",
                "creationDate": "2026-06-09T00:00:00Z",
                "repository": {
                    "id": "repo-1",
                    "name": "Repo",
                    "project": { "id": "project-1", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/feature",
                "targetRefName": "refs/heads/main"
            }]
        })))
        .mount(server)
        .await;
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

fn titles(fetch: crate::prs::sync::PrProjectFetch) -> Vec<String> {
    fetch
        .result
        .unwrap()
        .into_iter()
        .map(|pr| pr.title)
        .collect()
}

#[tokio::test]
async fn automatic_sync_reuses_a_fresh_shared_cache() {
    let server = MockServer::start().await;
    let client = client_with_live_pr(&server).await;
    let (org, project) = (org(), project());
    seed_fresh_shared_cache(&org, &project);

    let fetch = fetch_active_prs_for_project(client, org, project, false).await;

    assert_eq!(titles(fetch), vec!["Already completed in the browser"]);
}

#[tokio::test]
async fn forced_refresh_ignores_a_fresh_shared_cache() {
    let server = MockServer::start().await;
    let client = client_with_live_pr(&server).await;
    let (org, project) = (org(), project());
    seed_fresh_shared_cache(&org, &project);

    let fetch = fetch_active_prs_for_project(client, org, project, true).await;

    assert_eq!(titles(fetch), vec!["Live PR"]);
}
