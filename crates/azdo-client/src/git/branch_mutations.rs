//! Branch create/delete via the Git "Update Refs" API: a single POST that
//! creates, updates, or deletes a ref depending on the old/new object ids
//! supplied. Creating a branch sends the all-zero object id as `oldObjectId`
//! with the source commit as `newObjectId`; deleting reverses that. See the
//! Azure DevOps REST docs for Git Refs - Update Refs.
use serde::Serialize;

use crate::client::AdoClient;
use crate::error::{AdoError, Result};

use super::{GitRefUpdateResult, ListResponse};

/// The all-zero object id Azure DevOps uses to mean "this ref does not exist
/// yet" (for creates) or "this ref should no longer exist" (for deletes).
const ZERO_OBJECT_ID: &str = "0000000000000000000000000000000000000000";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRefUpdate<'a> {
    name: &'a str,
    old_object_id: &'a str,
    new_object_id: &'a str,
}

impl AdoClient {
    /// Creates `refs/heads/{branch_name}` pointing at `source_object_id` (the
    /// tip commit of the branch/commit it is created from).
    pub async fn create_branch(
        &self,
        project_id: &str,
        repository_id: &str,
        branch_name: &str,
        source_object_id: &str,
    ) -> Result<GitRefUpdateResult> {
        let ref_name = format!("refs/heads/{branch_name}");
        self.update_ref(
            project_id,
            repository_id,
            &ref_name,
            ZERO_OBJECT_ID,
            source_object_id,
        )
        .await
    }

    /// Deletes `refs/heads/{branch_name}`, currently at `current_object_id`.
    pub async fn delete_branch(
        &self,
        project_id: &str,
        repository_id: &str,
        branch_name: &str,
        current_object_id: &str,
    ) -> Result<GitRefUpdateResult> {
        let ref_name = format!("refs/heads/{branch_name}");
        self.update_ref(
            project_id,
            repository_id,
            &ref_name,
            current_object_id,
            ZERO_OBJECT_ID,
        )
        .await
    }

    async fn update_ref(
        &self,
        project_id: &str,
        repository_id: &str,
        ref_name: &str,
        old_object_id: &str,
        new_object_id: &str,
    ) -> Result<GitRefUpdateResult> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/refs");
        let body = [GitRefUpdate {
            name: ref_name,
            old_object_id,
            new_object_id,
        }];
        let response: ListResponse<GitRefUpdateResult> = self
            .post_json(&path, &[("api-version", "7.1-preview")], &body)
            .await?;
        // The API always returns 200 even when the update is rejected (e.g. a
        // stale old object id or a branch policy); `success`/`updateStatus`
        // carry the real outcome, so check them explicitly.
        let result = response.value.into_iter().next().ok_or_else(|| {
            AdoError::RefUpdateRejected(
                "Azure DevOps returned no result for the ref update.".to_string(),
            )
        })?;
        if !result.success {
            let message = result
                .custom_message
                .clone()
                .unwrap_or_else(|| result.update_status.clone());
            return Err(AdoError::RefUpdateRejected(message));
        }
        Ok(result)
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
    async fn create_branch_sends_zero_old_object_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/project-1/_apis/git/repositories/repo-1/refs"))
            .and(query_param("api-version", "7.1-preview"))
            .and(body_json(serde_json::json!([{
                "name": "refs/heads/feature/new",
                "oldObjectId": ZERO_OBJECT_ID,
                "newObjectId": "abc123",
            }])))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "name": "refs/heads/feature/new",
                    "updateStatus": "succeeded",
                    "success": true,
                }]
            })))
            .mount(&server)
            .await;

        let result = test_client(&server)
            .await
            .create_branch("project-1", "repo-1", "feature/new", "abc123")
            .await
            .unwrap();
        assert!(result.success);
        assert_eq!(result.name, "refs/heads/feature/new");
    }

    #[tokio::test]
    async fn delete_branch_sends_zero_new_object_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/project-1/_apis/git/repositories/repo-1/refs"))
            .and(body_json(serde_json::json!([{
                "name": "refs/heads/feature/old",
                "oldObjectId": "def456",
                "newObjectId": ZERO_OBJECT_ID,
            }])))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "name": "refs/heads/feature/old",
                    "updateStatus": "succeeded",
                    "success": true,
                }]
            })))
            .mount(&server)
            .await;

        let result = test_client(&server)
            .await
            .delete_branch("project-1", "repo-1", "feature/old", "def456")
            .await
            .unwrap();
        assert!(result.success);
    }

    #[tokio::test]
    async fn update_ref_fails_when_server_rejects_the_update() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/project-1/_apis/git/repositories/repo-1/refs"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "name": "refs/heads/feature/old",
                    "updateStatus": "staleOldObjectId",
                    "success": false,
                    "customMessage": "The old object id did not match the current ref.",
                }]
            })))
            .mount(&server)
            .await;

        let error = test_client(&server)
            .await
            .delete_branch("project-1", "repo-1", "feature/old", "stale-sha")
            .await
            .unwrap_err();
        match error {
            AdoError::RefUpdateRejected(message) => {
                assert_eq!(message, "The old object id did not match the current ref.");
            }
            other => panic!("expected RefUpdateRejected, got {other:?}"),
        }
    }
}
