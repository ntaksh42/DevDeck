use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum AdoError {
    #[error("authentication failed")]
    Unauthorized,
    #[error("rate limited; retry in {0:?}")]
    RateLimited(Duration),
    #[error("api error: status {status}, body: {body}")]
    Api { status: u16, body: String },
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("auth provider error: {0}")]
    Auth(String),
}

pub type Result<T> = std::result::Result<T, AdoError>;
