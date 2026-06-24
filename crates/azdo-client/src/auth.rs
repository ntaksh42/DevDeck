use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::TimeZone;
use secrecy::{ExposeSecret, SecretString};

use crate::error::{AdoError, Result};

/// Cloud-neutral Azure DevOps application (resource) ID used when requesting an
/// Azure CLI access token. This GUID is the same across the public and national
/// clouds (Azure US Government, Azure China, ...).
const DEFAULT_AZURE_DEVOPS_RESOURCE: &str = "499b84ac-1321-427f-aa17-267ca6975798";

/// Environment variable that overrides the resource passed to
/// `az account get-access-token --resource`. National-cloud users who need a
/// different audience can set this; when unset the cloud-neutral default is used.
const AZURE_CLI_RESOURCE_ENV: &str = "AZDO_CLI_RESOURCE";

/// Resolve the resource ID for the Azure CLI token request. An explicit, non-empty
/// `AZDO_CLI_RESOURCE` override wins; otherwise the cloud-neutral default applies.
fn resolve_cli_resource(override_value: Option<&str>) -> String {
    match override_value.map(str::trim) {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => DEFAULT_AZURE_DEVOPS_RESOURCE.to_string(),
    }
}

#[async_trait::async_trait]
pub trait AdoCredentialProvider: Send + Sync {
    async fn auth_header_value(&self) -> Result<String>;
}

pub struct PatProvider {
    pat: SecretString,
}

impl PatProvider {
    pub fn new(pat: impl Into<String>) -> Self {
        Self {
            pat: SecretString::from(pat.into()),
        }
    }
}

#[async_trait::async_trait]
impl AdoCredentialProvider for PatProvider {
    async fn auth_header_value(&self) -> Result<String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let encoded = STANDARD.encode(format!(":{}", self.pat.expose_secret()));
        Ok(format!("Basic {encoded}"))
    }
}

pub struct AzureCliProvider {
    token_source: Arc<dyn AzureCliTokenSource>,
    cache: Mutex<Option<CachedBearerToken>>,
    /// Serializes token acquisition so concurrent cache misses do not each spawn
    /// their own `az` process. Holders re-check the cache after acquiring it.
    fetch_lock: tokio::sync::Mutex<()>,
    token_ttl: Duration,
}

impl AzureCliProvider {
    pub fn new() -> Self {
        let resource = resolve_cli_resource(std::env::var(AZURE_CLI_RESOURCE_ENV).ok().as_deref());
        Self {
            token_source: Arc::new(AzCommandTokenSource { resource }),
            cache: Mutex::new(None),
            fetch_lock: tokio::sync::Mutex::new(()),
            token_ttl: Duration::from_secs(300),
        }
    }

    #[cfg(test)]
    fn with_token_source(token_source: Arc<dyn AzureCliTokenSource>, token_ttl: Duration) -> Self {
        Self {
            token_source,
            cache: Mutex::new(None),
            fetch_lock: tokio::sync::Mutex::new(()),
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

        // Serialize acquisition: only one task fetches at a time, so concurrent
        // cache misses do not each spawn their own `az` process.
        let _fetch_guard = self.fetch_lock.lock().await;

        // Another task may have populated the cache while we waited for the lock.
        if let Some(token) = self.cached_token()? {
            return Ok(format!("Bearer {token}"));
        }

        // `az` shells out synchronously; run it off the async worker thread.
        let token_source = Arc::clone(&self.token_source);
        let fetched = tokio::task::spawn_blocking(move || token_source.access_token())
            .await
            .map_err(|error| AdoError::Auth(format!("Azure CLI token task failed: {error}")))??;
        if fetched.token.trim().is_empty() {
            return Err(AdoError::Auth(
                "Azure CLI returned an empty access token".to_string(),
            ));
        }

        let token = fetched.token.trim().to_string();
        let header = format!("Bearer {token}");
        // Cache until just before the CLI-reported expiry; fall back to the fixed
        // TTL when the CLI did not report (or we could not parse) one.
        let lifetime = match fetched.expires_in {
            Some(expires_in) => expires_in.saturating_sub(TOKEN_EXPIRY_MARGIN),
            None => self.token_ttl,
        };
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| AdoError::Auth("Azure CLI token cache lock poisoned".to_string()))?;
        *cache = Some(CachedBearerToken {
            token: SecretString::from(token),
            valid_until: Instant::now() + lifetime,
        });

        Ok(header)
    }
}

impl AzureCliProvider {
    fn cached_token(&self) -> Result<Option<String>> {
        let cache = self
            .cache
            .lock()
            .map_err(|_| AdoError::Auth("Azure CLI token cache lock poisoned".to_string()))?;
        Ok(cache.as_ref().and_then(|cached| {
            if Instant::now() < cached.valid_until {
                Some(cached.token.expose_secret().to_string())
            } else {
                None
            }
        }))
    }
}

struct CachedBearerToken {
    token: SecretString,
    /// Monotonic instant after which the cached token must be refetched.
    valid_until: Instant,
}

/// Refresh the token this long before its real expiry, so a request never goes
/// out with a token that expires mid-flight.
const TOKEN_EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// An Azure CLI access token plus, when the CLI reported it, how long it stays
/// valid. `expires_in` is `None` for older `az` versions or unparsable output,
/// in which case the provider falls back to its fixed TTL.
struct AzureCliToken {
    token: String,
    expires_in: Option<Duration>,
}

trait AzureCliTokenSource: Send + Sync {
    fn access_token(&self) -> Result<AzureCliToken>;
}

struct AzCommandTokenSource {
    resource: String,
}

impl AzureCliTokenSource for AzCommandTokenSource {
    fn access_token(&self) -> Result<AzureCliToken> {
        let output = Command::new("az")
            .args([
                "account",
                "get-access-token",
                "--resource",
                &self.resource,
                "--output",
                "json",
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

        let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| {
            AdoError::Auth(format!("could not parse Azure CLI token output: {error}"))
        })?;
        let token = value
            .get("accessToken")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        Ok(AzureCliToken {
            token,
            expires_in: token_expires_in(&value),
        })
    }
}

/// Derives the token's remaining lifetime from the Azure CLI JSON. Prefers the
/// unambiguous unix `expires_on` (seconds since epoch, newer `az`); falls back
/// to the local-time `expiresOn` string; returns `None` if neither is usable.
fn token_expires_in(value: &serde_json::Value) -> Option<Duration> {
    if let Some(epoch) = value.get("expires_on").and_then(|v| v.as_i64()) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        let remaining = epoch - now;
        return (remaining > 0).then(|| Duration::from_secs(remaining as u64));
    }
    let raw = value.get("expiresOn").and_then(|v| v.as_str())?;
    // `az` reports this in local time without a timezone, e.g.
    // "2026-06-25 13:45:30.123456".
    let naive = chrono::NaiveDateTime::parse_from_str(raw.trim(), "%Y-%m-%d %H:%M:%S%.f").ok()?;
    let local = chrono::Local.from_local_datetime(&naive).single()?;
    local
        .signed_duration_since(chrono::Local::now())
        .to_std()
        .ok()
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
        fn access_token(&self) -> Result<AzureCliToken> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(AzureCliToken {
                token: self.token.clone(),
                expires_in: None,
            })
        }
    }

    #[test]
    fn resolve_cli_resource_defaults_to_cloud_neutral_id() {
        assert_eq!(resolve_cli_resource(None), DEFAULT_AZURE_DEVOPS_RESOURCE);
    }

    #[test]
    fn resolve_cli_resource_ignores_blank_override() {
        assert_eq!(
            resolve_cli_resource(Some("   ")),
            DEFAULT_AZURE_DEVOPS_RESOURCE
        );
    }

    #[test]
    fn resolve_cli_resource_uses_trimmed_override() {
        assert_eq!(
            resolve_cli_resource(Some("  https://datawarehouse.usgovcloudapi.net  ")),
            "https://datawarehouse.usgovcloudapi.net"
        );
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

    /// Token source that sleeps before returning so concurrent callers overlap
    /// inside the acquisition path, exercising the single-flight gate.
    struct SlowTokenSource {
        token: String,
        calls: AtomicUsize,
    }

    impl SlowTokenSource {
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

    impl AzureCliTokenSource for SlowTokenSource {
        fn access_token(&self) -> Result<AzureCliToken> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(50));
            Ok(AzureCliToken {
                token: self.token.clone(),
                expires_in: None,
            })
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn azure_cli_provider_serializes_concurrent_fetches() {
        let source = Arc::new(SlowTokenSource::new("shared-token"));
        let provider = Arc::new(AzureCliProvider::with_token_source(
            source.clone(),
            Duration::from_secs(300),
        ));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let provider = Arc::clone(&provider);
                tokio::spawn(async move { provider.auth_header_value().await })
            })
            .collect();

        for handle in handles {
            assert_eq!(handle.await.unwrap().unwrap(), "Bearer shared-token");
        }

        // Despite eight concurrent callers, the gate plus cache re-check should
        // limit the external process to a single invocation.
        assert_eq!(source.calls(), 1);
    }

    #[test]
    fn token_expires_in_prefers_unix_expires_on() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let value = serde_json::json!({
            "accessToken": "t",
            "expires_on": now + 3600,
            "expiresOn": "1999-01-01 00:00:00.000000",
        });
        let remaining = token_expires_in(&value).expect("should parse expiry");
        // ~1 hour out, allowing for the second that elapsed during the test.
        assert!(remaining <= Duration::from_secs(3600));
        assert!(remaining >= Duration::from_secs(3590));
    }

    #[test]
    fn token_expires_in_is_none_when_absent() {
        let value = serde_json::json!({ "accessToken": "t" });
        assert!(token_expires_in(&value).is_none());
    }

    /// A token whose reported lifetime is shorter than a fresh fetch interval is
    /// refetched once it lapses, instead of being held for the fixed fallback TTL.
    struct ShortLivedTokenSource {
        calls: AtomicUsize,
    }

    impl AzureCliTokenSource for ShortLivedTokenSource {
        fn access_token(&self) -> Result<AzureCliToken> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            // expires_in below the margin → lifetime saturates to zero, so the
            // very next call is a cache miss.
            Ok(AzureCliToken {
                token: "short".to_string(),
                expires_in: Some(Duration::from_secs(1)),
            })
        }
    }

    #[tokio::test]
    async fn azure_cli_provider_refetches_when_token_lifetime_elapsed() {
        let source = Arc::new(ShortLivedTokenSource {
            calls: AtomicUsize::new(0),
        });
        let provider =
            AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

        provider.auth_header_value().await.unwrap();
        provider.auth_header_value().await.unwrap();

        // Lifetime (1s) minus the 60s margin saturates to zero, so the cached
        // token is already stale and the second call refetches.
        assert_eq!(source.calls.load(Ordering::SeqCst), 2);
    }
}
