use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionData {
    pub authenticated_user: AuthenticatedUser,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedUser {
    pub id: String,
    pub provider_display_name: Option<String>,
    pub descriptor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: Option<String>,
    pub provider_display_name: Option<String>,
    pub custom_display_name: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum IdentitySearchResponse {
    Wrapped { value: Vec<Identity> },
    List(Vec<Identity>),
}

impl AdoClient {
    pub async fn connection_data(&self) -> Result<ConnectionData> {
        self.get_json("_apis/connectionData", &[("api-version", "7.1-preview")])
            .await
    }

    pub async fn search_identities(&self, query: &str, top: usize) -> Result<Vec<Identity>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let response: IdentitySearchResponse = self
            .get_json_vssps(
                "_apis/identities",
                &[
                    ("api-version", "7.1"),
                    ("searchFilter", "General"),
                    ("filterValue", query),
                    ("queryMembership", "None"),
                ],
            )
            .await?;
        let mut identities = match response {
            IdentitySearchResponse::Wrapped { value } => value,
            IdentitySearchResponse::List(value) => value,
        };
        identities.truncate(top);
        Ok(identities)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/testorg/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn search_identities_uses_general_filter() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("searchFilter", "General"))
            .and(query_param("filterValue", "alice"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "uniqueName": "alice@example.com"
                }
            ])))
            .mount(&server)
            .await;

        let identities = test_client(&server)
            .await
            .search_identities("alice", 8)
            .await
            .unwrap();
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].id.as_deref(), Some("user-1"));
        assert_eq!(
            identities[0].provider_display_name.as_deref(),
            Some("Alice Johnson")
        );
    }
}
