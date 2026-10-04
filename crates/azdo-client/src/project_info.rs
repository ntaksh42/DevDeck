//! Read-only project information: teams and their members, service
//! connections, and service hook subscriptions (issue #541).

use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTeam {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberIdentity {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub unique_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub identity: TeamMemberIdentity,
    #[serde(default)]
    pub is_team_admin: bool,
}

/// A service connection. Credentials (`authorization`, `data`) are never read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEndpoint {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default)]
    pub endpoint_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_ready: bool,
    #[serde(default)]
    pub is_shared: bool,
}

/// A service hook subscription. `consumerInputs` (webhook URLs, tokens) is
/// deliberately not modelled.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHookSubscription {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub publisher_id: Option<String>,
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub consumer_id: Option<String>,
    #[serde(default)]
    pub consumer_action_id: Option<String>,
    /// Filters on the publisher side; `projectId` scopes it to one project.
    #[serde(default)]
    pub publisher_inputs: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ValueList<T> {
    #[serde(default = "Vec::new")]
    value: Vec<T>,
}

impl AdoClient {
    pub async fn list_project_teams(&self, project_id: &str) -> Result<Vec<ProjectTeam>> {
        let path = format!("_apis/projects/{project_id}/teams");
        let list: ValueList<ProjectTeam> = self
            .get_json(&path, &[("api-version", "7.1"), ("$top", "100")])
            .await?;
        Ok(list.value)
    }

    pub async fn list_team_members(
        &self,
        project_id: &str,
        team_id: &str,
    ) -> Result<Vec<TeamMember>> {
        let path = format!("_apis/projects/{project_id}/teams/{team_id}/members");
        let list: ValueList<TeamMember> = self
            .get_json(&path, &[("api-version", "7.1"), ("$top", "100")])
            .await?;
        Ok(list.value)
    }

    pub async fn list_service_endpoints(&self, project_id: &str) -> Result<Vec<ServiceEndpoint>> {
        let path = format!("{project_id}/_apis/serviceendpoint/endpoints");
        let list: ValueList<ServiceEndpoint> =
            self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(list.value)
    }

    /// Lists the organization's service hook subscriptions; callers narrow them
    /// to a project through `publisher_inputs["projectId"]`.
    pub async fn list_service_hook_subscriptions(&self) -> Result<Vec<ServiceHookSubscription>> {
        let list: ValueList<ServiceHookSubscription> = self
            .get_json("_apis/hooks/subscriptions", &[("api-version", "7.1")])
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

    async fn client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn lists_teams_and_their_members() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects/p-1/teams"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{ "id": "t-1", "name": "Platform Team", "description": "Core" }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects/p-1/teams/t-1/members"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    { "identity": { "displayName": "Ann", "uniqueName": "ann@contoso.com" }, "isTeamAdmin": true },
                    { "identity": { "displayName": "Bob" } }
                ]
            })))
            .mount(&server)
            .await;
        let client = client(&server).await;

        let teams = client.list_project_teams("p-1").await.unwrap();
        assert_eq!(teams[0].name, "Platform Team");
        let members = client.list_team_members("p-1", "t-1").await.unwrap();
        assert_eq!(members.len(), 2);
        assert!(members[0].is_team_admin);
        assert_eq!(members[1].identity.unique_name, None);
    }

    #[tokio::test]
    async fn lists_service_endpoints_without_reading_credentials() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p-1/_apis/serviceendpoint/endpoints"))
            .and(query_param("api-version", "7.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "e-1", "name": "Azure prod", "type": "azurerm",
                    "isReady": true, "isShared": false,
                    "authorization": { "scheme": "ServicePrincipal", "parameters": { "serviceprincipalid": "x" } }
                }]
            })))
            .mount(&server)
            .await;

        let endpoints = client(&server)
            .await
            .list_service_endpoints("p-1")
            .await
            .unwrap();

        assert_eq!(endpoints[0].endpoint_type.as_deref(), Some("azurerm"));
        assert!(endpoints[0].is_ready);
    }

    #[tokio::test]
    async fn lists_service_hook_subscriptions() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/hooks/subscriptions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{
                    "id": "s-1", "status": "enabled",
                    "publisherId": "tfs", "eventType": "git.pullrequest.created",
                    "consumerId": "slack", "consumerActionId": "postMessageToChannel",
                    "publisherInputs": { "projectId": "p-1" },
                    "consumerInputs": { "url": "https://hooks.example/secret-token" }
                }]
            })))
            .mount(&server)
            .await;

        let hooks = client(&server)
            .await
            .list_service_hook_subscriptions()
            .await
            .unwrap();

        assert_eq!(
            hooks[0].event_type.as_deref(),
            Some("git.pullrequest.created")
        );
        assert_eq!(
            hooks[0]
                .publisher_inputs
                .get("projectId")
                .and_then(|value| value.as_str()),
            Some("p-1")
        );
    }
}
