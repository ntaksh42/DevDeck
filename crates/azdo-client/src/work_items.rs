use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::AdoClient;
use crate::error::{AdoError, Result};

/// Azure DevOps rejects a workitemsbatch request carrying more than 200 ids.
const WORK_ITEMS_BATCH_LIMIT: usize = 200;

#[derive(Debug, Serialize)]
pub struct WiqlRequest {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WiqlResponse {
    #[serde(default)]
    pub work_items: Vec<WorkItemReference>,
    #[serde(default)]
    pub work_item_relations: Vec<WiqlWorkItemRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemReference {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WiqlWorkItemRelation {
    pub source: Option<WorkItemReference>,
    pub target: Option<WorkItemReference>,
}

/// One edge of a `FROM WorkItemLinks` query result; `source_id` is `None` for roots.
#[derive(Debug, PartialEq, Eq)]
pub struct WorkItemLink {
    pub source_id: Option<i64>,
    pub target_id: i64,
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
#[serde(rename_all = "camelCase")]
pub struct WorkItemWithRelations {
    pub id: i64,
    #[serde(default)]
    pub relations: Vec<WorkItemRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRelation {
    pub rel: String,
    pub url: String,
    #[serde(default)]
    pub attributes: Option<WorkItemRelationAttributes>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRelationAttributes {
    #[serde(default)]
    pub name: Option<String>,
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
    pub path: String,
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
#[serde(rename_all = "camelCase")]
pub struct WorkItemUpdatesList {
    #[serde(default)]
    pub value: Vec<WorkItemUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemUpdate {
    #[serde(default)]
    pub id: i64,
    pub revised_by: Option<CommentIdentityRef>,
    pub revised_date: Option<String>,
    #[serde(default)]
    pub fields: HashMap<String, WorkItemFieldUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldUpdate {
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeState {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemTypeStatesList {
    pub value: Vec<WorkItemTypeState>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemFieldDefinition {
    pub name: String,
    pub reference_name: String,
    #[serde(rename = "type")]
    pub field_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkItemTypeFieldValues {
    #[serde(default)]
    allowed_values: Vec<Value>,
}

#[derive(Debug, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub wiql: Option<String>,
}

impl AdoClient {
    pub async fn query_work_item_ids(
        &self,
        project_id: &str,
        wiql: &str,
        top: Option<usize>,
    ) -> Result<Vec<i64>> {
        let path = format!("{project_id}/_apis/wit/wiql");
        let top_string;
        let mut params: Vec<(&str, &str)> = vec![("api-version", "7.1-preview")];
        if let Some(top) = top {
            top_string = top.to_string();
            params.push(("$top", &top_string));
        }
        let response: WiqlResponse = self
            .post_json(
                &path,
                &params,
                &WiqlRequest {
                    query: wiql.to_string(),
                },
            )
            .await?;
        // A `FROM WorkItemLinks` query parses into an empty `work_items` with a
        // populated `work_item_relations`. Returning an empty id list there
        // hides the misuse, so surface it instead of silently yielding nothing.
        if response.work_items.is_empty() && !response.work_item_relations.is_empty() {
            return Err(AdoError::WiqlQueryShape(
                "query returned WorkItemLinks relations; use query_work_item_links for FROM WorkItemLinks queries".to_string(),
            ));
        }
        Ok(response
            .work_items
            .into_iter()
            .map(|item| item.id)
            .collect())
    }

    /// Runs a `FROM WorkItemLinks` WIQL query and returns the link edges in
    /// the order Azure DevOps reports them (tree order for recursive queries).
    pub async fn query_work_item_links(
        &self,
        project_id: &str,
        wiql: &str,
        top: Option<usize>,
    ) -> Result<Vec<WorkItemLink>> {
        let path = format!("{project_id}/_apis/wit/wiql");
        let top_string;
        let mut params: Vec<(&str, &str)> = vec![("api-version", "7.1-preview")];
        if let Some(top) = top {
            top_string = top.to_string();
            params.push(("$top", &top_string));
        }
        let response: WiqlResponse = self
            .post_json(
                &path,
                &params,
                &WiqlRequest {
                    query: wiql.to_string(),
                },
            )
            .await?;
        // A flat `FROM WorkItems` query parses into an empty
        // `work_item_relations` with a populated `work_items`. Surface that
        // misuse rather than silently returning no links.
        if response.work_item_relations.is_empty() && !response.work_items.is_empty() {
            return Err(AdoError::WiqlQueryShape(
                "query returned flat WorkItems; use query_work_item_ids for FROM WorkItems queries"
                    .to_string(),
            ));
        }
        Ok(response
            .work_item_relations
            .into_iter()
            .filter_map(|relation| {
                relation.target.map(|target| WorkItemLink {
                    source_id: relation.source.map(|source| source.id),
                    target_id: target.id,
                })
            })
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

        // The workitemsbatch API rejects requests with more than 200 ids, so
        // split larger id lists into chunks and concatenate the responses.
        let path = format!("{project_id}/_apis/wit/workitemsbatch");
        let mut items = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(WORK_ITEMS_BATCH_LIMIT) {
            let response: crate::git::ListResponse<WorkItem> = self
                .post_json(
                    &path,
                    &[("api-version", "7.1-preview")],
                    &WorkItemsBatchRequest {
                        ids: chunk.to_vec(),
                        fields: fields.clone(),
                    },
                )
                .await?;
            items.extend(response.value);
        }
        Ok(items)
    }

    pub async fn get_work_item_relations(
        &self,
        project_id: &str,
        work_item_id: i64,
    ) -> Result<Vec<WorkItemRelation>> {
        let path = format!("{project_id}/_apis/wit/workitems/{work_item_id}");
        let response: WorkItemWithRelations = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$expand", "relations")],
            )
            .await?;
        Ok(response.relations)
    }

    /// Adds a relation (link) to a work item via JSON Patch. `rel` is an Azure
    /// DevOps link type reference (e.g. System.LinkTypes.Related) and `url` is
    /// the related work item's REST URL.
    pub async fn add_work_item_relation(
        &self,
        project_id: &str,
        work_item_id: i64,
        rel: &str,
        url: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let body = json!([{
            "op": "add",
            "path": "/relations/-",
            "value": { "rel": rel, "url": url }
        }]);
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &body,
        )
        .await
    }

    /// Removes the relation at `index` (its position in the work item's
    /// `relations` array) via JSON Patch.
    pub async fn remove_work_item_relation(
        &self,
        project_id: &str,
        work_item_id: i64,
        index: usize,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let body = json!([{ "op": "remove", "path": format!("/relations/{index}") }]);
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &body,
        )
        .await
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

    pub async fn update_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            "application/json",
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
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

    pub async fn list_work_item_updates(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemUpdate>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/updates");
        let top_str = top.to_string();
        let response: WorkItemUpdatesList = self
            .get_json(&path, &[("api-version", "7.1-preview"), ("$top", &top_str)])
            .await?;
        Ok(response.value)
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
                path: "/fields/System.AssignedTo".to_string(),
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
                path: "/fields/System.State".to_string(),
                value: json!(state),
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
                path: "/fields/Microsoft.VSTS.Common.Priority".to_string(),
                value: json!(priority),
            }],
        )
        .await
    }

    /// Applies several field changes in a single JSON Patch request, so the
    /// whole update succeeds or fails atomically (state transition rules see
    /// all fields at once).
    pub async fn update_work_item_fields(
        &self,
        project_id: &str,
        work_item_id: i64,
        fields: &[(String, serde_json::Value)],
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let operations: Vec<WorkItemPatchOperation> = fields
            .iter()
            .map(|(reference_name, value)| WorkItemPatchOperation {
                op: "add",
                path: format!("/fields/{reference_name}"),
                value: value.clone(),
            })
            .collect();
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &operations,
        )
        .await
    }

    /// Returns the picklist values defined for a field on a work item type;
    /// empty when the field has no constrained value list.
    pub async fn list_work_item_type_field_allowed_values(
        &self,
        project_id: &str,
        work_item_type: &str,
        field_reference_name: &str,
    ) -> Result<Vec<String>> {
        let encoded_type = encode_path_segment(work_item_type);
        let encoded_field = encode_path_segment(field_reference_name);
        let path =
            format!("{project_id}/_apis/wit/workitemtypes/{encoded_type}/fields/{encoded_field}");
        let response: WorkItemTypeFieldValues = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$expand", "allowedValues")],
            )
            .await?;
        Ok(response
            .allowed_values
            .into_iter()
            .filter_map(|value| match value {
                Value::String(value) => Some(value),
                value if value.is_number() || value.is_boolean() => Some(value.to_string()),
                _ => None,
            })
            .collect())
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

    pub async fn list_work_item_fields(
        &self,
        project_id: &str,
    ) -> Result<Vec<WorkItemFieldDefinition>> {
        let path = format!("{project_id}/_apis/wit/fields");
        let response: crate::git::ListResponse<WorkItemFieldDefinition> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
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
            .list_work_item_type_field_allowed_values(
                "project-1",
                "User Story",
                "Custom.ReleaseTrain",
            )
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
}
