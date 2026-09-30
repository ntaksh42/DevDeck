use super::*;
use crate::auth::AdoCredentialProvider;
use std::sync::atomic::{AtomicUsize, Ordering};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Hands out `stale-token` until invalidated, then `fresh-token`.
struct RotatingProvider {
    invalidations: AtomicUsize,
}

#[async_trait::async_trait]
impl AdoCredentialProvider for RotatingProvider {
    async fn auth_header_value(&self) -> Result<String> {
        if self.invalidations.load(Ordering::SeqCst) == 0 {
            Ok("Bearer stale-token".to_string())
        } else {
            Ok("Bearer fresh-token".to_string())
        }
    }

    fn invalidate(&self) -> bool {
        self.invalidations.fetch_add(1, Ordering::SeqCst);
        true
    }
}

fn client(server: &MockServer, auth: Arc<dyn AdoCredentialProvider>) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", auth)
        .unwrap()
        .with_base_url(base_url)
        .with_retry_policy(RetryPolicy::no_retries())
}

#[tokio::test]
async fn unauthorized_refreshes_credential_and_resends_once() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .and(header("Authorization", "Bearer stale-token"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .and(header("Authorization", "Bearer fresh-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "authenticatedUser": {
                "id": "d6245f20-2af8-44f4-9451-8107cb2767db",
                "providerDisplayName": "Test User",
                "descriptor": "aad.abc123"
            }
        })))
        .mount(&server)
        .await;

    let provider = Arc::new(RotatingProvider {
        invalidations: AtomicUsize::new(0),
    });
    let result = client(&server, provider.clone()).connection_data().await;

    assert!(
        result.is_ok(),
        "expected re-send with fresh token: {result:?}"
    );
    assert_eq!(provider.invalidations.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn unauthorized_after_refresh_is_not_resent_again() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/connectionData"))
        .respond_with(ResponseTemplate::new(401))
        .expect(2)
        .mount(&server)
        .await;

    let provider = Arc::new(RotatingProvider {
        invalidations: AtomicUsize::new(0),
    });
    let err = client(&server, provider.clone())
        .connection_data()
        .await
        .unwrap_err();

    assert!(matches!(err, AdoError::Unauthorized));
    assert_eq!(provider.invalidations.load(Ordering::SeqCst), 1);
}
