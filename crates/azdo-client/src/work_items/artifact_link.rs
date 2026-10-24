use serde_json::json;

use super::types::WorkItem;
use crate::client::AdoClient;
use crate::error::Result;

impl AdoClient {
    /// Adds an `ArtifactLink` (e.g. a Git branch, which the web UI shows in the
    /// Development section) to a work item. `name` is the link's display kind,
    /// such as `Branch`.
    pub async fn add_work_item_artifact_link(
        &self,
        project_id: &str,
        work_item_id: i64,
        artifact_url: &str,
        name: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let body = json!([{
            "op": "add",
            "path": "/relations/-",
            "value": {
                "rel": "ArtifactLink",
                "url": artifact_url,
                "attributes": { "name": name }
            }
        }]);
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &body,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::auth::PatProvider;
    use crate::client::AdoClient;

    #[tokio::test]
    async fn artifact_link_is_added_with_the_branch_name_attribute() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/project-1/_apis/wit/workItems/10"))
            .and(body_json(serde_json::json!([{
                "op": "add",
                "path": "/relations/-",
                "value": {
                    "rel": "ArtifactLink",
                    "url": "vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F10-fix",
                    "attributes": { "name": "Branch" }
                }
            }])))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 10,
                "fields": { "System.Title": "Fix bug" }
            })))
            .mount(&server)
            .await;
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let item = client
            .add_work_item_artifact_link(
                "project-1",
                10,
                "vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F10-fix",
                "Branch",
            )
            .await
            .unwrap();
        assert_eq!(item.id, 10);
    }
}
