use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;
use crate::work_items::requests::encode_path_segment;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn update_work_item_state_patches_state_field() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/fields/System.State",
                "value": "Active"
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": {
                "System.Title": "Fix bug",
                "System.State": "Active"
            }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .update_work_item_state("project-1", 10, "Active")
        .await
        .unwrap();

    assert_eq!(item.id, 10);
    assert_eq!(item.fields["System.State"].as_str(), Some("Active"));
}

#[tokio::test]
async fn create_work_item_posts_patch_document_with_patch_content_type() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/workitems/$User%20Story"))
        .and(query_param("api-version", "7.1-preview"))
        .and(header("Content-Type", "application/json-patch+json"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/fields/System.Title",
                "value": "New story"
            },
            {
                "op": "add",
                "path": "/fields/System.Tags",
                "value": "ui; backlog"
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 42,
            "fields": {
                "System.Title": "New story",
                "System.State": "New",
                "System.WorkItemType": "User Story"
            }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .create_work_item(
            "project-1",
            "User Story",
            &[
                ("System.Title".to_string(), serde_json::json!("New story")),
                ("System.Tags".to_string(), serde_json::json!("ui; backlog")),
            ],
        )
        .await
        .unwrap();

    assert_eq!(item.id, 42);
    assert_eq!(item.fields["System.State"].as_str(), Some("New"));
}

#[tokio::test]
async fn list_work_item_types_returns_type_names() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workitemtypes"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 3,
            "value": [
                { "name": "Bug", "referenceName": "Microsoft.VSTS.WorkItemTypes.Bug" },
                { "name": "Task", "referenceName": "Microsoft.VSTS.WorkItemTypes.Task" },
                { "name": "User Story", "referenceName": "Microsoft.VSTS.WorkItemTypes.UserStory" }
            ]
        })))
        .mount(&server)
        .await;

    let types = test_client(&server)
        .await
        .list_work_item_types("project-1")
        .await
        .unwrap();

    assert_eq!(types, vec!["Bug", "Task", "User Story"]);
}

#[tokio::test]
async fn add_work_item_relation_patches_relations_add() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/relations/-",
                "value": {
                    "rel": "System.LinkTypes.Related",
                    "url": "https://dev.azure.com/x/_apis/wit/workItems/20"
                }
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": { "System.Title": "Fix bug" }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .add_work_item_relation(
            "project-1",
            10,
            "System.LinkTypes.Related",
            "https://dev.azure.com/x/_apis/wit/workItems/20",
        )
        .await
        .unwrap();
    assert_eq!(item.id, 10);
}

#[tokio::test]
async fn remove_work_item_relation_patches_relations_remove() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(body_json(serde_json::json!([
            { "op": "remove", "path": "/relations/2" }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": { "System.Title": "Fix bug" }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .remove_work_item_relation("project-1", 10, 2)
        .await
        .unwrap();
    assert_eq!(item.id, 10);
}

#[tokio::test]
async fn update_work_item_fields_patches_all_fields_in_one_request() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/fields/System.State",
                "value": "Resolved"
            },
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Common.Priority",
                "value": 2
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": {
                "System.Title": "Fix bug",
                "System.State": "Resolved",
                "Microsoft.VSTS.Common.Priority": 2
            }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .update_work_item_fields(
            "project-1",
            10,
            &[
                ("System.State".to_string(), serde_json::json!("Resolved")),
                (
                    "Microsoft.VSTS.Common.Priority".to_string(),
                    serde_json::json!(2),
                ),
            ],
        )
        .await
        .unwrap();

    assert_eq!(item.id, 10);
    assert_eq!(item.fields["System.State"].as_str(), Some("Resolved"));
}

#[tokio::test]
async fn update_work_item_priority_patches_priority_field() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Common.Priority",
                "value": 1
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": {
                "System.Title": "Fix bug",
                "Microsoft.VSTS.Common.Priority": 1
            }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .update_work_item_priority("project-1", 10, 1)
        .await
        .unwrap();

    assert_eq!(item.id, 10);
    assert_eq!(
        item.fields["Microsoft.VSTS.Common.Priority"].as_i64(),
        Some(1)
    );
}

#[tokio::test]
async fn get_saved_query_returns_wiql() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/queries/abc-def-123"))
        .and(query_param("api-version", "7.1"))
        .and(query_param("$expand", "all"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "abc-def-123",
            "name": "Active Bugs",
            "queryType": "flat",
            "wiql": "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'"
        })))
        .mount(&server)
        .await;

    let query = test_client(&server)
        .await
        .get_saved_query("project-1", "abc-def-123")
        .await
        .unwrap();
    assert_eq!(query.id, "abc-def-123");
    assert_eq!(query.name, "Active Bugs");
    assert_eq!(
        query.wiql.as_deref(),
        Some("SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'")
    );
}

#[tokio::test]
async fn get_saved_query_folder_has_no_wiql() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/queries/folder-guid"))
        .and(query_param("$expand", "all"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "folder-guid",
            "name": "My Queries",
            "isFolder": true
        })))
        .mount(&server)
        .await;

    let query = test_client(&server)
        .await
        .get_saved_query("project-1", "folder-guid")
        .await
        .unwrap();
    assert!(query.wiql.is_none());
}

#[tokio::test]
async fn list_work_item_type_states_returns_names() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workitemtypes/Bug/states"))
        .and(query_param("api-version", "7.1-preview.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 3,
            "value": [
                { "name": "New" },
                { "name": "Active" },
                { "name": "Resolved" }
            ]
        })))
        .mount(&server)
        .await;

    let states = test_client(&server)
        .await
        .list_work_item_type_states("project-1", "Bug")
        .await
        .unwrap();

    assert_eq!(states, vec!["New", "Active", "Resolved"]);
}

#[tokio::test]
async fn list_work_item_fields_returns_definitions() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/fields"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "value": [{
                "name": "Release Train",
                "referenceName": "Custom.ReleaseTrain",
                "type": "string"
            }]
        })))
        .mount(&server)
        .await;

    let fields = test_client(&server)
        .await
        .list_work_item_fields("project-1")
        .await
        .unwrap();

    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].name, "Release Train");
    assert_eq!(fields[0].reference_name, "Custom.ReleaseTrain");
    assert_eq!(fields[0].field_type, "string");
}

#[test]
fn encode_path_segment_handles_special_characters() {
    assert_eq!(encode_path_segment("Bug & Feature"), "Bug%20%26%20Feature");
}

#[tokio::test]
async fn list_work_item_type_field_allowed_values_maps_strings_and_numbers() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/wit/workitemtypes/User%20Story/fields/Custom.ReleaseTrain",
        ))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("$expand", "allowedValues"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "referenceName": "Custom.ReleaseTrain",
            "allowedValues": ["Wave 1", "Wave 2", 3]
        })))
        .mount(&server)
        .await;

    let values = test_client(&server)
        .await
        .list_work_item_type_field_allowed_values("project-1", "User Story", "Custom.ReleaseTrain")
        .await
        .unwrap();

    assert_eq!(values, vec!["Wave 1", "Wave 2", "3"]);
}

#[tokio::test]
async fn list_work_item_type_field_allowed_values_defaults_to_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/project-1/_apis/wit/workitemtypes/Bug/fields/Custom.FreeText",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "referenceName": "Custom.FreeText"
        })))
        .mount(&server)
        .await;

    let values = test_client(&server)
        .await
        .list_work_item_type_field_allowed_values("project-1", "Bug", "Custom.FreeText")
        .await
        .unwrap();

    assert!(values.is_empty());
}

#[tokio::test]
async fn get_classification_nodes_returns_tree() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/classificationnodes/iterations"))
        .and(query_param("api-version", "7.1-preview.2"))
        .and(query_param("$depth", "5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "name": "Platform",
            "structureType": "iteration",
            "hasChildren": true,
            "children": [
                {
                    "name": "Sprint 1",
                    "structureType": "iteration",
                    "hasChildren": false,
                    "attributes": {
                        "startDate": "2026-01-01T00:00:00Z",
                        "finishDate": "2026-01-14T00:00:00Z"
                    }
                }
            ]
        })))
        .mount(&server)
        .await;

    let root = test_client(&server)
        .await
        .get_classification_nodes("project-1", "iterations", 5)
        .await
        .unwrap();
    assert_eq!(root.name, "Platform");
    assert!(root.has_children);
    assert_eq!(root.children.len(), 1);
    assert_eq!(root.children[0].name, "Sprint 1");
    assert_eq!(
        root.children[0]
            .attributes
            .as_ref()
            .and_then(|a| a.start_date.clone()),
        Some("2026-01-01T00:00:00Z".to_string())
    );
}

#[tokio::test]
async fn list_work_item_comments_includes_reactions() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workItems/42/comments"))
        .and(query_param("$expand", "all"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "comments": [{
                "id": 7,
                "text": "Looks good",
                "reactions": [
                    { "type": "like", "count": 2, "isCurrentUserEngaged": true },
                    { "type": "heart", "count": 1, "isCurrentUserEngaged": false }
                ]
            }]
        })))
        .mount(&server)
        .await;

    let comments = test_client(&server)
        .await
        .list_work_item_comments("project-1", 42, 50)
        .await
        .unwrap();
    assert_eq!(comments[0].reactions.len(), 2);
    assert_eq!(comments[0].reactions[0].reaction_type, "like");
    assert_eq!(comments[0].reactions[0].count, 2);
    assert!(comments[0].reactions[0].is_current_user_engaged);
}

#[tokio::test]
async fn set_work_item_comment_reaction_puts_and_deletes() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/project-1/_apis/wit/workItems/42/comments/7/reactions/like",
        ))
        .and(query_param("api-version", "7.1-preview.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "type": "like", "count": 1, "isCurrentUserEngaged": true
        })))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(
            "/project-1/_apis/wit/workItems/42/comments/7/reactions/heart",
        ))
        .and(query_param("api-version", "7.1-preview.1"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    client
        .set_work_item_comment_reaction("project-1", 42, 7, "like", true)
        .await
        .unwrap();
    client
        .set_work_item_comment_reaction("project-1", 42, 7, "heart", false)
        .await
        .unwrap();
}
