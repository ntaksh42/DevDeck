use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::time::sleep;
use url::Url;

use crate::error::{GitHubError, Result};

const DEFAULT_BASE_URL: &str = "https://api.github.com/";
const API_VERSION: &str = "2022-11-28";

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

/// A GitHub REST client. Free of any Tauri-specific dependencies so it can be
/// reused. Authenticates with a personal access token (classic or
/// fine-grained) sent as a bearer token.
#[derive(Clone)]
pub struct GitHubClient {
    http: reqwest::Client,
    base_url: Url,
    retry_policy: RetryPolicy,
}

impl GitHubClient {
    /// Builds a client for github.com. The token is baked into the default
    /// headers so it never has to be threaded through call sites.
    pub fn new(token: &str) -> Result<Self> {
        Self::with_base_url(token, DEFAULT_BASE_URL)
    }

    /// Builds a client against an explicit API base URL (e.g. a GitHub
    /// Enterprise Server `https://ghe.example.com/api/v3/`). The base URL must
    /// end with a trailing slash so relative paths join correctly.
    pub fn with_base_url(token: &str, base_url: &str) -> Result<Self> {
        let token = token.trim();
        if token.is_empty() {
            return Err(GitHubError::Auth("token is required".to_string()));
        }
        let mut headers = HeaderMap::new();
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            "X-GitHub-Api-Version",
            HeaderValue::from_static(API_VERSION),
        );
        let mut auth = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| GitHubError::Auth(format!("invalid token: {e}")))?;
        auth.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth);
        // GitHub rejects requests without a User-Agent.
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(concat!("DevDeck/", env!("CARGO_PKG_VERSION"))),
        );

        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .default_headers(headers)
            .build()?;
        let base_url = Url::parse(base_url)
            .map_err(|e| GitHubError::Auth(format!("invalid base url: {e}")))?;
        Ok(Self {
            http,
            base_url,
            retry_policy: RetryPolicy::default(),
        })
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
        let url = self
            .base_url
            .join(path)
            .map_err(|e| GitHubError::Auth(e.to_string()))?;

        for attempt in 1..=self.retry_policy.attempts() {
            let response = self.http.get(url.clone()).query(query).send().await;
            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        let bytes = resp.bytes().await?;
                        return serde_json::from_slice::<T>(&bytes).map_err(GitHubError::Parse);
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(GitHubError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt) {
                        let delay = retry_after
                            .map(|d| d.min(self.retry_policy.retry_after_cap))
                            .unwrap_or_else(|| self.retry_policy.backoff_delay(attempt));
                        tracing::warn!(
                            target = path,
                            attempt,
                            status = status.as_u16(),
                            delay_ms = delay.as_millis(),
                            "retrying GitHub request after response"
                        );
                        sleep(delay).await;
                        continue;
                    }

                    if is_rate_limited(status, resp.headers()) {
                        return Err(GitHubError::RateLimited(
                            retry_after.unwrap_or(Duration::from_secs(60)),
                        ));
                    }

                    let body = resp.text().await.unwrap_or_default();
                    return Err(GitHubError::api(status.as_u16(), body));
                }
                Err(error) if self.should_retry_error(&error, attempt) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        target = path,
                        attempt,
                        delay_ms = delay.as_millis(),
                        error = %error,
                        "retrying GitHub request after network error"
                    );
                    sleep(delay).await;
                }
                Err(error) => return Err(GitHubError::Network(error)),
            }
        }

        unreachable!("retry policy always has at least one attempt")
    }

    /// Sends a single (non-retried) request and returns the response on 2xx,
    /// mapping 401 and rate limits to typed errors and other non-2xx to `Api`.
    /// Mutations are not retried because a 5xx is ambiguous (the change may have
    /// applied), so retrying risks duplicates.
    async fn execute<B: Serialize + ?Sized>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<reqwest::Response> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| GitHubError::Auth(e.to_string()))?;
        let mut request = self.http.request(method, url);
        if let Some(body) = body {
            request = request.json(body);
        }
        let resp = request.send().await?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(GitHubError::Unauthorized);
        }
        if is_rate_limited(status, resp.headers()) {
            let retry_after = parse_retry_after(resp.headers());
            return Err(GitHubError::RateLimited(
                retry_after.unwrap_or(Duration::from_secs(60)),
            ));
        }
        let body = resp.text().await.unwrap_or_default();
        Err(GitHubError::api(status.as_u16(), body))
    }

    async fn decode<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T> {
        let bytes = resp.bytes().await?;
        serde_json::from_slice(&bytes).map_err(GitHubError::Parse)
    }

    pub async fn post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self
            .execute(reqwest::Method::POST, path, Some(body))
            .await?;
        Self::decode(resp).await
    }

    pub async fn patch_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self
            .execute(reqwest::Method::PATCH, path, Some(body))
            .await?;
        Self::decode(resp).await
    }

    pub async fn put_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self.execute(reqwest::Method::PUT, path, Some(body)).await?;
        Self::decode(resp).await
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.execute(reqwest::Method::DELETE, path, None::<&()>)
            .await?;
        Ok(())
    }

    /// DELETE with a JSON body, required by endpoints like removing requested
    /// reviewers.
    pub async fn delete_with_body<B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<()> {
        self.execute(reqwest::Method::DELETE, path, Some(body))
            .await?;
        Ok(())
    }

    /// Issues a GraphQL request against `/graphql`. Returns the parsed JSON
    /// response, surfacing a top-level `errors` array as an `Api` error.
    pub async fn graphql(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let body = serde_json::json!({ "query": query, "variables": variables });
        let resp = self
            .execute(reqwest::Method::POST, "graphql", Some(&body))
            .await?;
        let value: serde_json::Value = Self::decode(resp).await?;
        if let Some(errors) = value.get("errors").and_then(|e| e.as_array()) {
            if !errors.is_empty() {
                return Err(GitHubError::api(200, errors[0].to_string()));
            }
        }
        Ok(value)
    }

    fn should_retry_status(&self, status: StatusCode, attempt: usize) -> bool {
        if attempt >= self.retry_policy.attempts() {
            return false;
        }
        // GitHub signals both primary (403) and secondary (429) rate limits; the
        // 5xx family is transient. All are safe to retry for idempotent GETs.
        status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
    }

    fn should_retry_error(&self, error: &reqwest::Error, attempt: usize) -> bool {
        if attempt >= self.retry_policy.attempts() {
            return false;
        }
        error.is_connect() || error.is_timeout()
    }
}

/// Parses `Retry-After` (seconds) when present.
fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    headers
        .get("Retry-After")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

/// GitHub returns 403 (primary) or 429 (secondary) for rate limits. A 403 is a
/// rate limit only when the remaining quota header is zero, otherwise it is a
/// genuine permission error.
fn is_rate_limited(status: StatusCode, headers: &HeaderMap) -> bool {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return true;
    }
    if status == StatusCode::FORBIDDEN {
        return headers
            .get("X-RateLimit-Remaining")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(|remaining| remaining == 0)
            .unwrap_or(false);
    }
    false
}
