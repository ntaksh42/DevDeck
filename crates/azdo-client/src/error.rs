use std::fmt::Write as _;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum AdoError {
    #[error("authentication failed")]
    Unauthorized,
    #[error("rate limited; retry in {0:?}")]
    RateLimited(Duration),
    #[error("{}", format_api_error(*status, message.as_deref(), body))]
    Api {
        status: u16,
        body: String,
        /// `message` field from a structured Azure DevOps error body, when the
        /// body parses as JSON containing one. The raw `body` is always kept.
        message: Option<String>,
        /// `typeKey` field from a structured Azure DevOps error body, when
        /// present. Helps callers distinguish error causes programmatically.
        type_key: Option<String>,
    },
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("auth provider error: {0}")]
    Auth(String),
    #[error("wiql query shape mismatch: {0}")]
    WiqlQueryShape(String),
}

impl AdoError {
    /// Builds an `Api` error, extracting `message`/`typeKey` when the response
    /// body is a structured Azure DevOps error JSON. The raw body is preserved.
    pub fn api(status: u16, body: String) -> Self {
        let (message, type_key) = parse_structured_error(&body);
        Self::Api {
            status,
            body,
            message,
            type_key,
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

/// Extracts the `message` and `typeKey` fields from an Azure DevOps structured
/// error body. Returns `(None, None)` when the body is not JSON or lacks them.
fn parse_structured_error(body: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return (None, None);
    };

    let message = value
        .get("message")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string);
    let type_key = value
        .get("typeKey")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|type_key| !type_key.is_empty())
        .map(ToString::to_string);

    (message, type_key)
}

pub type Result<T> = std::result::Result<T, AdoError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_parses_structured_message_and_type_key() {
        let error = AdoError::api(
            400,
            r#"{"message":"TF401232: Project does not exist.","typeKey":"ProjectDoesNotExistException"}"#
                .to_string(),
        );

        match error {
            AdoError::Api {
                status,
                body,
                message,
                type_key,
            } => {
                assert_eq!(status, 400);
                assert_eq!(
                    message.as_deref(),
                    Some("TF401232: Project does not exist.")
                );
                assert_eq!(type_key.as_deref(), Some("ProjectDoesNotExistException"));
                assert!(body.contains("ProjectDoesNotExistException"));
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn api_display_prefers_parsed_message() {
        let error = AdoError::api(
            404,
            r#"{"message":"TF401019: The Git repository was not found."}"#.to_string(),
        );

        assert_eq!(
            error.to_string(),
            "api error: status 404, message: TF401019: The Git repository was not found."
        );
    }

    #[test]
    fn api_keeps_raw_body_when_not_structured() {
        let error = AdoError::api(500, "internal error".to_string());

        match &error {
            AdoError::Api {
                body,
                message,
                type_key,
                ..
            } => {
                assert_eq!(body, "internal error");
                assert!(message.is_none());
                assert!(type_key.is_none());
            }
            other => panic!("expected Api error, got {other:?}"),
        }
        assert_eq!(
            error.to_string(),
            "api error: status 500, body: internal error"
        );
    }

    #[test]
    fn api_ignores_blank_structured_fields() {
        let error = AdoError::api(400, r#"{"message":"   ","typeKey":""}"#.to_string());

        match error {
            AdoError::Api {
                message, type_key, ..
            } => {
                assert!(message.is_none());
                assert!(type_key.is_none());
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
