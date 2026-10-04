use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn retry_build_stage_patches_the_stage_and_accepts_an_empty_response() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/build/builds/101/stages/Deploy_Prod"))
        .and(query_param("api-version", "7.1"))
        .and(body_json(serde_json::json!({
            "state": "retry",
            "forceRetryAllJobs": false
        })))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .retry_build_stage("project-1", 101, "Deploy_Prod", false)
        .await
        .unwrap();
}

#[tokio::test]
async fn retry_build_stage_can_force_every_job() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/build/builds/101/stages/Build"))
        .and(body_json(serde_json::json!({
            "state": "retry",
            "forceRetryAllJobs": true
        })))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .retry_build_stage("project-1", 101, "Build", true)
        .await
        .unwrap();
}
