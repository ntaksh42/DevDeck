use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

/// Descriptors per lookup request, to keep the query string a sane length.
const DESCRIPTOR_CHUNK: usize = 40;

#[derive(Debug, Deserialize)]
struct IdentityList {
    #[serde(default)]
    value: Vec<IdentityMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityMembership {
    id: Option<String>,
    #[serde(default)]
    member_of: Vec<String>,
}

impl AdoClient {
    /// Ids of every group/team the identity belongs to (transitively). Pull
    /// requests assigned to such a group never match a `reviewerId` filter on the
    /// member, so callers use these ids to find them in a wider PR list.
    pub async fn list_member_group_ids(&self, user_id: &str) -> Result<Vec<String>> {
        let user: IdentityList = self
            .get_json_vssps(
                "_apis/identities",
                &[
                    ("api-version", "7.1"),
                    ("identityIds", user_id),
                    ("queryMembership", "Expanded"),
                ],
            )
            .await?;
        let descriptors: Vec<String> = user
            .value
            .into_iter()
            .flat_map(|identity| identity.member_of)
            .collect();

        let mut ids = Vec::new();
        for chunk in descriptors.chunks(DESCRIPTOR_CHUNK) {
            let joined = chunk.join(",");
            let groups: IdentityList = self
                .get_json_vssps(
                    "_apis/identities",
                    &[
                        ("api-version", "7.1"),
                        ("descriptors", joined.as_str()),
                        ("queryMembership", "None"),
                    ],
                )
                .await?;
            ids.extend(groups.value.into_iter().filter_map(|group| group.id));
        }
        Ok(ids)
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
    async fn member_group_ids_resolve_descriptors_to_ids() {
        let server = MockServer::start().await;
        let base_url = Url::parse(&format!("{}/testorg/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("identityIds", "user-1"))
            .and(query_param("queryMembership", "Expanded"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "user-1", "memberOf": ["vssgp.A", "vssgp.B"] }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .and(query_param("descriptors", "vssgp.A,vssgp.B"))
            .and(query_param("queryMembership", "None"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "group-a" }, { "id": "group-b" }]
            })))
            .mount(&server)
            .await;

        let ids = client.list_member_group_ids("user-1").await.unwrap();
        assert_eq!(ids, vec!["group-a".to_string(), "group-b".to_string()]);
    }

    #[tokio::test]
    async fn member_group_ids_empty_when_user_has_no_groups() {
        let server = MockServer::start().await;
        let base_url = Url::parse(&format!("{}/testorg/", server.uri())).unwrap();
        let client = AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/identities"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "user-1" }]
            })))
            .mount(&server)
            .await;

        assert!(client
            .list_member_group_ids("user-1")
            .await
            .unwrap()
            .is_empty());
    }
}
