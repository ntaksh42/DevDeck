use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Hangs on the first call (like a stuck `az`), then answers immediately.
struct HangsOnceTokenSource {
    calls: AtomicUsize,
}

impl AzureCliTokenSource for HangsOnceTokenSource {
    fn access_token(&self) -> Result<AzureCliToken> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            std::thread::sleep(Duration::from_millis(500));
        }
        Ok(AzureCliToken {
            token: "token".to_string(),
            expires_in: None,
        })
    }
}

#[tokio::test]
async fn hung_az_times_out_and_releases_fetch_lock() {
    let source = Arc::new(HangsOnceTokenSource {
        calls: AtomicUsize::new(0),
    });
    let mut provider = AzureCliProvider::with_token_source(source, Duration::from_secs(300));
    provider.fetch_timeout = Duration::from_millis(50);

    let err = provider.auth_header_value().await.unwrap_err();
    assert!(matches!(err, AdoError::Auth(ref m) if m.contains("timed out")));

    // The lock must be free again, so the next request is not stalled behind
    // the hung invocation.
    let header = tokio::time::timeout(Duration::from_millis(300), provider.auth_header_value())
        .await
        .expect("fetch lock still held by the hung invocation")
        .unwrap();
    assert_eq!(header, "Bearer token");
}

struct CountingTokenSource {
    calls: AtomicUsize,
}

impl AzureCliTokenSource for CountingTokenSource {
    fn access_token(&self) -> Result<AzureCliToken> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(AzureCliToken {
            token: "token".to_string(),
            expires_in: None,
        })
    }
}

#[tokio::test]
async fn invalidate_forces_refetch_of_cached_token() {
    let source = Arc::new(CountingTokenSource {
        calls: AtomicUsize::new(0),
    });
    let provider = AzureCliProvider::with_token_source(source.clone(), Duration::from_secs(300));

    provider.auth_header_value().await.unwrap();
    assert!(provider.invalidate());
    provider.auth_header_value().await.unwrap();

    assert_eq!(source.calls.load(Ordering::SeqCst), 2);
}
