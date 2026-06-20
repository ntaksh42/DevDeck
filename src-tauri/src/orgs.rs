use std::sync::Arc;

use azdo_client::{AdoClient, AdoError, AzureCliProvider, PatProvider};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization, OrganizationDraft};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

/// Health of an organization's stored credential, probed without ever
/// surfacing the secret itself.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CredentialHealth {
    pub organization_id: String,
    pub auth_provider: String,
    /// "ok" | "unauthorized" | "error".
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPatOrganizationInput {
    pub organization: String,
    pub pat: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAzureCliOrganizationInput {
    pub organization: String,
}

#[derive(Debug, Clone)]
pub struct OrganizationService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl OrganizationService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn list(&self) -> Result<Vec<Organization>> {
        self.db.list_organizations()
    }

    /// Probes an organization's credential with a lightweight authenticated
    /// call (connection data), reporting ok / unauthorized / error. The secret
    /// is never read out or included in the message.
    pub async fn check_credential(&self, organization_id: &str) -> Result<CredentialHealth> {
        let organization = self.db.resolve_organization(Some(organization_id))?;
        let auth_provider = organization.auth_provider.clone();

        let (status, message) = match client_for_organization(&organization, &self.secrets) {
            Ok(client) => match client.connection_data().await {
                Ok(_) => ("ok", None),
                Err(AdoError::Unauthorized) => (
                    "unauthorized",
                    Some(
                        "Authentication failed. Re-authenticate this organization in Settings."
                            .to_string(),
                    ),
                ),
                Err(_) => (
                    "error",
                    Some(
                        "Could not reach Azure DevOps. Check the connection and try again."
                            .to_string(),
                    ),
                ),
            },
            Err(_) => (
                "error",
                Some("Stored credential is unavailable. Re-add this organization.".to_string()),
            ),
        };

        Ok(CredentialHealth {
            organization_id: organization.id,
            auth_provider,
            status: status.to_string(),
            message,
        })
    }

    pub async fn add_pat_organization(
        &self,
        input: AddPatOrganizationInput,
    ) -> Result<Organization> {
        let organization = normalize_organization(&input.organization)?;
        let pat = input.pat.trim();
        if pat.is_empty() {
            return Err(AppError::InvalidInput("PAT is required".to_string()));
        }

        tracing::info!(
            organization = %organization,
            auth_provider = "pat",
            "validating Azure DevOps organization"
        );
        let client = AdoClient::new(&organization, Arc::new(PatProvider::new(pat)))?;
        let connection_data = client.connection_data().await?;
        let credential_key = credential_key(&organization);
        self.purge_stale_credential(&organization, &credential_key)?;
        self.secrets.set_pat(&credential_key, pat)?;

        let authenticated_user_unique_name =
            authenticated_user_unique_name(&connection_data.authenticated_user);
        self.db.upsert_organization(OrganizationDraft {
            id: organization.clone(),
            name: organization.clone(),
            display_name: Some(organization.clone()),
            base_url: format!("https://dev.azure.com/{organization}"),
            auth_provider: "pat".to_string(),
            credential_key,
            authenticated_user_id: Some(connection_data.authenticated_user.id),
            authenticated_user_display_name: connection_data
                .authenticated_user
                .provider_display_name,
            authenticated_user_unique_name,
        })
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        // Deleting is idempotent: a missing organization (e.g. a double delete or
        // a race with another action) is treated as already deleted, not an error.
        let Some(org) = self.db.get_organization(id)? else {
            return Ok(());
        };
        // Delete the DB row first. If it fails (e.g. SQLITE_BUSY), the secret
        // is still intact and the organization stays usable, rather than
        // becoming an un-authenticatable zombie. delete_credential treats a
        // missing entry as success, so a retried delete remains idempotent.
        self.db.delete_organization(id)?;
        self.secrets.delete_credential(&org.credential_key)
    }

    /// Remove any credential stored for `organization` that does not match the
    /// credential key about to be written. When an organization is re-added with
    /// a different auth provider the previous provider's secret (for example a
    /// PAT replaced by Azure CLI) would otherwise stay in the OS credential
    /// store, so it is deleted here before the new credential is stored.
    fn purge_stale_credential(&self, organization: &str, new_key: &str) -> Result<()> {
        for stale_key in stale_credential_keys(organization, new_key) {
            self.secrets.delete_credential(&stale_key)?;
        }
        Ok(())
    }

    pub async fn add_azure_cli_organization(
        &self,
        input: AddAzureCliOrganizationInput,
    ) -> Result<Organization> {
        let organization = normalize_organization(&input.organization)?;
        tracing::info!(
            organization = %organization,
            auth_provider = "azure_cli",
            "validating Azure DevOps organization"
        );
        let client = AdoClient::new(&organization, Arc::new(AzureCliProvider::new()))?;
        let connection_data = client.connection_data().await?;
        let credential_key = azure_cli_credential_key(&organization);
        self.purge_stale_credential(&organization, &credential_key)?;

        let authenticated_user_unique_name =
            authenticated_user_unique_name(&connection_data.authenticated_user);
        self.db.upsert_organization(OrganizationDraft {
            id: organization.clone(),
            name: organization.clone(),
            display_name: Some(organization.clone()),
            base_url: format!("https://dev.azure.com/{organization}"),
            auth_provider: "azure_cli".to_string(),
            credential_key,
            authenticated_user_id: Some(connection_data.authenticated_user.id),
            authenticated_user_display_name: connection_data
                .authenticated_user
                .provider_display_name,
            authenticated_user_unique_name,
        })
    }
}

fn authenticated_user_unique_name(user: &azdo_client::AuthenticatedUser) -> Option<String> {
    user.property_value("Account")
        .or_else(|| user.property_value("Mail"))
        .map(ToString::to_string)
}

fn normalize_organization(value: &str) -> Result<String> {
    let organization = value.trim().to_ascii_lowercase();
    if organization.is_empty() {
        return Err(AppError::InvalidInput(
            "organization is required".to_string(),
        ));
    }
    if organization.len() > 100 {
        return Err(AppError::InvalidInput(
            "organization must be 100 characters or fewer".to_string(),
        ));
    }
    if organization.starts_with('-') || organization.ends_with('-') {
        return Err(AppError::InvalidInput(
            "organization cannot start or end with '-'".to_string(),
        ));
    }
    if !organization
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(AppError::InvalidInput(
            "organization can contain only letters, numbers, and '-'".to_string(),
        ));
    }
    Ok(organization)
}

fn credential_key(organization: &str) -> String {
    format!("azdodeck:org:{organization}:pat")
}

fn azure_cli_credential_key(organization: &str) -> String {
    format!("azdodeck:org:{organization}:azure-cli")
}

/// The credential keys for `organization` that should be removed when the
/// credential `new_key` is about to be stored. Returns every provider key for
/// the organization except `new_key`, so re-adding an organization under a
/// different auth provider does not leave the previous provider's secret behind.
fn stale_credential_keys(organization: &str, new_key: &str) -> Vec<String> {
    [
        credential_key(organization),
        azure_cli_credential_key(organization),
    ]
    .into_iter()
    .filter(|key| key != new_key)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_valid_slug() {
        assert_eq!(
            normalize_organization(" Contoso-Dev42 ").unwrap(),
            "contoso-dev42"
        );
    }

    #[test]
    fn normalize_rejects_invalid_slug() {
        assert!(normalize_organization("").is_err());
        assert!(normalize_organization("-contoso").is_err());
        assert!(normalize_organization("contoso_ado").is_err());
    }

    #[test]
    fn credential_key_is_deterministic() {
        assert_eq!(
            credential_key("contoso"),
            "azdodeck:org:contoso:pat".to_string()
        );
        assert_eq!(
            azure_cli_credential_key("contoso"),
            "azdodeck:org:contoso:azure-cli".to_string()
        );
    }

    #[test]
    fn switching_provider_purges_the_other_credential_key() {
        // Re-adding an org with PAT auth must target the azure-cli key for
        // removal (and vice versa), while never deleting the key being written.
        assert_eq!(
            stale_credential_keys("contoso", &credential_key("contoso")),
            vec!["azdodeck:org:contoso:azure-cli".to_string()]
        );
        assert_eq!(
            stale_credential_keys("contoso", &azure_cli_credential_key("contoso")),
            vec!["azdodeck:org:contoso:pat".to_string()]
        );
    }

    #[test]
    fn delete_is_idempotent_for_missing_organization() {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let service = OrganizationService::new(db, SecretStore);

        // Deleting an organization that was never added must succeed, and a
        // repeated delete must stay successful rather than erroring.
        assert!(service.delete("never-existed").is_ok());
        assert!(service.delete("never-existed").is_ok());
    }
}
