use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}
