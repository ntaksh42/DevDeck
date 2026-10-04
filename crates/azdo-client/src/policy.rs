use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyType {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

/// One policy configuration (branch policy). `settings` is type specific, so it
/// stays raw JSON for the caller to summarize.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyConfiguration {
    pub id: i64,
    #[serde(default)]
    pub is_enabled: bool,
    #[serde(default)]
    pub is_blocking: bool,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(rename = "type")]
    pub policy_type: PolicyType,
    #[serde(default)]
    pub settings: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct PolicyList {
    #[serde(default)]
    value: Vec<PolicyConfiguration>,
}

impl AdoClient {
    /// Lists the policy configurations that apply to `ref_name` (the full ref
    /// name, e.g. `refs/heads/main`) in a repository.
    pub async fn list_branch_policies(
        &self,
        project_id: &str,
        repository_id: &str,
        ref_name: &str,
    ) -> Result<Vec<PolicyConfiguration>> {
        let path = format!("{project_id}/_apis/policy/configurations");
        let list: PolicyList = self
            .get_json(
                &path,
                &[
                    ("repositoryId", repository_id),
                    ("refName", ref_name),
                    ("api-version", "7.1"),
                ],
            )
            .await?;
        Ok(list.value)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::auth::PatProvider;
    use crate::client::AdoClient;

    #[tokio::test]
    async fn list_branch_policies_filters_by_repository_and_ref() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p-1/_apis/policy/configurations"))
            .and(query_param("repositoryId", "r-1"))
            .and(query_param("refName", "refs/heads/main"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": 7,
                    "isEnabled": true,
                    "isBlocking": true,
                    "isDeleted": false,
                    "type": { "id": "fa4e907d", "displayName": "Minimum number of reviewers" },
                    "settings": { "minimumApproverCount": 2 }
                }]
            })))
            .mount(&server)
            .await;
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let policies = client
            .list_branch_policies("p-1", "r-1", "refs/heads/main")
            .await
            .unwrap();

        assert_eq!(policies.len(), 1);
        assert!(policies[0].is_blocking);
        assert_eq!(
            policies[0].policy_type.display_name.as_deref(),
            Some("Minimum number of reviewers")
        );
        assert_eq!(policies[0].settings["minimumApproverCount"], 2);
    }
}
