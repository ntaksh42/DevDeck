use std::time::Duration;

use reqwest::header::HeaderMap;
use serde::de::DeserializeOwned;
use url::Url;

use crate::error::{AdoError, Result};

pub(crate) fn url_path_is_within_base(url_path: &str, base_path: &str) -> bool {
    if url_path.eq_ignore_ascii_case(base_path) {
        return true;
    }
    url_path.len() > base_path.len()
        && url_path.as_bytes().get(base_path.len()) == Some(&b'/')
        && url_path[..base_path.len()].eq_ignore_ascii_case(base_path)
}

pub(crate) fn same_azure_devops_organization_url(url: &Url, base_url: &Url) -> bool {
    if url.host_str() == base_url.host_str() {
        return true;
    }
    is_legacy_visualstudio_org_url(url, base_url)
}

pub(crate) fn is_legacy_visualstudio_org_url(url: &Url, base_url: &Url) -> bool {
    let Some(url_host) = url.host_str() else {
        return false;
    };
    let Some(base_host) = base_url.host_str() else {
        return false;
    };
    if !base_host.eq_ignore_ascii_case("dev.azure.com") {
        return false;
    }
    let org = base_url
        .path_segments()
        .and_then(|mut segments| segments.find(|segment| !segment.is_empty()));
    let Some(org) = org else {
        return false;
    };
    url_host.eq_ignore_ascii_case(&format!("{org}.visualstudio.com"))
}

pub(crate) fn vssps_base_url(base_url: &Url) -> Result<Url> {
    if base_url.host_str() != Some("dev.azure.com") {
        return Ok(base_url.clone());
    }

    let organization = base_url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AdoError::Auth("missing organization in base URL".to_string()))?;
    Url::parse(&format!("https://vssps.dev.azure.com/{organization}/"))
        .map_err(|e| AdoError::Auth(e.to_string()))
}

pub(crate) fn almsearch_base_url(base_url: &Url) -> Result<Url> {
    if base_url.host_str() != Some("dev.azure.com") {
        return Ok(base_url.clone());
    }

    let organization = base_url
        .path_segments()
        .and_then(|mut segments| segments.next())
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AdoError::Auth("missing organization in base URL".to_string()))?;
    Url::parse(&format!("https://almsearch.dev.azure.com/{organization}/"))
        .map_err(|e| AdoError::Auth(e.to_string()))
}

/// Reads a successful response body and deserializes it as JSON.
///
/// A failure to decode a 2xx body is a payload-shape problem, not a transport
/// problem, so it surfaces as `AdoError::Parse` rather than `AdoError::Network`.
/// Reading the body itself can still fail at the transport layer (e.g. a
/// dropped connection mid-stream), which remains `AdoError::Network`.
pub(crate) async fn decode_json<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T> {
    let bytes = resp.bytes().await?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub(crate) fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers.get("Retry-After")?.to_str().ok()?.trim();

    // RFC 9110: Retry-After is either delta-seconds or an HTTP-date.
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    // HTTP-date form (e.g. "Wed, 21 Oct 2015 07:28:00 GMT"). Wait until that
    // instant; a past or invalid date falls back to a zero wait so callers use
    // their own backoff.
    let target = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let delta = target.signed_duration_since(chrono::Utc::now());
    Some(delta.to_std().unwrap_or(Duration::ZERO))
}
