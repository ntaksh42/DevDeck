use serde::Serialize;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotSupported(String),
    #[error("secret storage error: {0}")]
    Secret(String),
    #[error("Operation was cancelled.")]
    Cancelled,
    #[error("Azure DevOps error: {0}")]
    AzureDevOps(String),
    #[error("GitHub error: {0}")]
    GitHub(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub message: String,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        CommandError {
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<azdo_client::AdoError> for AppError {
    fn from(value: azdo_client::AdoError) -> Self {
        Self::AzureDevOps(format_ado_error(value))
    }
}

impl From<github_client::GitHubError> for AppError {
    fn from(value: github_client::GitHubError) -> Self {
        Self::GitHub(format_github_error(value))
    }
}

fn format_github_error(error: github_client::GitHubError) -> String {
    match error {
        github_client::GitHubError::Api {
            status,
            body,
            message,
        } => {
            let message = message.unwrap_or_else(|| body.trim().to_string());
            if message.is_empty() {
                format!("API request failed with status {status}")
            } else {
                format!("API request failed with status {status}: {message}")
            }
        }
        other => other.to_string(),
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        Self::Secret(value.to_string())
    }
}

fn format_ado_error(error: azdo_client::AdoError) -> String {
    match error {
        azdo_client::AdoError::Api {
            status,
            body,
            message,
            ..
        } => {
            let message = message
                .or_else(|| azure_devops_error_message(&body))
                .unwrap_or_else(|| body.trim().to_string());
            if message.is_empty() {
                format!("API request failed with status {status}")
            } else {
                format!("API request failed with status {status}: {message}")
            }
        }
        other => other.to_string(),
    }
}

fn azure_devops_error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("message")
        .or_else(|| value.pointer("/value/Message"))
        .or_else(|| value.pointer("/value/message"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_from_ado_api_error_extracts_message() {
        let error = AppError::from(azdo_client::AdoError::api(
            400,
            r#"{"message":"TF401232: Project does not exist."}"#.to_string(),
        ));

        assert_eq!(
            error.to_string(),
            "Azure DevOps error: API request failed with status 400: TF401232: Project does not exist."
        );
    }

    #[test]
    fn app_error_from_ado_api_error_falls_back_to_value_message_shape() {
        let error = AppError::from(azdo_client::AdoError::api(
            400,
            r#"{"value":{"Message":"Legacy shaped error."}}"#.to_string(),
        ));

        assert_eq!(
            error.to_string(),
            "Azure DevOps error: API request failed with status 400: Legacy shaped error."
        );
    }
}
