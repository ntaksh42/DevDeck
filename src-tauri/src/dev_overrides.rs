//! Environment variables for running the desktop app against a fake Azure
//! DevOps server (`pnpm tauri:fake`, see `scripts/fake-ado/`). Both are unset
//! in normal use.
//!
//! - `DEVDECK_DATA_DIR`: keep the SQLite database and the shared cache in this
//!   folder instead of the real ones, so fake data never reaches them (or
//!   waypoint, which reads the shared cache).
//! - `DEVDECK_ADO_BASE_URL`: send Azure DevOps requests to
//!   `{DEVDECK_ADO_BASE_URL}/{organization}/` instead of
//!   `https://dev.azure.com/{organization}/`.

use std::path::PathBuf;

use azdo_client::AdoClient;
use url::Url;

fn non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn data_dir() -> Option<PathBuf> {
    non_empty("DEVDECK_DATA_DIR").map(PathBuf::from)
}

fn ado_base_url() -> Option<String> {
    non_empty("DEVDECK_ADO_BASE_URL").map(|url| url.trim_end_matches('/').to_string())
}

/// The organization's web base URL (`https://dev.azure.com/{org}` normally).
pub fn organization_base_url(organization: &str) -> String {
    let host = ado_base_url().unwrap_or_else(|| "https://dev.azure.com".to_string());
    format!("{host}/{organization}")
}

/// Points the client at the fake server when `DEVDECK_ADO_BASE_URL` is set.
pub fn apply(client: AdoClient, organization: &str) -> AdoClient {
    let Some(base) = ado_base_url() else {
        return client;
    };
    match Url::parse(&format!("{base}/{organization}/")) {
        Ok(url) => client.with_base_url(url),
        Err(e) => {
            tracing::warn!(error = %e, "DEVDECK_ADO_BASE_URL is not a valid URL; using dev.azure.com");
            client
        }
    }
}
