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

    /// Removes `id` only while it still maps to `notify`, so a finished call
    /// never drops the registration of a later call that reused the same id.
    fn unregister(&self, id: &str, notify: &Arc<Notify>) {
        let mut inner = self.inner.lock().expect("cancellation registry poisoned");
        if inner
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, notify))
        {
            inner.remove(id);
        }
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
            // `notify_one` stores a permit, so a cancel that lands before the
            // work future first polls `notified()` is not lost.
            notify.notify_one();
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
    // Unregisters on every exit, including when the caller drops this future
    // (e.g. Tauri aborting the command) before the select resolves.
    let _guard = Registration {
        registry,
        id,
        notify: notify.clone(),
    };
    tokio::select! {
        biased;
        result = work => result,
        _ = notify.notified() => Err(AppError::Cancelled),
    }
}

struct Registration<'a> {
    registry: &'a CancellationRegistry,
    id: String,
    notify: Arc<Notify>,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.registry.unregister(&self.id, &self.notify);
    }
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

    #[tokio::test]
    async fn dropping_the_future_unregisters_the_operation() {
        let registry = CancellationRegistry::new();
        let result = tokio::time::timeout(
            Duration::from_millis(20),
            run_cancellable(&registry, Some("op-3".to_string()), async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok::<i32, AppError>(1)
            }),
        )
        .await;
        assert!(result.is_err(), "the work should still have been running");
        assert!(registry.inner.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_finished_call_does_not_unregister_a_later_call_with_the_same_id() {
        let registry = CancellationRegistry::new();
        let first = registry.register("dup");
        let second = registry.register("dup");
        registry.unregister("dup", &first);
        assert!(registry.inner.lock().unwrap().contains_key("dup"));
        registry.unregister("dup", &second);
        assert!(registry.inner.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_cancel_before_the_first_poll_is_not_lost() {
        let registry = CancellationRegistry::new();
        let notify = registry.register("early");
        registry.cancel("early");
        // The permit stored by the early cancel resolves a later `notified()`.
        tokio::time::timeout(Duration::from_millis(200), notify.notified())
            .await
            .expect("early cancel should be remembered");
    }
}
