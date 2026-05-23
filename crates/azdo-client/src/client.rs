use std::sync::Arc;
use std::time::Duration;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use url::Url;

use crate::auth::AdoCredentialProvider;
use crate::error::{AdoError, Result};

pub struct AdoClient {
    http: reqwest::Client,
    base_url: Url,
    auth: Arc<dyn AdoCredentialProvider>,
}

impl AdoClient {
    pub fn new(organization: &str, auth: Arc<dyn AdoCredentialProvider>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(format!("AzDoDeck/{}", env!("CARGO_PKG_VERSION")))
            .build()?;
        let base_url = Url::parse(&format!("https://dev.azure.com/{organization}/"))
            .map_err(|e| AdoError::Auth(format!("invalid organization: {e}")))?;
        Ok(Self {
            http,
            base_url,
            auth,
        })
    }

    pub fn with_base_url(mut self, url: Url) -> Self {
        self.base_url = url;
        self
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;
        let auth = self.auth.auth_header_value().await?;

        let resp = self
            .http
            .get(url)
            .query(query)
            .header("Authorization", &auth)
            .send()
            .await?;

        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(AdoError::Unauthorized);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
                .unwrap_or(60);
            return Err(AdoError::RateLimited(Duration::from_secs(retry)));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AdoError::Api {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp.json().await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::PatProvider;
    use crate::identity::ConnectionData;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
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
            AdoError::Api { status, body } => {
                assert_eq!(status, 500);
                assert_eq!(body, "internal error");
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
