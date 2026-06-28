use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn list_builds_passes_filters_as_query() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/builds"))
        .and(query_param("api-version", "7.1"))
        .and(query_param("queryOrder", "queueTimeDescending"))
        .and(query_param("$top", "50"))
        .and(query_param("definitions", "12"))
        .and(query_param("branchName", "refs/heads/main"))
        .and(query_param("resultFilter", "failed"))
        .and(query_param("requestedFor", "user-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": 101,
                "buildNumber": "20260613.1",
                "status": "completed",
                "result": "failed",
                "sourceBranch": "refs/heads/main",
                "reason": "individualCI",
                "queueTime": "2026-06-13T10:00:00Z",
                "startTime": "2026-06-13T10:00:05Z",
                "finishTime": "2026-06-13T10:03:00Z",
                "definition": { "id": 12, "name": "CI" },
                "requestedFor": { "id": "user-1", "displayName": "Test User" }
            }]
        })))
        .mount(&server)
        .await;

    let builds = test_client(&server)
        .await
        .list_builds(
            "project-1",
            BuildListCriteria {
                definition_id: Some(12),
                branch: Some("main".to_string()),
                result_filter: Some("failed".to_string()),
                status_filter: None,
                requested_for: Some("user-1".to_string()),
                top: Some(50),
            },
        )
        .await
        .unwrap();

    assert_eq!(builds.len(), 1);
    assert_eq!(builds[0].id, 101);
    assert_eq!(builds[0].result.as_deref(), Some("failed"));
    assert_eq!(builds[0].definition.as_ref().unwrap().name, "CI");
}

#[tokio::test]
async fn get_build_timeline_parses_records() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/builds/101/Timeline"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "records": [
                {
                    "id": "stage-1", "parentId": null, "type": "Stage",
                    "name": "Build", "state": "completed", "result": "failed",
                    "errorCount": 1, "warningCount": 0, "order": 1
                },
                {
                    "id": "job-1", "parentId": "stage-1", "type": "Job",
                    "name": "Compile", "state": "completed", "result": "failed",
                    "log": { "id": 7 }, "errorCount": 1, "warningCount": 0, "order": 1
                }
            ]
        })))
        .mount(&server)
        .await;

    let timeline = test_client(&server)
        .await
        .get_build_timeline("project-1", 101)
        .await
        .unwrap();

    assert_eq!(timeline.records.len(), 2);
    let job = timeline.records.iter().find(|r| r.id == "job-1").unwrap();
    assert_eq!(job.parent_id.as_deref(), Some("stage-1"));
    assert_eq!(job.log.as_ref().unwrap().id, 7);
    assert_eq!(job.error_count, 1);
}

#[tokio::test]
async fn list_build_artifacts_maps_download_urls() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/builds/101/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": 1,
                "name": "drop",
                "resource": { "type": "Container", "downloadUrl": "https://dev.azure.com/x/drop.zip" }
            }]
        })))
        .mount(&server)
        .await;

    let artifacts = test_client(&server)
        .await
        .list_build_artifacts("project-1", 101)
        .await
        .unwrap();
    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0].name, "drop");
    assert_eq!(
        artifacts[0]
            .resource
            .as_ref()
            .unwrap()
            .download_url
            .as_deref(),
        Some("https://dev.azure.com/x/drop.zip")
    );
}

#[tokio::test]
async fn list_build_definitions_wraps_name_filter() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/definitions"))
        .and(query_param("name", "*ci*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "id": 12, "name": "CI" }]
        })))
        .mount(&server)
        .await;

    let defs = test_client(&server)
        .await
        .list_build_definitions("project-1", Some("ci"), 100)
        .await
        .unwrap();
    assert_eq!(defs[0].id, 12);
}

#[tokio::test]
async fn get_build_definition_parses_triggers_and_sorts_variables() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/definitions/12"))
        .and(query_param("api-version", "7.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 12,
            "name": "CI",
            "triggers": [
                {
                    "triggerType": "continuousIntegration",
                    "branchFilters": ["+refs/heads/main"],
                    "pathFilters": []
                },
                {
                    "triggerType": "schedule"
                }
            ],
            "variables": {
                "Zeta": { "value": "last", "allowOverride": true },
                "Alpha": { "value": "first" },
                "ApiKey": { "isSecret": true }
            }
        })))
        .mount(&server)
        .await;

    let detail = test_client(&server)
        .await
        .get_build_definition("project-1", 12)
        .await
        .unwrap();

    assert_eq!(detail.id, 12);
    assert_eq!(detail.triggers.len(), 2);
    assert_eq!(
        detail.triggers[0].trigger_type.as_deref(),
        Some("continuousIntegration")
    );
    assert_eq!(detail.triggers[0].branch_filters, vec!["+refs/heads/main"]);
    assert_eq!(detail.triggers[1].trigger_type.as_deref(), Some("schedule"));

    // Variables are sorted by name regardless of map order.
    let names: Vec<&str> = detail.variables.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(names, vec!["Alpha", "ApiKey", "Zeta"]);

    let secret = detail
        .variables
        .iter()
        .find(|v| v.name == "ApiKey")
        .unwrap();
    assert!(secret.is_secret);
    assert_eq!(secret.value, None);

    let overridable = detail.variables.iter().find(|v| v.name == "Zeta").unwrap();
    assert!(overridable.allow_override);
}

#[tokio::test]
async fn get_build_log_tail_returns_last_lines() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/builds/101/logs/7"))
        .respond_with(ResponseTemplate::new(200).set_body_string("a\nb\nc\nd"))
        .mount(&server)
        .await;

    let tail = test_client(&server)
        .await
        .get_build_log_tail("project-1", 101, 7, 2)
        .await
        .unwrap();
    assert_eq!(tail.lines, vec!["c".to_string(), "d".to_string()]);
    assert!(tail.truncated);
}

#[tokio::test]
async fn queue_build_posts_definition_and_branch() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/build/builds"))
        .and(body_json(serde_json::json!({
            "definition": { "id": 12 },
            "sourceBranch": "refs/heads/main"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 202, "status": "notStarted", "definition": { "id": 12, "name": "CI" }
        })))
        .mount(&server)
        .await;

    let build = test_client(&server)
        .await
        .queue_build("project-1", 12, "refs/heads/main", None)
        .await
        .unwrap();
    assert_eq!(build.id, 202);
}

#[tokio::test]
async fn queue_build_includes_parameters_when_present() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/build/builds"))
        .and(body_json(serde_json::json!({
            "definition": { "id": 12 },
            "sourceBranch": "refs/heads/main",
            "parameters": "{\"env\":\"prod\"}"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 203, "status": "notStarted"
        })))
        .mount(&server)
        .await;

    let build = test_client(&server)
        .await
        .queue_build(
            "project-1",
            12,
            "refs/heads/main",
            Some(&serde_json::json!({ "env": "prod" })),
        )
        .await
        .unwrap();
    assert_eq!(build.id, 203);
}

#[tokio::test]
async fn cancel_build_patches_status() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/build/builds/101"))
        .and(body_json(serde_json::json!({ "status": "cancelling" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 101, "status": "cancelling"
        })))
        .mount(&server)
        .await;

    let build = test_client(&server)
        .await
        .cancel_build("project-1", 101)
        .await
        .unwrap();
    assert_eq!(build.status.as_deref(), Some("cancelling"));
}

#[tokio::test]
async fn list_pipeline_approvals_filters_by_state_and_user() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/pipelines/approvals"))
        .and(query_param("api-version", "7.1"))
        .and(query_param("state", "pending"))
        .and(query_param("$expand", "steps"))
        .and(query_param("userIds", "user-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": "ee14f612-6838-43c0-b445-db238ef14153",
                "status": "pending",
                "instructions": "Approve to deploy",
                "minRequiredApprovers": 1,
                "executionOrder": "anyOrder",
                "steps": [{
                    "status": "pending",
                    "order": 1,
                    "assignedApprover": { "id": "user-1", "displayName": "Test User" }
                }]
            }]
        })))
        .mount(&server)
        .await;

    let approvals = test_client(&server)
        .await
        .list_pipeline_approvals("project-1", &["user-1".to_string()], "pending")
        .await
        .unwrap();
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].status.as_deref(), Some("pending"));
    assert_eq!(approvals[0].steps.len(), 1);
}

#[tokio::test]
async fn update_pipeline_approval_patches_status() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/pipelines/approvals"))
        .and(query_param("api-version", "7.1"))
        .and(body_json(serde_json::json!([{
            "approvalId": "aab27959-a5be-4ee3-97ca-f19b3602cd2f",
            "status": "approved",
            "comment": "Approving"
        }])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": "aab27959-a5be-4ee3-97ca-f19b3602cd2f",
                "status": "approved"
            }]
        })))
        .mount(&server)
        .await;

    let updated = test_client(&server)
        .await
        .update_pipeline_approval(
            "project-1",
            "aab27959-a5be-4ee3-97ca-f19b3602cd2f",
            "approved",
            "Approving",
        )
        .await
        .unwrap();
    assert_eq!(updated.len(), 1);
    assert_eq!(updated[0].status.as_deref(), Some("approved"));
}
