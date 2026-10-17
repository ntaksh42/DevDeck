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

/// The result of one policy configuration evaluated against a pull request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvaluation {
    /// `approved` | `rejected` | `running` | `queued` | `notApplicable` | `broken`.
    #[serde(default)]
    pub status: Option<String>,
    pub configuration: PolicyConfiguration,
}

#[derive(Debug, Deserialize)]
struct PolicyEvaluationList {
    #[serde(default)]
    value: Vec<PolicyEvaluation>,
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

    /// Lists how each policy evaluates for one pull request (the "merge
    /// requirements" the web UI shows). The artifact id is the code review id
    /// `vstfs:///CodeReview/CodeReviewId/{projectId}/{pullRequestId}`.
    pub async fn list_pull_request_policy_evaluations(
        &self,
        project_id: &str,
        pull_request_id: i64,
    ) -> Result<Vec<PolicyEvaluation>> {
        let path = format!("{project_id}/_apis/policy/evaluations");
        let artifact_id =
            format!("vstfs:///CodeReview/CodeReviewId/{project_id}/{pull_request_id}");
        let list: PolicyEvaluationList = self
            .get_json(
                &path,
                &[
                    ("artifactId", artifact_id.as_str()),
                    ("api-version", "7.1-preview.1"),
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
    #[tokio::test]
    async fn list_pull_request_policy_evaluations_uses_the_code_review_artifact_id() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p-1/_apis/policy/evaluations"))
            .and(query_param(
                "artifactId",
                "vstfs:///CodeReview/CodeReviewId/p-1/42",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 2,
                "value": [
                    {
                        "status": "rejected",
                        "configuration": {
                            "id": 7,
                            "isEnabled": true,
                            "isBlocking": true,
                            "type": { "id": "fa4e907d", "displayName": "Minimum number of reviewers" },
                            "settings": { "minimumApproverCount": 2 }
                        }
                    },
                    {
                        "status": "approved",
                        "configuration": {
                            "id": 8,
                            "isEnabled": true,
                            "isBlocking": false,
                            "type": { "id": "0609b952", "displayName": "Build" }
                        }
                    }
                ]
            })))
            .mount(&server)
            .await;
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let evaluations = client
            .list_pull_request_policy_evaluations("p-1", 42)
            .await
            .unwrap();

        assert_eq!(evaluations.len(), 2);
        assert_eq!(evaluations[0].status.as_deref(), Some("rejected"));
        assert!(evaluations[0].configuration.is_blocking);
        assert_eq!(
            evaluations[0].configuration.settings["minimumApproverCount"],
            2
        );
        assert!(!evaluations[1].configuration.is_blocking);
    }
}
