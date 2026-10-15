use std::future::Future;
use std::time::Duration;

use crate::error::{AppError, Result};

pub(super) async fn with_query_deadline<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    with_deadline(Duration::from_secs(120), future).await
}

async fn with_deadline<T>(
    duration: Duration,
    future: impl Future<Output = Result<T>>,
) -> Result<T> {
    // Dropping the future releases async locks and request permits as well as
    // cancelling outstanding HTTP requests; a UI-only timeout cannot do that.
    tokio::time::timeout(duration, future).await.map_err(|_| {
        tracing::warn!("work item query exceeded its deadline");
        AppError::AzureDevOps("Work item query timed out. Please retry.".to_string())
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn timeout_releases_lock_and_allows_next_query() {
        let lock = Mutex::new(());
        let result: Result<()> = with_deadline(Duration::from_millis(20), async {
            let _guard = lock.lock().await;
            std::future::pending().await
        })
        .await;
        assert!(result.unwrap_err().to_string().contains("timed out"));
        let next = with_deadline(Duration::from_secs(1), async {
            let _guard = lock.lock().await;
            Ok(42)
        })
        .await;
        assert_eq!(next.unwrap(), 42);
    }

    #[tokio::test]
    async fn preserves_original_errors() {
        let result: Result<()> =
            with_query_deadline(async { Err(AppError::InvalidInput("invalid WIQL".to_string())) })
                .await;
        assert!(
            matches!(result, Err(AppError::InvalidInput(message)) if message == "invalid WIQL")
        );
    }
}
