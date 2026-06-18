use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderMap, CONTENT_TYPE};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::time::sleep;
use url::Url;

use crate::auth::AdoCredentialProvider;
use crate::error::{AdoError, Result};

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_attempts: usize,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub retry_after_cap: Duration,
}

impl RetryPolicy {
    pub fn no_retries() -> Self {
        Self {
            max_attempts: 1,
            base_delay: Duration::ZERO,
            max_delay: Duration::ZERO,
            retry_after_cap: Duration::ZERO,
        }
    }

    fn attempts(self) -> usize {
        self.max_attempts.max(1)
    }

    fn backoff_delay(self, attempt: usize) -> Duration {
        let multiplier = 1_u32
            .checked_shl(attempt.saturating_sub(1) as u32)
            .unwrap_or(u32::MAX);
        self.base_delay
            .saturating_mul(multiplier)
            .min(self.max_delay)
    }

    fn capped_retry_after(self, retry_after: Duration) -> Duration {
        retry_after.min(self.retry_after_cap)
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay: Duration::from_millis(250),
            max_delay: Duration::from_secs(2),
            retry_after_cap: Duration::from_secs(5),
        }
    }
}

#[derive(Clone)]
pub struct AdoClient {
    http: reqwest::Client,
    base_url: Url,
    auth: Arc<dyn AdoCredentialProvider>,
    retry_policy: RetryPolicy,
}

#[derive(Debug, Clone)]
pub struct BinaryResponse {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
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
            retry_policy: RetryPolicy::default(),
        })
    }

    pub fn with_base_url(mut self, url: Url) -> Self {
        self.base_url = url;
        self
    }

    pub fn with_retry_policy(mut self, retry_policy: RetryPolicy) -> Self {
        self.retry_policy = retry_policy;
        self
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T> {
        self.get_json_from_base(self.base_url.clone(), path, query)
            .await
    }

    pub(crate) async fn get_json_vssps<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T> {
        let base_url = vssps_base_url(&self.base_url)?;
        self.get_json_from_base(base_url, path, query).await
    }

    pub async fn get_attachment_bytes(&self, url: &str) -> Result<BinaryResponse> {
        let url = Url::parse(url).map_err(|e| AdoError::Auth(e.to_string()))?;
        self.validate_attachment_url(&url)?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .get(url.clone())
                .header("Authorization", &auth)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        let content_type = resp
                            .headers()
                            .get(CONTENT_TYPE)
                            .and_then(|value| value.to_str().ok())
                            .map(str::to_string);
                        return Ok(BinaryResponse {
                            bytes: resp.bytes().await?.to_vec(),
                            content_type,
                        });
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "GET",
                            url = %url,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps attachment request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "GET",
                        url = %url,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps attachment request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    async fn get_json_from_base<T: DeserializeOwned>(
        &self,
        base_url: Url,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T> {
        let url = base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .get(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return decode_json(resp).await;
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "GET",
                            path,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "GET",
                        path,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    pub(crate) async fn get_text(&self, path: &str, query: &[(&str, &str)]) -> Result<String> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .get(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp.text().await?);
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }
                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        sleep(delay).await;
                        continue;
                    }
                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }
                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    sleep(self.retry_policy.backoff_delay(attempt)).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    pub(crate) async fn post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        body: &B,
    ) -> Result<T> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;
        self.post_json_to_url(url, query, body).await
    }

    /// POSTs to the Almsearch service host (Code/Work Item Search), which lives
    /// on a different subdomain than the core REST API.
    pub(crate) async fn post_json_almsearch<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        body: &B,
    ) -> Result<T> {
        let url = almsearch_base_url(&self.base_url)?
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;
        self.post_json_to_url(url, query, body).await
    }

    async fn post_json_to_url<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        url: Url,
        query: &[(&str, &str)],
        body: &B,
    ) -> Result<T> {
        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .post(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .json(body)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return decode_json(resp).await;
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "POST",
                            url = %url,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "POST",
                        url = %url,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    pub(crate) async fn put_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        body: &B,
    ) -> Result<T> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .put(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .json(body)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return decode_json(resp).await;
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "PUT",
                            path,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "PUT",
                        path,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    pub(crate) async fn delete(&self, path: &str, query: &[(&str, &str)]) -> Result<()> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .delete(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(());
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "DELETE",
                            path,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "DELETE",
                        path,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    pub(crate) async fn patch_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        content_type: &str,
        body: &B,
    ) -> Result<T> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = self
                .http
                .patch(url.clone())
                .query(query)
                .header("Authorization", &auth)
                .header("Content-Type", content_type)
                .json(body)
                .send()
                .await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return decode_json(resp).await;
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method = "PATCH",
                            path,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying Azure DevOps request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AdoError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(AdoError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method = "PATCH",
                        path,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying Azure DevOps request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(AdoError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    fn should_retry_status(&self, status: StatusCode, attempt: usize) -> bool {
        attempt < self.retry_policy.attempts()
            && (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
    }

    fn should_retry_error(&self, error: &reqwest::Error, attempt: usize) -> bool {
        attempt < self.retry_policy.attempts() && (error.is_connect() || error.is_timeout())
    }

    fn retry_delay(&self, attempt: usize, retry_after: Option<Duration>) -> Duration {
        retry_after
            .map(|delay| self.retry_policy.capped_retry_after(delay))
            .unwrap_or_else(|| self.retry_policy.backoff_delay(attempt))
    }

    fn validate_attachment_url(&self, url: &Url) -> Result<()> {
        if url.scheme() != self.base_url.scheme()
            || url.port_or_known_default() != self.base_url.port_or_known_default()
            || !same_azure_devops_organization_url(url, &self.base_url)
        {
            return Err(AdoError::Auth(
                "attachment URL is outside the Azure DevOps organization".to_string(),
            ));
        }

        let base_path = self.base_url.path().trim_end_matches('/');
        if !is_legacy_visualstudio_org_url(url, &self.base_url)
            && !base_path.is_empty()
            && base_path != "/"
            && !url_path_is_within_base(url.path(), base_path)
        {
            return Err(AdoError::Auth(
                "attachment URL is outside the Azure DevOps organization".to_string(),
            ));
        }

        if !url
            .path()
            .to_ascii_lowercase()
            .contains("/_apis/wit/attachments/")
        {
            return Err(AdoError::Auth(
                "only Azure DevOps work item attachment URLs can be fetched".to_string(),
            ));
        }

        Ok(())
    }
}

fn url_path_is_within_base(url_path: &str, base_path: &str) -> bool {
    if url_path.eq_ignore_ascii_case(base_path) {
        return true;
    }
    url_path.len() > base_path.len()
        && url_path.as_bytes().get(base_path.len()) == Some(&b'/')
        && url_path[..base_path.len()].eq_ignore_ascii_case(base_path)
}

fn same_azure_devops_organization_url(url: &Url, base_url: &Url) -> bool {
    if url.host_str() == base_url.host_str() {
        return true;
    }
    is_legacy_visualstudio_org_url(url, base_url)
}

fn is_legacy_visualstudio_org_url(url: &Url, base_url: &Url) -> bool {
    let Some(url_host) = url.host_str() else {
        return false;
    };
    let Some(base_host) = base_url.host_str() else {
        return false;
    };
    if !base_host.eq_ignore_ascii_case("dev.azure.com") {
        return false;
    }
    let org = base_url
        .path_segments()
        .and_then(|mut segments| segments.find(|segment| !segment.is_empty()));
    let Some(org) = org else {
        return false;
    };
    url_host.eq_ignore_ascii_case(&format!("{org}.visualstudio.com"))
}

fn vssps_base_url(base_url: &Url) -> Result<Url> {
    if base_url.host_str() != Some("dev.azure.com") {
        return Ok(base_url.clone());
    }

    let organization = base_url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AdoError::Auth("missing organization in base URL".to_string()))?;
    Url::parse(&format!("https://vssps.dev.azure.com/{organization}/"))
        .map_err(|e| AdoError::Auth(e.to_string()))
}

fn almsearch_base_url(base_url: &Url) -> Result<Url> {
    if base_url.host_str() != Some("dev.azure.com") {
        return Ok(base_url.clone());
    }

    let organization = base_url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AdoError::Auth("missing organization in base URL".to_string()))?;
    Url::parse(&format!("https://almsearch.dev.azure.com/{organization}/"))
        .map_err(|e| AdoError::Auth(e.to_string()))
}

/// Reads a successful response body and deserializes it as JSON.
///
/// A failure to decode a 2xx body is a payload-shape problem, not a transport
/// problem, so it surfaces as `AdoError::Parse` rather than `AdoError::Network`.
/// Reading the body itself can still fail at the transport layer (e.g. a
/// dropped connection mid-stream), which remains `AdoError::Network`.
async fn decode_json<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T> {
    let bytes = resp.bytes().await?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers.get("Retry-After")?.to_str().ok()?.trim();

    // RFC 9110: Retry-After is either delta-seconds or an HTTP-date.
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    // HTTP-date form (e.g. "Wed, 21 Oct 2015 07:28:00 GMT"). Wait until that
    // instant; a past or invalid date falls back to a zero wait so callers use
    // their own backoff.
    let target = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let delta = target.signed_duration_since(chrono::Utc::now());
    Some(delta.to_std().unwrap_or(Duration::ZERO))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::PatProvider;
    use crate::identity::ConnectionData;
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
        let url =
            Url::parse("https://dev.azure.com/Contoso/project-1/_apis/wit/attachments/image-1")
                .unwrap();

        client.validate_attachment_url(&url).unwrap();
    }

    #[test]
    fn validate_attachment_url_accepts_legacy_visualstudio_org_host() {
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(Url::parse("https://dev.azure.com/contoso/").unwrap());
        let url = Url::parse(
            "https://contoso.visualstudio.com/OtherProject/_apis/wit/attachments/image-1",
        )
        .unwrap();

        client.validate_attachment_url(&url).unwrap();
    }

    #[test]
    fn validate_attachment_url_rejects_other_org_prefixes() {
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(Url::parse("https://dev.azure.com/contoso/").unwrap());
        let url = Url::parse("https://dev.azure.com/contoso-other/_apis/wit/attachments/image-1")
            .unwrap();

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
}
