use std::sync::Arc;

use azdo_client::{AdoClient, AzureCliProvider, PatProvider};

use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

pub fn client_for_organization(
    organization: &Organization,
    secrets: &SecretStore,
) -> Result<AdoClient> {
    let provider = organization.auth_provider.as_str();
    let auth: Arc<dyn azdo_client::AdoCredentialProvider> = match provider {
        "pat" => Arc::new(PatProvider::new(
            secrets.get_pat(&organization.credential_key)?,
        )),
        "azure_cli" => Arc::new(AzureCliProvider::new()),
        _ => {
            return Err(AppError::InvalidInput(format!(
                "unsupported auth provider: {provider}"
            )))
        }
    };

    Ok(AdoClient::new(&organization.name, auth)?)
}
