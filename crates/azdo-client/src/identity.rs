use std::collections::HashMap;

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
    pub properties: Option<HashMap<String, IdentityProperty>>,
}

#[derive(Debug, Deserialize)]
pub struct IdentityProperty {
    #[serde(rename = "$value")]
    pub value: Option<String>,
}

impl Identity {
    pub fn property_value(&self, name: &str) -> Option<&str> {
        let properties = self.properties.as_ref()?;
        properties
            .get(name)
            .or_else(|| {
                properties
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case(name))
                    .map(|(_, value)| value)
            })
            .and_then(|property| property.value.as_deref())
            .filter(|value| !value.trim().is_empty())
    }
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

        let mut identities = Vec::new();
        for search_filter in ["General", "DisplayName", "MailAddress", "AccountName"] {
            let batch = self
                .search_identities_with_filter(search_filter, query)
                .await?;
            for identity in batch {
                if !identity_is_duplicate(&identities, &identity) {
                    identities.push(identity);
                    if identities.len() >= top {
                        return Ok(identities);
                    }
                }
            }
            if !identities.is_empty() {
                break;
            }
        }
        Ok(identities)
    }

    async fn search_identities_with_filter(
        &self,
        search_filter: &str,
        query: &str,
    ) -> Result<Vec<Identity>> {
        let response: IdentitySearchResponse = self
            .get_json_vssps(
                "_apis/identities",
                &[
                    ("api-version", "7.1"),
                    ("searchFilter", search_filter),
                    ("filterValue", query),
                    ("queryMembership", "None"),
                ],
            )
            .await?;
        Ok(match response {
            IdentitySearchResponse::Wrapped { value } => value,
            IdentitySearchResponse::List(value) => value,
        })
    }
}

fn identity_is_duplicate(existing: &[Identity], candidate: &Identity) -> bool {
    existing.iter().any(|identity| {
        same_optional_identity_value(identity.id.as_deref(), candidate.id.as_deref())
            || same_optional_identity_value(
                identity.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || same_optional_identity_value(
                identity.property_value("Mail"),
                candidate.property_value("Mail"),
            )
            || same_optional_identity_value(
                identity.property_value("Account"),
                candidate.property_value("Account"),
            )
    })
}

fn same_optional_identity_value(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
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

    #[tokio::test]
    async fn search_identities_falls_back_to_display_name_filter() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("searchFilter", "General"))
            .and(query_param("filterValue", "alice"))
            .and(query_param("queryMembership", "None"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 0,
                "value": []
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("searchFilter", "DisplayName"))
            .and(query_param("filterValue", "alice"))
            .and(query_param("queryMembership", "None"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "properties": {
                        "Mail": { "$value": "alice@example.com" }
                    }
                }]
            })))
            .mount(&server)
            .await;

        let identities = test_client(&server)
            .await
            .search_identities("alice", 8)
            .await
            .unwrap();
        assert_eq!(identities.len(), 1);
        assert_eq!(
            identities[0].property_value("Mail"),
            Some("alice@example.com")
        );
    }
}
