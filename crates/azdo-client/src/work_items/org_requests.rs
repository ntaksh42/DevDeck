//! Organization-level work item requests (no project in the path).
//!
//! Macros such as `@RecentMentions` are evaluated across the whole
//! organization, so one query answers "where was I mentioned" instead of one
//! query per project.

use crate::client::AdoClient;
use crate::error::Result;

use super::types::*;

/// Same limit the project-level batch uses.
const ORG_BATCH_LIMIT: usize = 200;

impl AdoClient {
    /// Runs a WIQL query against the organization (`/_apis/wit/wiql`) and
    /// returns the matching ids.
    pub async fn query_work_item_ids_org(
        &self,
        wiql: &str,
        top: Option<usize>,
    ) -> Result<Vec<i64>> {
        let top_string;
        let mut params: Vec<(&str, &str)> = vec![("api-version", "7.1-preview")];
        if let Some(top) = top {
            top_string = top.to_string();
            params.push(("$top", &top_string));
        }
        let response: WiqlResponse = self
            .post_json_read(
                "_apis/wit/wiql",
                &params,
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

    /// Fetches work items by id across projects (`/_apis/wit/workitemsbatch`).
    pub async fn get_work_items_batch_org(
        &self,
        ids: Vec<i64>,
        fields: Vec<String>,
    ) -> Result<Vec<WorkItem>> {
        let mut items = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(ORG_BATCH_LIMIT) {
            let response: crate::git::ListResponse<WorkItem> = self
                .post_json_read(
                    "_apis/wit/workitemsbatch",
                    &[("api-version", "7.1-preview")],
                    &WorkItemsBatchRequest {
                        ids: chunk.to_vec(),
                        fields: Some(fields.clone()),
                        expand: None,
                    },
                )
                .await?;
            items.extend(response.value);
        }
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
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
    async fn org_level_wiql_posts_without_a_project_segment() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/wit/wiql"))
            .and(query_param("api-version", "7.1-preview"))
            .and(query_param("$top", "50"))
            .and(body_json(serde_json::json!({
                "query": "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions)"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "workItems": [{ "id": 7 }, { "id": 9 }]
            })))
            .mount(&server)
            .await;

        let ids = test_client(&server)
            .await
            .query_work_item_ids_org(
                "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions)",
                Some(50),
            )
            .await
            .unwrap();
        assert_eq!(ids, vec![7, 9]);
    }

    #[tokio::test]
    async fn org_level_batch_posts_ids_and_fields() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/wit/workitemsbatch"))
            .and(body_json(serde_json::json!({
                "ids": [7],
                "fields": ["System.Title", "System.TeamProject"]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 7,
                    "fields": { "System.Title": "Bug", "System.TeamProject": "Platform" }
                }]
            })))
            .mount(&server)
            .await;

        let items = test_client(&server)
            .await
            .get_work_items_batch_org(
                vec![7],
                vec!["System.Title".into(), "System.TeamProject".into()],
            )
            .await
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, 7);
        assert_eq!(
            items[0]
                .fields
                .get("System.TeamProject")
                .and_then(|v| v.as_str()),
            Some("Platform")
        );
    }
}
