use serde::Serialize;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("secret storage error: {0}")]
    Secret(String),
    /// Azure DevOps rejected the request as unauthenticated (HTTP 401). Kept
    /// distinct from the generic `AzureDevOps` string so the frontend can offer
    /// a re-authentication path instead of showing an opaque error.
    #[error("Azure DevOps authentication failed. Re-authenticate this organization in Settings.")]
    Unauthorized,
    #[error("Azure DevOps error: {0}")]
    AzureDevOps(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

impl AppError {
    /// Machine-readable error kind serialized to the frontend alongside the
    /// human message. Only set for errors the UI branches on programmatically.
    fn code(&self) -> Option<&'static str> {
        match self {
            Self::Unauthorized => Some("unauthorized"),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        CommandError {
            message: self.to_string(),
            code: self.code().map(ToString::to_string),
        }
        .serialize(serializer)
    }
}

impl From<azdo_client::AdoError> for AppError {
    fn from(value: azdo_client::AdoError) -> Self {
        match value {
            azdo_client::AdoError::Unauthorized => Self::Unauthorized,
            other => Self::AzureDevOps(format_ado_error(other)),
        }
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

    #[test]
    fn app_error_from_ado_unauthorized_maps_to_unauthorized_kind() {
        let error = AppError::from(azdo_client::AdoError::Unauthorized);
        assert!(matches!(error, AppError::Unauthorized));
        assert_eq!(error.code(), Some("unauthorized"));
    }

    #[test]
    fn unauthorized_serializes_machine_readable_code() {
        let json = serde_json::to_value(AppError::Unauthorized).unwrap();
        assert_eq!(json["code"], "unauthorized");
        assert_eq!(
            json["message"],
            "Azure DevOps authentication failed. Re-authenticate this organization in Settings."
        );
    }

    #[test]
    fn non_unauthorized_errors_omit_the_code_field() {
        let json = serde_json::to_value(AppError::Database("boom".into())).unwrap();
        assert!(json.get("code").is_none());
    }
}
