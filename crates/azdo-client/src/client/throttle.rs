//! Process-wide request throttle shared by every `AdoClient` for the same
//! Azure DevOps endpoint.
//!
//! Clients are built per call, so a limit stored on the client would not be
//! shared. Instead the gate is looked up by `host:port`, which makes all
//! callers (background sync and on-demand screens alike) draw from one budget.
//! After the cache is cleared every screen refetches at once; the gate keeps
//! that burst from tripping Azure DevOps rate limiting (TSTU delays / 429).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use reqwest::header::HeaderMap;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{sleep_until, Instant};
use url::Url;

/// Maximum in-flight requests per endpoint across the whole process.
const MAX_IN_FLIGHT: usize = 8;
/// Upper bound for a server-requested pause so a bad header cannot freeze the app.
const MAX_COOLDOWN: Duration = Duration::from_secs(30);

pub(crate) struct Gate {
    permits: Arc<Semaphore>,
    resume_at: Mutex<Option<Instant>>,
}

impl Gate {
    fn new() -> Self {
        Self {
            permits: Arc::new(Semaphore::new(MAX_IN_FLIGHT)),
            resume_at: Mutex::new(None),
        }
    }

    /// Returns the shared gate for `base_url`'s endpoint.
    pub(crate) fn for_url(base_url: &Url) -> Arc<Gate> {
        static GATES: OnceLock<Mutex<HashMap<String, Arc<Gate>>>> = OnceLock::new();
        let key = format!(
            "{}:{}",
            base_url.host_str().unwrap_or_default(),
            base_url.port_or_known_default().unwrap_or(0)
        );
        let mut gates = GATES
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        gates
            .entry(key)
            .or_insert_with(|| Arc::new(Gate::new()))
            .clone()
    }

    /// Waits out any server-requested cooldown, then takes a request slot.
    pub(crate) async fn acquire(&self) -> OwnedSemaphorePermit {
        loop {
            let deadline = *self
                .resume_at
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match deadline {
                Some(at) if at > Instant::now() => sleep_until(at).await,
                _ => break,
            }
        }
        self.permits
            .clone()
            .acquire_owned()
            .await
            .expect("throttle semaphore is never closed")
    }

    /// Pauses new requests for `delay` (capped), extending any existing pause.
    pub(crate) fn pause_for(&self, delay: Duration) {
        if delay.is_zero() {
            return;
        }
        let until = Instant::now() + delay.min(MAX_COOLDOWN);
        let mut resume_at = self
            .resume_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if resume_at.map_or(true, |current| current < until) {
            *resume_at = Some(until);
        }
    }
}

/// Reads Azure DevOps' `X-RateLimit-Delay` (seconds), which the service sends
/// on otherwise-successful responses once usage is being delayed.
pub(crate) fn parse_rate_limit_delay(headers: &HeaderMap) -> Option<Duration> {
    let seconds: f64 = headers
        .get("X-RateLimit-Delay")?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    (seconds.is_finite() && seconds > 0.0).then(|| Duration::from_secs_f64(seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_delay_parses_fractional_seconds() {
        let mut headers = HeaderMap::new();
        headers.insert("X-RateLimit-Delay", "1.5".parse().unwrap());
        assert_eq!(
            parse_rate_limit_delay(&headers),
            Some(Duration::from_millis(1500))
        );
    }

    #[test]
    fn rate_limit_delay_ignores_zero_and_garbage() {
        let mut headers = HeaderMap::new();
        assert_eq!(parse_rate_limit_delay(&headers), None);
        headers.insert("X-RateLimit-Delay", "0".parse().unwrap());
        assert_eq!(parse_rate_limit_delay(&headers), None);
        headers.insert("X-RateLimit-Delay", "soon".parse().unwrap());
        assert_eq!(parse_rate_limit_delay(&headers), None);
    }

    #[tokio::test]
    async fn pause_delays_next_acquire() {
        let gate = Gate::new();
        gate.pause_for(Duration::from_millis(100));
        let start = Instant::now();
        let _permit = gate.acquire().await;
        assert!(start.elapsed() >= Duration::from_millis(90));
    }

    #[tokio::test]
    async fn limits_in_flight_requests() {
        let gate = Gate::new();
        let mut held = Vec::new();
        for _ in 0..MAX_IN_FLIGHT {
            held.push(gate.acquire().await);
        }
        assert_eq!(gate.permits.available_permits(), 0);
        drop(held);
        assert_eq!(gate.permits.available_permits(), MAX_IN_FLIGHT);
    }
}
