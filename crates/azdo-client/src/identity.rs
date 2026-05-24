use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionData {
    pub authenticated_user: AuthenticatedUser,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedUser {
    pub id: String,
    pub provider_display_name: Option<String>,
    pub descriptor: Option<String>,
}

impl AdoClient {
    pub async fn connection_data(&self) -> Result<ConnectionData> {
        self.get_json("_apis/connectionData", &[("api-version", "7.1-preview")])
            .await
    }
}
