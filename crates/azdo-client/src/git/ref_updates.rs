//! Creating and deleting refs (`POST .../refs`): the Git ref-update primitive
//! behind branch creation and deletion.

use serde::{Deserialize, Serialize};

use crate::client::AdoClient;
use crate::error::Result;

use super::ListResponse;

/// The object id Git uses for "no object": as `old_object_id` it means the ref
/// must not exist yet, as `new_object_id` it deletes the ref.
pub const ZERO_OBJECT_ID: &str = "0000000000000000000000000000000000000000";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefUpdate<'a> {
    name: &'a str,
    old_object_id: &'a str,
    new_object_id: &'a str,
}

/// The outcome of one ref update. Azure DevOps answers 200 even when the update
/// was refused, so `success` / `update_status` carry the verdict.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefUpdateResult {
    #[serde(default)]
    pub success: bool,
    /// e.g. `created`, `deleted`, `staleOldObjectId`, `invalidRefName`.
    pub update_status: Option<String>,
    pub custom_message: Option<String>,
}

impl AdoClient {
    /// Moves one ref from `old_object_id` to `new_object_id` (use
    /// [`ZERO_OBJECT_ID`] to create or delete). `ref_name` is the full name,
    /// e.g. `refs/heads/feature/x`.
    pub async fn update_ref(
        &self,
        project_id: &str,
        repository_id: &str,
        ref_name: &str,
        old_object_id: &str,
        new_object_id: &str,
    ) -> Result<GitRefUpdateResult> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/refs");
        let body = [RefUpdate {
            name: ref_name,
            old_object_id,
            new_object_id,
        }];
        let response: ListResponse<GitRefUpdateResult> = self
            .post_json(&path, &[("api-version", "7.1")], &body)
            .await?;
        Ok(response
            .value
            .into_iter()
            .next()
            .unwrap_or(GitRefUpdateResult {
                success: false,
                update_status: None,
                custom_message: None,
            }))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_json, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::ZERO_OBJECT_ID;
    use crate::auth::PatProvider;
    use crate::client::AdoClient;

    async fn client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn creating_a_ref_sends_the_zero_old_id_and_reports_success() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/proj/_apis/git/repositories/repo/refs"))
            .and(query_param("api-version", "7.1"))
            .and(body_json(serde_json::json!([{
                "name": "refs/heads/feature/x",
                "oldObjectId": ZERO_OBJECT_ID,
                "newObjectId": "abc123"
            }])))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "success": true, "updateStatus": "succeeded" }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let result = client(&server)
            .await
            .update_ref(
                "proj",
                "repo",
                "refs/heads/feature/x",
                ZERO_OBJECT_ID,
                "abc123",
            )
            .await
            .unwrap();
        assert!(result.success);
    }

    #[tokio::test]
    async fn a_refused_update_is_reported_not_raised() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/proj/_apis/git/repositories/repo/refs"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{
                    "success": false,
                    "updateStatus": "staleOldObjectId",
                    "customMessage": "The branch moved"
                }]
            })))
            .mount(&server)
            .await;

        let result = client(&server)
            .await
            .update_ref("proj", "repo", "refs/heads/x", "old", ZERO_OBJECT_ID)
            .await
            .unwrap();
        assert!(!result.success);
        assert_eq!(result.update_status.as_deref(), Some("staleOldObjectId"));
        assert_eq!(result.custom_message.as_deref(), Some("The branch moved"));
    }
}
