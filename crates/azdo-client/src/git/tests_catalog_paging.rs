//! Paging coverage for the project and repository catalogs.
//!
//! Both endpoints apply a default page size server-side and drop the rest with
//! no error. Before paging was added, organizations past that limit silently
//! lost projects from every picker, and commit sync skipped the repositories it
//! never saw.

use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

const PAGE_SIZE: usize = 200;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

fn projects_page(start: usize, count: usize) -> serde_json::Value {
    let value: Vec<serde_json::Value> = (start..start + count)
        .map(
            |i| serde_json::json!({ "id": format!("project-{i}"), "name": format!("Project {i}") }),
        )
        .collect();
    serde_json::json!({ "count": value.len(), "value": value })
}

fn repositories_page(start: usize, count: usize) -> serde_json::Value {
    let value: Vec<serde_json::Value> = (start..start + count)
        .map(|i| {
            serde_json::json!({
                "id": format!("repo-{i}"),
                "name": format!("repo-{i}"),
                "project": { "id": "project-1", "name": "Platform" }
            })
        })
        .collect();
    serde_json::json!({ "count": value.len(), "value": value })
}

#[tokio::test]
async fn list_projects_pages_past_the_default_page_size() {
    let server = MockServer::start().await;
    // A full page means "there may be more"; the short page ends the loop.
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(projects_page(0, PAGE_SIZE)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("$skip", "200"))
        .respond_with(ResponseTemplate::new(200).set_body_json(projects_page(PAGE_SIZE, 3)))
        .mount(&server)
        .await;

    let projects = test_client(&server).await.list_projects().await.unwrap();

    assert_eq!(projects.len(), PAGE_SIZE + 3);
    assert_eq!(
        projects[PAGE_SIZE + 2].id,
        format!("project-{}", PAGE_SIZE + 2)
    );
}

#[tokio::test]
async fn list_projects_stops_after_a_single_short_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(projects_page(0, 2)))
        .expect(1)
        .mount(&server)
        .await;

    let projects = test_client(&server).await.list_projects().await.unwrap();

    assert_eq!(projects.len(), 2);
    // `expect(1)` fails on drop if a needless second page was requested.
}

#[tokio::test]
async fn list_repositories_pages_past_the_default_page_size() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories"))
        .and(query_param("$skip", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(repositories_page(0, PAGE_SIZE)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories"))
        .and(query_param("$skip", "200"))
        .respond_with(ResponseTemplate::new(200).set_body_json(repositories_page(PAGE_SIZE, 1)))
        .mount(&server)
        .await;

    let repos = test_client(&server)
        .await
        .list_repositories("project-1")
        .await
        .unwrap();

    assert_eq!(repos.len(), PAGE_SIZE + 1);
    assert_eq!(repos[PAGE_SIZE].id, format!("repo-{PAGE_SIZE}"));
}

#[tokio::test]
async fn list_repositories_returns_an_empty_list_without_extra_requests() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/git/repositories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(repositories_page(0, 0)))
        .expect(1)
        .mount(&server)
        .await;

    let repos = test_client(&server)
        .await
        .list_repositories("project-1")
        .await
        .unwrap();

    assert!(repos.is_empty());
}
