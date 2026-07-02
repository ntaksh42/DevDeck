use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::time::sleep;
use url::Url;

use crate::error::{AdoError, Result};

use super::helpers::{
    almsearch_base_url, decode_json, is_legacy_visualstudio_org_url, parse_retry_after,
    same_azure_devops_organization_url, url_path_is_within_base, vssps_base_url,
};
use super::{AdoClient, BinaryResponse};

impl AdoClient {
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

        let request_url = url.clone();
        self.send_with_retry(
            "GET",
            url.as_str(),
            true,
            || self.http.get(request_url.clone()),
            |resp| async move {
                let content_type = resp
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                Ok(BinaryResponse {
                    bytes: resp.bytes().await?.to_vec(),
                    content_type,
                })
            },
        )
        .await
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

        self.send_with_retry(
            "GET",
            path,
            true,
            || self.http.get(url.clone()).query(query),
            |resp| async move { decode_json(resp).await },
        )
        .await
    }

    /// GETs raw bytes (e.g. `$format=octetStream` item downloads) with the
    /// shared retry behavior, returning the body and its Content-Type.
    pub(crate) async fn get_bytes(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<BinaryResponse> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        self.send_with_retry(
            "GET",
            path,
            true,
            || self.http.get(url.clone()).query(query),
            |resp| async move {
                let content_type = resp
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                Ok(BinaryResponse {
                    bytes: resp.bytes().await?.to_vec(),
                    content_type,
                })
            },
        )
        .await
    }

    pub(crate) async fn get_text(&self, path: &str, query: &[(&str, &str)]) -> Result<String> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        self.send_with_retry(
            "GET",
            path,
            true,
            || self.http.get(url.clone()).query(query),
            |resp| async move { Ok(resp.text().await?) },
        )
        .await
    }

    /// Sends a request with the shared retry/backoff, 401, 429 `Retry-After`,
    /// and 5xx handling. `build_request` produces a fresh authenticated-less
    /// builder per attempt (the `Authorization` header is added here), and
    /// `on_success` extracts the result from a 2xx response. `idempotent` must
    /// be `false` for non-idempotent requests (POST) so an ambiguous 5xx is not
    /// retried.
    async fn send_with_retry<T, F, S, Fut>(
        &self,
        method: &str,
        target: &str,
        idempotent: bool,
        build_request: F,
        on_success: S,
    ) -> Result<T>
    where
        F: Fn() -> reqwest::RequestBuilder,
        S: Fn(reqwest::Response) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        for attempt in 1..=self.retry_policy.attempts() {
            let auth = self.auth.auth_header_value().await?;
            let response = build_request().header("Authorization", &auth).send().await;

            match response {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return on_success(resp).await;
                    }
                    if status == StatusCode::UNAUTHORIZED {
                        return Err(AdoError::Unauthorized);
                    }

                    let retry_after = parse_retry_after(resp.headers());
                    if self.should_retry_status(status, attempt, idempotent) {
                        let delay = self.retry_delay(attempt, retry_after);
                        tracing::warn!(
                            method,
                            target,
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
                Err(error) if self.should_retry_error(&error, attempt, idempotent) => {
                    let delay = self.retry_policy.backoff_delay(attempt);
                    tracing::warn!(
                        method,
                        target,
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
        self.send_with_retry(
            "POST",
            url.as_str(),
            false,
            || self.http.post(url.clone()).query(query).json(body),
            |resp| async move { decode_json(resp).await },
        )
        .await
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

        self.send_with_retry(
            "PUT",
            path,
            true,
            || self.http.put(url.clone()).query(query).json(body),
            |resp| async move { decode_json(resp).await },
        )
        .await
    }

    pub(crate) async fn delete(&self, path: &str, query: &[(&str, &str)]) -> Result<()> {
        let url = self
            .base_url
            .join(path)
            .map_err(|e| AdoError::Auth(e.to_string()))?;

        self.send_with_retry(
            "DELETE",
            path,
            true,
            || self.http.delete(url.clone()).query(query),
            |_resp| async move { Ok(()) },
        )
        .await
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

        self.send_with_retry(
            "PATCH",
            path,
            true,
            || {
                self.http
                    .patch(url.clone())
                    .query(query)
                    .header("Content-Type", content_type)
                    .json(body)
            },
            |resp| async move { decode_json(resp).await },
        )
        .await
    }

    /// Decides whether a non-success status should be retried.
    ///
    /// `idempotent` must be `false` for non-idempotent requests (POST). A 5xx
    /// response to a POST is ambiguous: the server may have already applied the
    /// effect (e.g. created a PR comment or queued a build) before failing, so
    /// retrying risks a duplicate. We therefore only retry POST on `429 Too Many
    /// Requests`, which means the request was rejected before processing.
    fn should_retry_status(&self, status: StatusCode, attempt: usize, idempotent: bool) -> bool {
        if attempt >= self.retry_policy.attempts() {
            return false;
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return true;
        }
        idempotent && status.is_server_error()
    }

    /// Decides whether a transport error should be retried.
    ///
    /// For non-idempotent requests (POST), only connection errors are safe to
    /// retry: the connection was never established, so the server cannot have
    /// processed the request. A timeout is ambiguous (the request may have been
    /// received and applied), so it is not retried for non-idempotent requests.
    fn should_retry_error(&self, error: &reqwest::Error, attempt: usize, idempotent: bool) -> bool {
        if attempt >= self.retry_policy.attempts() {
            return false;
        }
        error.is_connect() || (idempotent && error.is_timeout())
    }

    fn retry_delay(&self, attempt: usize, retry_after: Option<Duration>) -> Duration {
        retry_after
            .map(|delay| self.retry_policy.capped_retry_after(delay))
            .unwrap_or_else(|| self.retry_policy.backoff_delay(attempt))
    }

    pub(crate) fn validate_attachment_url(&self, url: &Url) -> Result<()> {
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
