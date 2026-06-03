use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Serialize)]
pub struct WiqlRequest {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WiqlResponse {
    #[serde(default)]
    pub work_items: Vec<WorkItemReference>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemReference {
    pub id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsBatchRequest {
    pub ids: Vec<i64>,
    pub fields: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    pub id: i64,
    #[serde(default)]
    pub fields: HashMap<String, Value>,
    #[serde(rename = "_links")]
    pub links: Option<WorkItemLinks>,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemLinks {
    pub html: Option<LinkRef>,
}

#[derive(Debug, Deserialize)]
pub struct LinkRef {
    pub href: String,
}

#[derive(Debug, Serialize)]
pub struct WorkItemCommentCreate {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct WorkItemPatchOperation {
    pub op: &'static str,
    pub path: &'static str,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemComment {
    pub id: i64,
    pub text: Option<String>,
    pub rendered_text: Option<String>,
    pub created_date: Option<String>,
    pub created_by: Option<CommentIdentityRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentIdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemCommentsList {
    #[serde(default)]
    pub comments: Vec<WorkItemComment>,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeState {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeStatesList {
    pub value: Vec<WorkItemTypeState>,
}

#[derive(Debug, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub wiql: Option<String>,
}

impl AdoClient {
    pub async fn query_work_item_ids(&self, project_id: &str, wiql: &str) -> Result<Vec<i64>> {
        let path = format!("{project_id}/_apis/wit/wiql");
        let response: WiqlResponse = self
            .post_json(
                &path,
                &[("api-version", "7.1-preview")],
                &WiqlRequest {
                    query: wiql.to_string(),
                },
            )
            .await?;
        Ok(response
            .work_items
            .into_iter()
            .map(|item| item.id)
            .collect())
    }

    pub async fn get_work_items_batch(
        &self,
        project_id: &str,
        ids: Vec<i64>,
        fields: Vec<String>,
    ) -> Result<Vec<WorkItem>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let path = format!("{project_id}/_apis/wit/workitemsbatch");
        let response: crate::git::ListResponse<WorkItem> = self
            .post_json(
                &path,
                &[("api-version", "7.1-preview")],
                &WorkItemsBatchRequest { ids, fields },
            )
            .await?;
        Ok(response.value)
    }

    pub async fn add_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        self.post_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
        .await
    }

    pub async fn delete_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
    ) -> Result<()> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.delete(&path, &[("api-version", "7.1-preview.4")])
            .await
    }

    pub async fn list_work_item_comments(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemComment>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        let top_str = top.to_string();
        let response: WorkItemCommentsList = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview.4"),
                    ("$top", &top_str),
                    ("order", "desc"),
                ],
            )
            .await?;
        Ok(response.comments)
    }

    pub async fn update_work_item_assigned_to(
        &self,
        project_id: &str,
        work_item_id: i64,
        assigned_to: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/System.AssignedTo",
                value: json!(assigned_to),
            }],
        )
        .await
    }

    pub async fn update_work_item_state(
        &self,
        project_id: &str,
        work_item_id: i64,
        state: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/System.State",
                value: json!(state),
            }],
        )
        .await
    }

    pub async fn update_work_item_reason(
        &self,
        project_id: &str,
        work_item_id: i64,
        reason: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/System.Reason",
                value: json!(reason),
            }],
        )
        .await
    }

    pub async fn update_work_item_priority(
        &self,
        project_id: &str,
        work_item_id: i64,
        priority: i64,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/Microsoft.VSTS.Common.Priority",
                value: json!(priority),
            }],
        )
        .await
    }

    pub async fn list_work_item_type_states(
        &self,
        project_id: &str,
        work_item_type: &str,
    ) -> Result<Vec<String>> {
        let encoded_type = encode_path_segment(work_item_type);
        let path = format!("{project_id}/_apis/wit/workitemtypes/{encoded_type}/states");
        let response: WorkItemTypeStatesList = self
            .get_json(&path, &[("api-version", "7.1-preview.1")])
            .await?;
        Ok(response.value.into_iter().map(|s| s.name).collect())
    }

    pub async fn get_saved_query(&self, project_id: &str, query_id: &str) -> Result<SavedQuery> {
        let path = format!("{project_id}/_apis/wit/queries/{query_id}");
        self.get_json(&path, &[("api-version", "7.1"), ("$expand", "all")])
            .await
    }
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_json, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

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
            .query_work_item_ids("project-1", "SELECT [System.Id] FROM WorkItems")
            .await
            .unwrap();
        assert_eq!(ids, vec![10, 11]);
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
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "totalCount": 2,
                "count": 2,
                "comments": [
                    {
                        "id": 2,
                        "text": "Second comment",
                        "renderedText": "<p>Second comment</p>",
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
    async fn update_work_item_reason_patches_reason_field() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/project-1/_apis/wit/workItems/10"))
            .and(query_param("api-version", "7.1-preview"))
            .and(body_json(serde_json::json!([
                {
                    "op": "add",
                    "path": "/fields/System.Reason",
                    "value": "Work started"
                }
            ])))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 10,
                "fields": {
                    "System.Title": "Fix bug",
                    "System.Reason": "Work started"
                }
            })))
            .mount(&server)
            .await;

        let item = test_client(&server)
            .await
            .update_work_item_reason("project-1", 10, "Work started")
            .await
            .unwrap();

        assert_eq!(item.id, 10);
        assert_eq!(item.fields["System.Reason"].as_str(), Some("Work started"));
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

    #[test]
    fn encode_path_segment_handles_special_characters() {
        assert_eq!(encode_path_segment("Bug & Feature"), "Bug%20%26%20Feature");
    }
}
