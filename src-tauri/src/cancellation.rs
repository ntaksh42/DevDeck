//! Cooperative cancellation for long-running IPC commands.
//!
//! A command runs its work via [`run_cancellable`] with a frontend-supplied
//! operation id. A `cancel_operation` command signals that id, which fires a
//! `tokio::select!` arm and drops the in-flight work future — cancelling the
//! underlying HTTP request — so the command returns promptly with
//! [`AppError::Cancelled`].

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::error::{AppError, Result};

#[derive(Clone, Default)]
pub struct CancellationRegistry {
    inner: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

impl CancellationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.inner
            .lock()
            .expect("cancellation registry poisoned")
            .insert(id.to_string(), notify.clone());
        notify
    }

    fn unregister(&self, id: &str) {
        self.inner
            .lock()
            .expect("cancellation registry poisoned")
            .remove(id);
    }

    /// Signals the operation with the given id to cancel, if it is running.
    pub fn cancel(&self, id: &str) {
        if let Some(notify) = self
            .inner
            .lock()
            .expect("cancellation registry poisoned")
            .get(id)
            .cloned()
        {
            notify.notify_waiters();
        }
    }
}

/// Runs `work`, returning early with `AppError::Cancelled` if the operation id
/// is cancelled before it finishes. With no id, the work simply runs.
pub async fn run_cancellable<T, F>(
    registry: &CancellationRegistry,
    operation_id: Option<String>,
    work: F,
) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    let Some(id) = operation_id.filter(|value| !value.trim().is_empty()) else {
        return work.await;
    };
    let notify = registry.register(&id);
    let result = tokio::select! {
        biased;
        result = work => result,
        _ = notify.notified() => Err(AppError::Cancelled),
    };
    registry.unregister(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn runs_to_completion_without_an_id() {
        let registry = CancellationRegistry::new();
        let value: i32 = run_cancellable(&registry, None, async { Ok(7) })
            .await
            .unwrap();
        assert_eq!(value, 7);
    }

    #[tokio::test]
    async fn cancels_a_running_operation() {
        let registry = CancellationRegistry::new();
        let reg = registry.clone();
        let handle = tokio::spawn(async move {
            run_cancellable(&reg, Some("op-1".to_string()), async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok::<i32, AppError>(1)
            })
            .await
        });
        // Give the work a moment to register, then cancel it.
        tokio::time::sleep(Duration::from_millis(20)).await;
        registry.cancel("op-1");
        let result = handle.await.unwrap();
        assert!(matches!(result, Err(AppError::Cancelled)));
    }

    #[tokio::test]
    async fn cancelling_an_unknown_id_is_a_no_op() {
        let registry = CancellationRegistry::new();
        registry.cancel("nope");
        let value = run_cancellable(&registry, Some("op-2".to_string()), async { Ok(3) })
            .await
            .unwrap();
        assert_eq!(value, 3);
    }
}
