use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;
use crate::error::AdoError;
use crate::work_items::*;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn query_work_item_ids_posts_wiql() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_json(
            serde_json::json!({ "query": "SELECT [System.Id] FROM WorkItems" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItems": [{ "id": 10 }, { "id": 11 }]
        })))
        .mount(&server)
        .await;

    let ids = test_client(&server)
        .await
        .query_work_item_ids("project-1", "SELECT [System.Id] FROM WorkItems", None)
        .await
        .unwrap();
    assert_eq!(ids, vec![10, 11]);
}

#[tokio::test]
async fn query_work_item_ids_sends_top_parameter() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("$top", "2000"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItems": [{ "id": 10 }]
        })))
        .mount(&server)
        .await;

    let ids = test_client(&server)
        .await
        .query_work_item_ids("project-1", "SELECT [System.Id] FROM WorkItems", Some(2000))
        .await
        .unwrap();
    assert_eq!(ids, vec![10]);
}

#[tokio::test]
async fn query_work_item_ids_errors_on_link_query_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItemRelations": [
                { "target": { "id": 1 } },
                { "source": { "id": 1 }, "target": { "id": 2 } }
            ]
        })))
        .mount(&server)
        .await;

    let error = test_client(&server)
        .await
        .query_work_item_ids(
            "project-1",
            "SELECT [System.Id] FROM WorkItemLinks MODE (Recursive)",
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AdoError::WiqlQueryShape(_)));
}

#[tokio::test]
async fn query_work_item_links_errors_on_flat_query_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItems": [{ "id": 10 }, { "id": 11 }]
        })))
        .mount(&server)
        .await;

    let error = test_client(&server)
        .await
        .query_work_item_links("project-1", "SELECT [System.Id] FROM WorkItems", None)
        .await
        .unwrap_err();
    assert!(matches!(error, AdoError::WiqlQueryShape(_)));
}

#[tokio::test]
async fn query_work_item_links_maps_relations() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItemRelations": [
                { "target": { "id": 1 } },
                { "rel": "System.LinkTypes.Hierarchy-Forward", "source": { "id": 1 }, "target": { "id": 2 } },
                { "rel": "System.LinkTypes.Hierarchy-Forward", "source": { "id": 2 }, "target": { "id": 3 } }
            ]
        })))
        .mount(&server)
        .await;

    let links = test_client(&server)
        .await
        .query_work_item_links(
            "project-1",
            "SELECT [System.Id] FROM WorkItemLinks MODE (Recursive)",
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        links,
        vec![
            WorkItemLink {
                source_id: None,
                target_id: 1
            },
            WorkItemLink {
                source_id: Some(1),
                target_id: 2
            },
            WorkItemLink {
                source_id: Some(2),
                target_id: 3
            },
        ]
    );
}

#[tokio::test]
async fn get_work_item_relations_expands_relations() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workitems/10"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("$expand", "relations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "relations": [
                {
                    "rel": "System.LinkTypes.Hierarchy-Reverse",
                    "url": "https://dev.azure.com/testorg/_apis/wit/workItems/5",
                    "attributes": { "name": "Parent" }
                },
                {
                    "rel": "AttachedFile",
                    "url": "https://dev.azure.com/testorg/_apis/wit/attachments/abc"
                }
            ]
        })))
        .mount(&server)
        .await;

    let relations = test_client(&server)
        .await
        .get_work_item_relations("project-1", 10)
        .await
        .unwrap();
    assert_eq!(relations.len(), 2);
    assert_eq!(relations[0].rel, "System.LinkTypes.Hierarchy-Reverse");
    assert_eq!(
        relations[0].url,
        "https://dev.azure.com/testorg/_apis/wit/workItems/5"
    );
}

#[tokio::test]
async fn get_work_items_batch_maps_fields() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{
                "id": 10,
                "fields": {
                    "System.Title": "Fix bug",
                    "System.State": "Active"
                },
                "_links": {
                    "html": { "href": "https://dev.azure.com/testorg/project/_workitems/edit/10" }
                }
            }]
        })))
        .mount(&server)
        .await;

    let items = test_client(&server)
        .await
        .get_work_items_batch(
            "project-1",
            vec![10],
            vec!["System.Title".to_string(), "System.State".to_string()],
        )
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, 10);
    assert_eq!(items[0].fields["System.Title"], "Fix bug");
}

#[tokio::test]
async fn get_work_items_batch_splits_large_id_lists() {
    let server = MockServer::start().await;
    // 201 ids must be sent as one 200-id request plus one 1-id request,
    // because the workitemsbatch API rejects more than 200 ids at once.
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/workitemsbatch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [{ "id": 1, "fields": { "System.Title": "T" } }]
        })))
        .expect(2)
        .mount(&server)
        .await;

    let ids: Vec<i64> = (1..=201).collect();
    let items = test_client(&server)
        .await
        .get_work_items_batch("project-1", ids, vec!["System.Title".to_string()])
        .await
        .unwrap();
    // Both chunk responses are concatenated.
    assert_eq!(items.len(), 2);
}

#[tokio::test]
async fn add_work_item_comment_posts_markdown() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/workItems/10/comments"))
        .and(query_param("api-version", "7.1-preview.4"))
        .and(query_param("format", "markdown"))
        .and(body_json(
            serde_json::json!({ "text": "@<user-1> please check" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 5,
            "text": "@<user-1> please check",
            "renderedText": "<p><a>@Test User</a> please check</p>",
            "createdBy": { "displayName": "Me" },
            "createdDate": "2026-05-27T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let comment = test_client(&server)
        .await
        .add_work_item_comment("project-1", 10, "@<user-1> please check")
        .await
        .unwrap();
    assert_eq!(comment.id, 5);
    assert_eq!(
        comment.created_by.unwrap().display_name.as_deref(),
        Some("Me")
    );
}

#[tokio::test]
async fn list_work_item_comments_returns_comments() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workItems/10/comments"))
        .and(query_param("api-version", "7.1-preview.4"))
        .and(query_param("$top", "50"))
        .and(query_param("order", "desc"))
        // Mentions only resolve into `renderedText` when `all` is expanded.
        .and(query_param("$expand", "all"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "totalCount": 2,
            "count": 2,
            "comments": [
                {
                    "id": 2,
                    "text": "Second @<guid> comment",
                    "renderedText": "<p>Second <a>@Alice</a> comment</p>",
                    "createdBy": { "displayName": "Bob" },
                    "createdDate": "2026-05-28T10:00:00Z"
                },
                {
                    "id": 1,
                    "text": "First comment",
                    "renderedText": "<p>First comment</p>",
                    "createdBy": { "displayName": "Alice" },
                    "createdDate": "2026-05-27T10:00:00Z"
                }
            ]
        })))
        .mount(&server)
        .await;

    let comments = test_client(&server)
        .await
        .list_work_item_comments("project-1", 10, 50)
        .await
        .unwrap();
    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0].id, 2);
    // The service-resolved mention HTML is carried through so the preview
    // can show "@Alice" instead of the raw `@<guid>` token.
    assert_eq!(
        comments[0].rendered_text.as_deref(),
        Some("<p>Second <a>@Alice</a> comment</p>")
    );
    assert_eq!(
        comments[0]
            .created_by
            .as_ref()
            .unwrap()
            .display_name
            .as_deref(),
        Some("Bob")
    );
}

#[tokio::test]
async fn list_work_item_updates_returns_revised_by_and_field_values() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workItems/10/updates"))
        .and(query_param("api-version", "7.1-preview"))
        .and(query_param("$top", "50"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "count": 1,
            "value": [
                {
                    "id": 3,
                    "rev": 3,
                    "revisedBy": {
                        "id": "user-1",
                        "displayName": "Alice Johnson",
                        "uniqueName": "alice@example.com"
                    },
                    "fields": {
                        "System.AssignedTo": {
                            "oldValue": "Bob Tanaka <bob@example.com>",
                            "newValue": {
                                "displayName": "Alice Johnson",
                                "uniqueName": "alice@example.com"
                            }
                        }
                    }
                }
            ]
        })))
        .mount(&server)
        .await;

    let updates = test_client(&server)
        .await
        .list_work_item_updates("project-1", 10, 50)
        .await
        .unwrap();

    assert_eq!(updates.len(), 1);
    assert_eq!(
        updates[0]
            .revised_by
            .as_ref()
            .unwrap()
            .display_name
            .as_deref(),
        Some("Alice Johnson")
    );
    assert_eq!(
        updates[0].fields["System.AssignedTo"].old_value.as_ref(),
        Some(&serde_json::json!("Bob Tanaka <bob@example.com>"))
    );
}

#[tokio::test]
async fn update_work_item_comment_patches_markdown() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10/comments/5"))
        .and(query_param("api-version", "7.1-preview.4"))
        .and(query_param("format", "markdown"))
        .and(body_json(serde_json::json!({ "text": "edited body" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 5,
            "text": "edited body",
            "renderedText": "<p>edited body</p>",
            "createdBy": { "displayName": "Me" },
            "createdDate": "2026-05-27T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let comment = test_client(&server)
        .await
        .update_work_item_comment("project-1", 10, 5, "edited body")
        .await
        .unwrap();
    assert_eq!(comment.id, 5);
    assert_eq!(comment.text.as_deref(), Some("edited body"));
}

#[tokio::test]
async fn delete_work_item_comment_sends_delete() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/project-1/_apis/wit/workItems/10/comments/5"))
        .and(query_param("api-version", "7.1-preview.4"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    test_client(&server)
        .await
        .delete_work_item_comment("project-1", 10, 5)
        .await
        .unwrap();
}

#[tokio::test]
async fn update_work_item_assigned_to_patches_identity_field() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/project-1/_apis/wit/workItems/10"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_json(serde_json::json!([
            {
                "op": "add",
                "path": "/fields/System.AssignedTo",
                "value": "alice@example.com"
            }
        ])))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 10,
            "fields": {
                "System.Title": "Fix bug",
                "System.AssignedTo": {
                    "displayName": "Alice Johnson",
                    "uniqueName": "alice@example.com"
                }
            }
        })))
        .mount(&server)
        .await;

    let item = test_client(&server)
        .await
        .update_work_item_assigned_to("project-1", 10, "alice@example.com")
        .await
        .unwrap();

    assert_eq!(item.id, 10);
    assert_eq!(
        item.fields["System.AssignedTo"]["displayName"].as_str(),
        Some("Alice Johnson")
    );
}
