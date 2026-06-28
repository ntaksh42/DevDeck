use std::sync::Arc;

use url::Url;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::helpers::identity_search_rank;
use super::Identity;
use crate::auth::PatProvider;
use crate::client::AdoClient;

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
            "operationScopes": ["ims"],
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
async fn search_identity_picker_skips_request_for_blank_query() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/testorg/_apis/IdentityPicker/Identities"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    for query in ["", "   "] {
        let identities = client.search_identity_picker(query, 40).await.unwrap();
        assert!(identities.is_empty());
    }
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
