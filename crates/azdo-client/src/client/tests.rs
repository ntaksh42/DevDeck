use super::helpers::parse_retry_after;
use super::*;
use crate::auth::PatProvider;
use crate::identity::ConnectionData;
use reqwest::header::HeaderMap;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
        .with_retry_policy(RetryPolicy::no_retries())
}

async fn retrying_test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
        .with_retry_policy(RetryPolicy {
            max_attempts: 2,
            base_delay: Duration::ZERO,
            max_delay: Duration::ZERO,
            retry_after_cap: Duration::ZERO,
        })
}

#[tokio::test]
async fn connection_data_ok() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .and(header("Authorization", "Basic OnRlc3QtcGF0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "authenticatedUser": {
                "id": "d6245f20-2af8-44f4-9451-8107cb2767db",
                "providerDisplayName": "Test User",
                "descriptor": "aad.abc123"
            }
        })))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let data: ConnectionData = client.connection_data().await.unwrap();
    assert_eq!(
        data.authenticated_user.id,
        "d6245f20-2af8-44f4-9451-8107cb2767db"
    );
    assert_eq!(
        data.authenticated_user.provider_display_name.as_deref(),
        Some("Test User")
    );
}

#[tokio::test]
async fn get_text_returns_plain_body() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/build/builds/9/logs/3"))
        .respond_with(ResponseTemplate::new(200).set_body_string("line1\nline2\nline3"))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let body = client
        .get_text("project-1/_apis/build/builds/9/logs/3", &[])
        .await
        .unwrap();
    assert_eq!(body, "line1\nline2\nline3");
}

#[tokio::test]
async fn get_attachment_bytes_fetches_authenticated_image() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/attachments/image-1"))
        .and(query_param("fileName", "image.png"))
        .and(header("Authorization", "Basic OnRlc3QtcGF0"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "image/png")
                .set_body_bytes(vec![137, 80, 78, 71]),
        )
        .mount(&server)
        .await;

    let response = test_client(&server)
        .await
        .get_attachment_bytes(&format!(
            "{}/project-1/_apis/wit/attachments/image-1?fileName=image.png",
            server.uri()
        ))
        .await
        .unwrap();

    assert_eq!(response.content_type.as_deref(), Some("image/png"));
    assert_eq!(response.bytes, vec![137, 80, 78, 71]);
}

#[tokio::test]
async fn get_attachment_bytes_rejects_non_attachment_urls() {
    let server = MockServer::start().await;
    let err = test_client(&server)
        .await
        .get_attachment_bytes(&format!("{}/project-1/_apis/projects", server.uri()))
        .await
        .unwrap_err();

    assert!(matches!(err, AdoError::Auth(_)));
}

#[test]
fn validate_attachment_url_accepts_org_path_case_variants() {
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(Url::parse("https://dev.azure.com/contoso/").unwrap());
    let url = Url::parse("https://dev.azure.com/Contoso/project-1/_apis/wit/attachments/image-1")
        .unwrap();

    client.validate_attachment_url(&url).unwrap();
}

#[test]
fn validate_attachment_url_accepts_legacy_visualstudio_org_host() {
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(Url::parse("https://dev.azure.com/contoso/").unwrap());
    let url =
        Url::parse("https://contoso.visualstudio.com/OtherProject/_apis/wit/attachments/image-1")
            .unwrap();

    client.validate_attachment_url(&url).unwrap();
}

#[test]
fn validate_attachment_url_rejects_other_org_prefixes() {
    let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(Url::parse("https://dev.azure.com/contoso/").unwrap());
    let url =
        Url::parse("https://dev.azure.com/contoso-other/_apis/wit/attachments/image-1").unwrap();

    let err = client.validate_attachment_url(&url).unwrap_err();

    assert!(matches!(err, AdoError::Auth(_)));
}

#[tokio::test]
async fn unauthorized_401() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let err = client.connection_data().await.unwrap_err();
    assert!(matches!(err, AdoError::Unauthorized));
}

#[tokio::test]
async fn rate_limited_429() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "30"))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let err = client.connection_data().await.unwrap_err();
    match err {
        AdoError::RateLimited(d) => assert_eq!(d, Duration::from_secs(30)),
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

fn retry_after_headers(value: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("Retry-After", value.parse().unwrap());
    headers
}

#[test]
fn parse_retry_after_delta_seconds() {
    let headers = retry_after_headers("30");
    assert_eq!(parse_retry_after(&headers), Some(Duration::from_secs(30)));
}

#[test]
fn parse_retry_after_http_date_in_future() {
    let target = chrono::Utc::now() + chrono::Duration::seconds(120);
    let headers = retry_after_headers(&target.to_rfc2822());
    let delay = parse_retry_after(&headers).expect("future HTTP-date yields a delay");
    // Allow slack for the clock advancing between formatting and parsing.
    assert!(
        delay > Duration::from_secs(60) && delay <= Duration::from_secs(120),
        "expected ~120s, got {delay:?}"
    );
}

#[test]
fn parse_retry_after_http_date_gmt_in_past_is_zero() {
    // RFC 9110 IMF-fixdate as servers emit it, with a named GMT zone.
    let headers = retry_after_headers("Wed, 21 Oct 2015 07:28:00 GMT");
    assert_eq!(parse_retry_after(&headers), Some(Duration::ZERO));
}

#[test]
fn parse_retry_after_malformed_value_is_none() {
    let headers = retry_after_headers("not-a-date");
    assert_eq!(parse_retry_after(&headers), None);
}

#[tokio::test]
async fn malformed_json_body_is_parse_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "application/json")
                .set_body_string("{ this is not json"),
        )
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let err = client.connection_data().await.unwrap_err();
    assert!(
        matches!(err, AdoError::Parse(_)),
        "expected Parse error, got {err:?}"
    );
}

#[tokio::test]
async fn server_error_500() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(500).set_body_string("internal error"))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    let err = client.connection_data().await.unwrap_err();
    match err {
        AdoError::Api {
            status,
            body,
            message,
            type_key,
        } => {
            assert_eq!(status, 500);
            assert_eq!(body, "internal error");
            assert!(message.is_none());
            assert!(type_key.is_none());
        }
        other => panic!("expected Api error, got {other:?}"),
    }
}

#[tokio::test]
async fn retries_get_after_transient_500() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(500).set_body_string("try again"))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "authenticatedUser": {
                "id": "user-after-retry",
                "providerDisplayName": "Retried User"
            }
        })))
        .with_priority(2)
        .mount(&server)
        .await;

    let client = retrying_test_client(&server).await;
    let data = client.connection_data().await.unwrap();

    assert_eq!(data.authenticated_user.id, "user-after-retry");
}

#[tokio::test]
async fn retries_post_after_rate_limit() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "30"))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "workItems": []
        })))
        .with_priority(2)
        .mount(&server)
        .await;

    let client = retrying_test_client(&server).await;
    let value: serde_json::Value = client
        .post_json(
            "project-1/_apis/wit/wiql",
            &[("api-version", "7.1-preview")],
            &serde_json::json!({ "query": "SELECT [System.Id] FROM WorkItems" }),
        )
        .await
        .unwrap();

    assert_eq!(value["workItems"], serde_json::json!([]));
}

#[tokio::test]
async fn does_not_retry_post_after_server_error() {
    // A POST is non-idempotent: the server may have already applied the
    // effect before returning 5xx, so the client must not retry and risk a
    // duplicate. The mock asserts it is called exactly once.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/project-1/_apis/wit/wiql"))
        .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
        .expect(1)
        .mount(&server)
        .await;

    let client = retrying_test_client(&server).await;
    let err = client
        .post_json::<_, serde_json::Value>(
            "project-1/_apis/wit/wiql",
            &[("api-version", "7.1-preview")],
            &serde_json::json!({ "query": "SELECT [System.Id] FROM WorkItems" }),
        )
        .await
        .unwrap_err();

    match err {
        AdoError::Api { status, body, .. } => {
            assert_eq!(status, 500);
            assert_eq!(body, "boom");
        }
        other => panic!("expected Api error, got {other:?}"),
    }
}

#[tokio::test]
async fn retries_put_after_transient_500() {
    // A PUT is idempotent, so retrying after a transient 5xx is safe and
    // expected. This guards against the POST fix accidentally disabling
    // retries for idempotent methods.
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/project-1/_apis/resource/1"))
        .respond_with(ResponseTemplate::new(503).set_body_string("try again"))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/project-1/_apis/resource/1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "ok": true
        })))
        .with_priority(2)
        .mount(&server)
        .await;

    let client = retrying_test_client(&server).await;
    let value: serde_json::Value = client
        .put_json(
            "project-1/_apis/resource/1",
            &[("api-version", "7.1-preview")],
            &serde_json::json!({ "value": 1 }),
        )
        .await
        .unwrap();

    assert_eq!(value["ok"], serde_json::json!(true));
}
