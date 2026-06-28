use std::sync::Arc;
use std::time::Duration;

use url::Url;

use crate::auth::AdoCredentialProvider;
use crate::error::{AdoError, Result};

mod helpers;
mod requests;

#[cfg(test)]
mod tests;

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

    pub(crate) fn attempts(self) -> usize {
        self.max_attempts.max(1)
    }

    pub(crate) fn backoff_delay(self, attempt: usize) -> Duration {
        let multiplier = 1_u32
            .checked_shl(attempt.saturating_sub(1) as u32)
            .unwrap_or(u32::MAX);
        self.base_delay
            .saturating_mul(multiplier)
            .min(self.max_delay)
    }

    pub(crate) fn capped_retry_after(self, retry_after: Duration) -> Duration {
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
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: Url,
    pub(crate) auth: Arc<dyn AdoCredentialProvider>,
    pub(crate) retry_policy: RetryPolicy,
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
            .user_agent(format!("DevDeck/{}", env!("CARGO_PKG_VERSION")))
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
}
