use std::sync::{Arc, OnceLock};

use azdo_client::{AdoClient, AzureCliProvider, PatProvider};

use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

// Azure CLI tokens are account-wide, and the provider caches them in memory.
// Share one provider so the cache survives across per-command client creation
// instead of shelling out to `az` on every IPC call.
fn shared_azure_cli_provider() -> Arc<AzureCliProvider> {
    static PROVIDER: OnceLock<Arc<AzureCliProvider>> = OnceLock::new();
    PROVIDER
        .get_or_init(|| Arc::new(AzureCliProvider::new()))
        .clone()
}

pub fn client_for_organization(
    organization: &Organization,
    secrets: &SecretStore,
) -> Result<AdoClient> {
    let provider = organization.auth_provider.as_str();
    tracing::debug!(
        organization = %organization.name,
        auth_provider = provider,
        "creating Azure DevOps client"
    );
    let auth: Arc<dyn azdo_client::AdoCredentialProvider> = match provider {
        "pat" => Arc::new(PatProvider::new(
            secrets.get_pat(&organization.credential_key)?,
        )),
        "azure_cli" => shared_azure_cli_provider(),
        _ => {
            return Err(AppError::InvalidInput(format!(
                "unsupported auth provider: {provider}"
            )))
        }
    };

    Ok(AdoClient::new(&organization.name, auth)?)
}
