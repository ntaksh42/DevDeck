use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub properties: Option<HashMap<String, IdentityProperty>>,
}

impl AuthenticatedUser {
    pub fn property_value(&self, name: &str) -> Option<&str> {
        property_value(self.properties.as_ref()?, name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: Option<String>,
    pub descriptor: Option<String>,
    pub subject_descriptor: Option<String>,
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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPickerIdentity {
    #[serde(default, alias = "entityId")]
    pub entity_id: Option<String>,
    #[serde(default, alias = "originId")]
    pub origin_id: Option<String>,
    #[serde(default, alias = "localId")]
    pub local_id: Option<String>,
    #[serde(default, alias = "subjectDescriptor")]
    pub subject_descriptor: Option<String>,
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, alias = "mailAddress", alias = "mail")]
    pub mail_address: Option<String>,
    #[serde(default, alias = "signInAddress")]
    pub sign_in_address: Option<String>,
    #[serde(default, alias = "entityType")]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityPickerRequest<'a> {
    query: &'a str,
    identity_types: [&'static str; 1],
    operation_scopes: [&'static str; 2],
    options: IdentityPickerOptions,
    properties: [&'static str; 17],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct IdentityPickerOptions {
    min_results: usize,
    max_results: usize,
}

impl Identity {
    pub fn property_value(&self, name: &str) -> Option<&str> {
        property_value(self.properties.as_ref()?, name)
    }
}

fn property_value<'a>(
    properties: &'a HashMap<String, IdentityProperty>,
    name: &str,
) -> Option<&'a str> {
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
        if query.is_empty() || top == 0 {
            return Ok(Vec::new());
        }

        let mut identities = Vec::new();
        for search_filter in identity_search_filters(query) {
            let batch = self
                .search_identities_with_filter(search_filter, query)
                .await?;
            for identity in batch {
                if !identity_is_duplicate(&identities, &identity) {
                    identities.push(identity);
                }
            }
        }
        identities.sort_by_key(|identity| identity_search_rank(identity, query));
        identities.truncate(top);
        Ok(identities)
    }

    pub async fn search_identity_picker(
        &self,
        query: &str,
        top: usize,
    ) -> Result<Vec<IdentityPickerIdentity>> {
        if top == 0 {
            return Ok(Vec::new());
        }

        let max_results = top.clamp(5, 40);
        let response: Value = self
            .post_json(
                "_apis/IdentityPicker/Identities",
                &[("api-version", "5.0-preview.1")],
                &IdentityPickerRequest {
                    query: query.trim(),
                    identity_types: ["user"],
                    operation_scopes: ["ims", "source"],
                    options: IdentityPickerOptions {
                        min_results: 5,
                        max_results,
                    },
                    properties: [
                        "DisplayName",
                        "IsMru",
                        "ScopeName",
                        "SamAccountName",
                        "Active",
                        "SubjectDescriptor",
                        "Department",
                        "JobTitle",
                        "Mail",
                        "MailNickname",
                        "PhysicalDeliveryOfficeName",
                        "SignInAddress",
                        "Surname",
                        "Guest",
                        "TelephoneNumber",
                        "Manager",
                        "Description",
                    ],
                },
            )
            .await?;

        let mut identities = Vec::new();
        collect_identity_picker_identities(&response, &mut identities);
        identities.truncate(top);
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

fn collect_identity_picker_identities(value: &Value, identities: &mut Vec<IdentityPickerIdentity>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_identity_picker_identities(item, identities);
            }
        }
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("identities") {
                for item in items {
                    if let Some(identity) = identity_picker_identity_from_value(item) {
                        identities.push(identity);
                    }
                }
            }
            for child in map.values() {
                collect_identity_picker_identities(child, identities);
            }
        }
        _ => {}
    }
}

fn identity_picker_identity_from_value(value: &Value) -> Option<IdentityPickerIdentity> {
    let mut identity: IdentityPickerIdentity = serde_json::from_value(value.clone()).ok()?;
    if let Some(properties) = value.get("properties") {
        identity.display_name = identity
            .display_name
            .or_else(|| picker_property(properties, "DisplayName"));
        identity.mail_address = identity
            .mail_address
            .or_else(|| picker_property(properties, "Mail"));
        identity.sign_in_address = identity
            .sign_in_address
            .or_else(|| picker_property(properties, "SignInAddress"));
        identity.subject_descriptor = identity
            .subject_descriptor
            .or_else(|| picker_property(properties, "SubjectDescriptor"));
        identity.active = identity
            .active
            .or_else(|| picker_bool_property(properties, "Active"));
    }
    identity_picker_identity_is_user(&identity).then_some(identity)
}

fn identity_picker_identity_is_user(identity: &IdentityPickerIdentity) -> bool {
    let user_type = identity
        .entity_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none_or(|value| value.eq_ignore_ascii_case("user"));
    user_type && identity.active != Some(false)
}

fn picker_property(properties: &Value, name: &str) -> Option<String> {
    let property = properties
        .as_object()?
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value))?;
    property
        .get("$value")
        .or_else(|| property.get("value"))
        .and_then(Value::as_str)
        .or_else(|| property.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn picker_bool_property(properties: &Value, name: &str) -> Option<bool> {
    let property = properties
        .as_object()?
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value))?;
    property
        .get("$value")
        .or_else(|| property.get("value"))
        .and_then(Value::as_bool)
        .or_else(|| property.as_bool())
        .or_else(|| {
            property
                .get("$value")
                .or_else(|| property.get("value"))
                .and_then(Value::as_str)
                .or_else(|| property.as_str())
                .and_then(|value| value.parse::<bool>().ok())
        })
}

fn identity_search_filters(query: &str) -> &'static [&'static str] {
    if query.contains('@') {
        &["MailAddress", "General", "AccountName", "DisplayName"]
    } else {
        &["General", "DisplayName", "MailAddress", "AccountName"]
    }
}

fn identity_search_rank(identity: &Identity, query: &str) -> usize {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return 0;
    }

    let values = [
        identity.provider_display_name.as_deref(),
        identity.custom_display_name.as_deref(),
        identity.display_name.as_deref(),
        identity.unique_name.as_deref(),
        identity.property_value("Mail"),
        identity.property_value("Account"),
        identity.property_value("Alias"),
    ];

    if values
        .iter()
        .flatten()
        .any(|value| value.eq_ignore_ascii_case(&query))
    {
        return 0;
    }
    if values
        .iter()
        .flatten()
        .any(|value| value.to_ascii_lowercase().starts_with(&query))
    {
        return 1;
    }
    2
}

fn identity_is_duplicate(existing: &[Identity], candidate: &Identity) -> bool {
    existing.iter().any(|identity| {
        same_optional_identity_value(identity.id.as_deref(), candidate.id.as_deref())
            || same_optional_identity_value(
                identity.descriptor.as_deref(),
                candidate.descriptor.as_deref(),
            )
            || same_optional_identity_value(
                identity.subject_descriptor.as_deref(),
                candidate.subject_descriptor.as_deref(),
            )
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
    use wiremock::matchers::{body_json, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/testorg/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    async fn mock_identity_search(
        server: &MockServer,
        search_filter: &str,
        query: &str,
        body: serde_json::Value,
    ) {
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("searchFilter", search_filter))
            .and(query_param("filterValue", query))
            .and(query_param("queryMembership", "None"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    async fn mock_empty_identity_search_filters(server: &MockServer, query: &str, except: &[&str]) {
        for search_filter in ["General", "DisplayName", "MailAddress", "AccountName"] {
            if except.contains(&search_filter) {
                continue;
            }
            mock_identity_search(
                server,
                search_filter,
                query,
                serde_json::json!({
                    "count": 0,
                    "value": []
                }),
            )
            .await;
        }
    }

    #[tokio::test]
    async fn search_identity_picker_posts_web_ui_payload_and_maps_properties() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/testorg/_apis/IdentityPicker/Identities"))
            .and(query_param("api-version", "5.0-preview.1"))
            .and(body_json(serde_json::json!({
                "query": "alice",
                "identityTypes": ["user"],
                "operationScopes": ["ims", "source"],
                "options": {
                    "MinResults": 5,
                    "MaxResults": 40
                },
                "properties": [
                    "DisplayName",
                    "IsMru",
                    "ScopeName",
                    "SamAccountName",
                    "Active",
                    "SubjectDescriptor",
                    "Department",
                    "JobTitle",
                    "Mail",
                    "MailNickname",
                    "PhysicalDeliveryOfficeName",
                    "SignInAddress",
                    "Surname",
                    "Guest",
                    "TelephoneNumber",
                    "Manager",
                    "Description"
                ]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [
                    {
                        "identities": [
                            {
                                "entityId": "entity-1",
                                "displayName": "Alice Johnson",
                                "properties": {
                                    "Active": { "$value": true },
                                    "Mail": { "$value": "alice@example.com" },
                                    "SubjectDescriptor": { "$value": "aad.alice" }
                                }
                            }
                        ]
                    }
                ]
            })))
            .mount(&server)
            .await;

        let identities = test_client(&server)
            .await
            .search_identity_picker("alice", 40)
            .await
            .unwrap();

        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].display_name.as_deref(), Some("Alice Johnson"));
        assert_eq!(
            identities[0].mail_address.as_deref(),
            Some("alice@example.com")
        );
        assert_eq!(
            identities[0].subject_descriptor.as_deref(),
            Some("aad.alice")
        );
        assert_eq!(identities[0].active, Some(true));
    }

    #[tokio::test]
    async fn search_identity_picker_filters_non_user_and_inactive_identities() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/testorg/_apis/IdentityPicker/Identities"))
            .and(query_param("api-version", "5.0-preview.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [
                    {
                        "identities": [
                            {
                                "entityId": "wiki-1",
                                "displayName": "Project Wiki",
                                "entityType": "Wiki",
                                "properties": {
                                    "Active": { "$value": true }
                                }
                            },
                            {
                                "entityId": "inactive-1",
                                "displayName": "Inactive User",
                                "entityType": "User",
                                "properties": {
                                    "Active": { "$value": false }
                                }
                            },
                            {
                                "entityId": "user-1",
                                "displayName": "Alice Johnson",
                                "entityType": "User",
                                "properties": {
                                    "Active": { "$value": true },
                                    "SubjectDescriptor": { "$value": "aad.alice" }
                                }
                            }
                        ]
                    }
                ]
            })))
            .mount(&server)
            .await;

        let identities = test_client(&server)
            .await
            .search_identity_picker("alice", 40)
            .await
            .unwrap();

        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].display_name.as_deref(), Some("Alice Johnson"));
    }

    #[tokio::test]
    async fn search_identities_uses_general_filter() {
        let server = MockServer::start().await;
        mock_identity_search(
            &server,
            "General",
            "alice",
            serde_json::json!([
                {
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "uniqueName": "alice@example.com"
                }
            ]),
        )
        .await;
        mock_empty_identity_search_filters(&server, "alice", &["General"]).await;

        let identities = test_client(&server)
            .await
            .search_identities("alice", 1)
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
        mock_empty_identity_search_filters(&server, "alice", &["DisplayName"]).await;
        mock_identity_search(
            &server,
            "DisplayName",
            "alice",
            serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "properties": {
                        "Mail": { "$value": "alice@example.com" }
                    }
                }]
            }),
        )
        .await;

        let identities = test_client(&server)
            .await
            .search_identities("alice", 1)
            .await
            .unwrap();
        assert_eq!(identities.len(), 1);
        assert_eq!(
            identities[0].property_value("Mail"),
            Some("alice@example.com")
        );
    }

    #[tokio::test]
    async fn search_identities_keeps_searching_after_general_matches() {
        let server = MockServer::start().await;
        mock_identity_search(
            &server,
            "General",
            "alice",
            serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "group-1",
                    "providerDisplayName": "Alice Team"
                }]
            }),
        )
        .await;
        mock_identity_search(
            &server,
            "DisplayName",
            "alice",
            serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "uniqueName": "alice@example.com"
                }]
            }),
        )
        .await;
        mock_empty_identity_search_filters(&server, "alice", &["General", "DisplayName"]).await;

        let identities = test_client(&server)
            .await
            .search_identities("alice", 2)
            .await
            .unwrap();
        assert_eq!(identities.len(), 2);
        assert_eq!(identities[1].id.as_deref(), Some("user-1"));
    }

    #[tokio::test]
    async fn search_identities_prioritizes_mail_filter_for_email_queries() {
        let server = MockServer::start().await;
        mock_identity_search(
            &server,
            "MailAddress",
            "alice@example.com",
            serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "user-1",
                    "providerDisplayName": "Alice Johnson",
                    "properties": {
                        "Mail": { "$value": "alice@example.com" }
                    }
                }]
            }),
        )
        .await;
        mock_empty_identity_search_filters(&server, "alice@example.com", &["MailAddress"]).await;

        let identities = test_client(&server)
            .await
            .search_identities("alice@example.com", 1)
            .await
            .unwrap();
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].id.as_deref(), Some("user-1"));
    }

    #[test]
    fn identity_search_rank_prefers_exact_and_prefix_matches() {
        let exact = Identity {
            id: Some("user-1".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Alice Johnson".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: None,
            properties: None,
        };
        let loose = Identity {
            id: Some("user-2".to_string()),
            descriptor: None,
            subject_descriptor: None,
            provider_display_name: Some("Team Alice Support".to_string()),
            custom_display_name: None,
            display_name: None,
            unique_name: None,
            properties: None,
        };

        assert!(identity_search_rank(&exact, "Alice") < identity_search_rank(&loose, "Alice"));
    }
}
