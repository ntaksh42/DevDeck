use std::sync::Arc;

use azdo_client::{AdoClient, PatProvider, PullRequestStatus};
use serde_json::json;
use tokio::task::JoinSet;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::db::Organization;
use crate::error::{AppError, Result};

fn organization() -> Organization {
    Organization {
        id: "org".into(),
        name: "org".into(),
        display_name: None,
        base_url: "https://dev.azure.com/org".into(),
        auth_provider: "pat".into(),
        credential_key: String::new(),
        authenticated_user_id: Some("user".into()),
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: String::new(),
        updated_at: String::new(),
        provider_kind: "azdo".into(),
    }
}

async fn collect(outcomes: Vec<(&str, Result<Vec<i32>>)>) -> ProjectPrResults<i32> {
    let mut tasks = JoinSet::new();
    for (project, result) in outcomes {
        let project = project.to_string();
        tasks.spawn(async move { (project, result) });
    }
    collect_project_prs(tasks).await.unwrap()
}

fn failure() -> Result<Vec<i32>> {
    Err(AppError::AzureDevOps("project unavailable".into()))
}

#[tokio::test]
async fn partial_failure_retains_rows_and_reports_project() {
    let result = collect(vec![("Restricted", failure()), ("Visible", Ok(vec![42]))])
        .await
        .finish()
        .unwrap();
    assert_eq!(result, (vec![42], vec!["Restricted".to_string()]));
}

#[tokio::test]
async fn all_failed_projects_return_error() {
    assert!(collect(vec![("A", failure()), ("B", failure())])
        .await
        .finish()
        .is_err());
}

#[tokio::test]
async fn successful_empty_project_counts_as_success() {
    assert_eq!(
        collect(vec![("A", failure()), ("B", Ok(vec![]))])
            .await
            .finish()
            .unwrap(),
        (vec![], vec!["A".to_string()])
    );
    assert_eq!(collect(vec![]).await.finish().unwrap(), (vec![], vec![]));
}

#[tokio::test]
async fn search_batches_preserve_success_and_deduplicate_warnings() {
    let mut results = collect(vec![("A", failure()), ("B", Ok(vec![42]))]).await;
    results.merge(collect(vec![("A", failure()), ("B", failure())]).await);
    assert_eq!(
        results.finish().unwrap(),
        (vec![42], vec!["A".to_string(), "B".to_string()])
    );
}

#[tokio::test]
async fn cached_active_success_survives_failed_live_search() {
    let mut results = collect(vec![("A", failure())]).await;
    results.success_count += 1;
    assert_eq!(results.finish().unwrap(), (vec![], vec!["A".to_string()]));
}

#[tokio::test]
async fn live_fetches_skip_http_errors_and_keep_other_project_results() {
    for status in [403, 404, 500] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/restricted/_apis/git/pullrequests"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/visible/_apis/git/pullrequests"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "value": [{
                    "pullRequestId": 42,
                    "title": "Visible PR",
                    "status": "active",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "sourceRefName": "refs/heads/feature",
                    "targetRefName": "refs/heads/main",
                    "repository": {"id": "repo", "name": "Repo"}
                }]
            })))
            .mount(&server)
            .await;
        let client = AdoClient::new("org", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());
        let mut created = JoinSet::new();
        let mut search = JoinSet::new();
        for project in ["restricted", "visible"] {
            let client = client.clone();
            created.spawn(async move {
                let result =
                    fetch_created_prs_for_project(&client, &organization(), project, "user").await;
                (project.to_string(), result)
            });
            let client = client_for_test(&server);
            search.spawn(async move {
                let result = fetch_status_prs_for_project(
                    &client,
                    &organization(),
                    project,
                    project,
                    PullRequestStatus::Completed,
                    None,
                    None,
                    None,
                    "created",
                )
                .await;
                (project.to_string(), result)
            });
        }
        let (rows, warnings) = collect_project_prs(created)
            .await
            .unwrap()
            .finish()
            .unwrap();
        assert_eq!(rows.len(), 1, "HTTP {status}");
        assert_eq!(rows[0].pull_request_id, 42);
        assert_eq!(warnings, ["restricted"]);
        let (rows, warnings) = collect_project_prs(search).await.unwrap().finish().unwrap();
        assert_eq!(rows.len(), 1, "HTTP {status}");
        assert_eq!(rows[0].pull_request_id, 42);
        assert_eq!(warnings, ["restricted"]);
    }
}

fn client_for_test(server: &MockServer) -> AdoClient {
    AdoClient::new("org", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap())
}
