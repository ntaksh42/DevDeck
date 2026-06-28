use std::fmt::Write as _;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    #[error("authentication failed")]
    Unauthorized,
    #[error("rate limited; retry in {0:?}")]
    RateLimited(Duration),
    #[error("{}", format_api_error(*status, message.as_deref(), body))]
    Api {
        status: u16,
        body: String,
        /// `message` field from a structured GitHub error body, when present.
        /// The raw `body` is always kept.
        message: Option<String>,
    },
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("auth provider error: {0}")]
    Auth(String),
}

impl GitHubError {
    /// Builds an `Api` error, extracting `message` when the response body is a
    /// structured GitHub error JSON. The raw body is preserved.
    pub fn api(status: u16, body: String) -> Self {
        let message = parse_structured_message(&body);
        Self::Api {
            status,
            body,
            message,
        }
    }
}

fn format_api_error(status: u16, message: Option<&str>, body: &str) -> String {
    let mut out = format!("api error: status {status}");
    match message {
        Some(message) => {
            let _ = write!(out, ", message: {message}");
        }
        None => {
            let _ = write!(out, ", body: {body}");
        }
    }
    out
}

/// Extracts the `message` field from a GitHub structured error body. Returns
/// `None` when the body is not JSON or lacks a non-empty message.
fn parse_structured_message(body: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    value
        .get("message")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
}

pub type Result<T> = std::result::Result<T, GitHubError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_parses_structured_message() {
        let error = GitHubError::api(
            422,
            r#"{"message":"Validation Failed","documentation_url":"https://docs.github.com"}"#
                .to_string(),
        );
        match error {
            GitHubError::Api {
                status, message, ..
            } => {
                assert_eq!(status, 422);
                assert_eq!(message.as_deref(), Some("Validation Failed"));
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn api_keeps_raw_body_when_not_structured() {
        let error = GitHubError::api(500, "internal error".to_string());
        assert_eq!(
            error.to_string(),
            "api error: status 500, body: internal error"
        );
    }
}
