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
    #[error("Azure DevOps error: {0}")]
    AzureDevOps(String),
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
        Self::AzureDevOps(value.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        Self::Secret(value.to_string())
    }
}
