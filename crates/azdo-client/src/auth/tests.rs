use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(windows)]
#[test]
fn az_command_runs_through_cmd_on_windows() {
    // `az` is `az.cmd` on Windows, which `Command::new("az")` cannot find.
    let command = az_command();
    assert_eq!(command.get_program(), "cmd");
    assert_eq!(command.get_args().collect::<Vec<_>>(), vec!["/C", "az"]);
}

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
    let provider = AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

    assert_eq!(
        provider.auth_header_value().await.unwrap(),
        "Bearer test-token"
    );
    assert_eq!(source.calls(), 1);
}

#[tokio::test]
async fn azure_cli_provider_caches_token() {
    let source = Arc::new(StaticTokenSource::new("cached-token"));
    let provider = AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

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
    let provider = AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

    provider.auth_header_value().await.unwrap();
    provider.auth_header_value().await.unwrap();

    // Lifetime (1s) minus the 60s margin saturates to zero, so the cached
    // token is already stale and the second call refetches.
    assert_eq!(source.calls.load(Ordering::SeqCst), 2);
}
