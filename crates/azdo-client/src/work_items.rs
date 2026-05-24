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
}
