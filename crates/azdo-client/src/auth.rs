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

// async_trait adds #[must_use] to methods already returning a must-use Future.
#[allow(clippy::double_must_use)]
#[async_trait::async_trait]
pub trait AdoCredentialProvider: Send + Sync {
    async fn auth_header_value(&self) -> Result<String>;

    /// Drops any cached credential after the server rejected it with 401.
    /// Returns `true` when a fresh credential may now be obtained, so the
    /// request is worth re-sending.
    fn invalidate(&self) -> bool {
        false
    }
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
    /// Upper bound for one `az` invocation. A hung CLI would otherwise hold
    /// `fetch_lock` forever and stall every request until the app restarts.
    fetch_timeout: Duration,
}

/// Generous enough for a cold `az` start, short enough to unblock the app.
const AZ_FETCH_TIMEOUT: Duration = Duration::from_secs(30);

impl AzureCliProvider {
    pub fn new() -> Self {
        let resource = resolve_cli_resource(std::env::var(AZURE_CLI_RESOURCE_ENV).ok().as_deref());
        Self {
            token_source: Arc::new(AzCommandTokenSource { resource }),
            cache: Mutex::new(None),
            fetch_lock: tokio::sync::Mutex::new(()),
            token_ttl: Duration::from_secs(300),
            fetch_timeout: AZ_FETCH_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_token_source(token_source: Arc<dyn AzureCliTokenSource>, token_ttl: Duration) -> Self {
        Self {
            token_source,
            cache: Mutex::new(None),
            fetch_lock: tokio::sync::Mutex::new(()),
            token_ttl,
            fetch_timeout: AZ_FETCH_TIMEOUT,
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
        let fetched = tokio::time::timeout(
            self.fetch_timeout,
            tokio::task::spawn_blocking(move || token_source.access_token()),
        )
        .await
        .map_err(|_| {
            AdoError::Auth(format!(
                "Azure CLI token request timed out after {}s; check 'az login' and retry",
                self.fetch_timeout.as_secs()
            ))
        })?
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
        let lifetime = cache_lifetime(fetched.expires_in, self.token_ttl);
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

    fn invalidate(&self) -> bool {
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
        true
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

/// Floor for the cache lifetime of a token close to expiry, so a burst of
/// requests does not shell out to `az` once per request. Never longer than the
/// token's own remaining life.
const MIN_TOKEN_LIFETIME: Duration = Duration::from_secs(30);

fn cache_lifetime(expires_in: Option<Duration>, fallback: Duration) -> Duration {
    match expires_in {
        Some(expires_in) => expires_in
            .saturating_sub(TOKEN_EXPIRY_MARGIN)
            .max(MIN_TOKEN_LIFETIME.min(expires_in)),
        None => fallback,
    }
}

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

/// Builds the `az` invocation. On Windows the Azure CLI installs `az.cmd`, which
/// `Command::new("az")` cannot resolve (it only looks for `az.exe`), so it runs
/// through `cmd /C`. `CREATE_NO_WINDOW` stops a console window from flashing
/// each time a token is fetched from the GUI app.
fn az_command() -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new("cmd");
        command.args(["/C", "az"]).creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new("az")
    }
}

struct AzCommandTokenSource {
    resource: String,
}

impl AzureCliTokenSource for AzCommandTokenSource {
    fn access_token(&self) -> Result<AzureCliToken> {
        let output = az_command()
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
            // `cmd /C` reports a missing `az` as exit code 9009 with a localised
            // message, so map it back to the install guidance.
            if cfg!(windows) && output.status.code() == Some(9009) {
                return Err(AdoError::Auth(
                    "failed to run Azure CLI; install Azure CLI and run 'az login'".to_string(),
                ));
            }
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
mod tests_fetch;

#[cfg(test)]
mod tests;
