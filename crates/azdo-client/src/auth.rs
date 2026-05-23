use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::{AdoError, Result};

#[async_trait::async_trait]
pub trait AdoCredentialProvider: Send + Sync {
    async fn auth_header_value(&self) -> Result<String>;
}

pub struct PatProvider {
    pat: String,
}

impl PatProvider {
    pub fn new(pat: impl Into<String>) -> Self {
        Self { pat: pat.into() }
    }
}

#[async_trait::async_trait]
impl AdoCredentialProvider for PatProvider {
    async fn auth_header_value(&self) -> Result<String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let encoded = STANDARD.encode(format!(":{}", self.pat));
        Ok(format!("Basic {encoded}"))
    }
}

pub struct AzureCliProvider {
    token_source: Arc<dyn AzureCliTokenSource>,
    cache: Mutex<Option<CachedBearerToken>>,
    token_ttl: Duration,
}

impl AzureCliProvider {
    pub fn new() -> Self {
        Self {
            token_source: Arc::new(AzCommandTokenSource),
            cache: Mutex::new(None),
            token_ttl: Duration::from_secs(300),
        }
    }

    #[cfg(test)]
    fn with_token_source(token_source: Arc<dyn AzureCliTokenSource>, token_ttl: Duration) -> Self {
        Self {
            token_source,
            cache: Mutex::new(None),
            token_ttl,
        }
    }
}

impl Default for AzureCliProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AdoCredentialProvider for AzureCliProvider {
    async fn auth_header_value(&self) -> Result<String> {
        if let Some(token) = self.cached_token()? {
            return Ok(format!("Bearer {token}"));
        }

        let token = self.token_source.access_token()?;
        if token.trim().is_empty() {
            return Err(AdoError::Auth(
                "Azure CLI returned an empty access token".to_string(),
            ));
        }

        let token = token.trim().to_string();
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| AdoError::Auth("Azure CLI token cache lock poisoned".to_string()))?;
        *cache = Some(CachedBearerToken {
            token: token.clone(),
            fetched_at: Instant::now(),
        });

        Ok(format!("Bearer {token}"))
    }
}

impl AzureCliProvider {
    fn cached_token(&self) -> Result<Option<String>> {
        let cache = self
            .cache
            .lock()
            .map_err(|_| AdoError::Auth("Azure CLI token cache lock poisoned".to_string()))?;
        Ok(cache.as_ref().and_then(|cached| {
            if cached.fetched_at.elapsed() < self.token_ttl {
                Some(cached.token.clone())
            } else {
                None
            }
        }))
    }
}

struct CachedBearerToken {
    token: String,
    fetched_at: Instant,
}

trait AzureCliTokenSource: Send + Sync {
    fn access_token(&self) -> Result<String>;
}

struct AzCommandTokenSource;

impl AzureCliTokenSource for AzCommandTokenSource {
    fn access_token(&self) -> Result<String> {
        let output = Command::new("az")
            .args([
                "account",
                "get-access-token",
                "--resource",
                "499b84ac-1321-427f-aa17-267ca6975798",
                "--query",
                "accessToken",
                "--output",
                "tsv",
            ])
            .output()
            .map_err(|error| {
                AdoError::Auth(format!(
                    "failed to run Azure CLI; install Azure CLI and run 'az login': {error}"
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AdoError::Auth(format!(
                "Azure CLI token request failed: {}",
                if stderr.is_empty() {
                    output.status.to_string()
                } else {
                    stderr
                }
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct StaticTokenSource {
        token: String,
        calls: AtomicUsize,
    }

    impl StaticTokenSource {
        fn new(token: &str) -> Self {
            Self {
                token: token.to_string(),
                calls: AtomicUsize::new(0),
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl AzureCliTokenSource for StaticTokenSource {
        fn access_token(&self) -> Result<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.token.clone())
        }
    }

    #[tokio::test]
    async fn azure_cli_provider_returns_bearer_token() {
        let source = Arc::new(StaticTokenSource::new("test-token"));
        let provider =
            AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

        assert_eq!(
            provider.auth_header_value().await.unwrap(),
            "Bearer test-token"
        );
        assert_eq!(source.calls(), 1);
    }

    #[tokio::test]
    async fn azure_cli_provider_caches_token() {
        let source = Arc::new(StaticTokenSource::new("cached-token"));
        let provider =
            AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

        provider.auth_header_value().await.unwrap();
        provider.auth_header_value().await.unwrap();

        assert_eq!(source.calls(), 1);
    }
}
