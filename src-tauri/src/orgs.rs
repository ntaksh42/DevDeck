use std::sync::Arc;

use azdo_client::{AdoClient, AzureCliProvider, PatProvider};
use serde::Deserialize;

use crate::db::{AppDatabase, Organization, OrganizationDraft};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

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

    pub async fn add_pat_organization(
        &self,
        input: AddPatOrganizationInput,
    ) -> Result<Organization> {
        let organization = normalize_organization(&input.organization)?;
        let pat = input.pat.trim();
        if pat.is_empty() {
            return Err(AppError::InvalidInput("PAT is required".to_string()));
        }

        let client = AdoClient::new(&organization, Arc::new(PatProvider::new(pat)))?;
        let connection_data = client.connection_data().await?;
        let credential_key = credential_key(&organization);
        self.secrets.set_pat(&credential_key, pat)?;

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
        })
    }

    pub async fn add_azure_cli_organization(
        &self,
        input: AddAzureCliOrganizationInput,
    ) -> Result<Organization> {
        let organization = normalize_organization(&input.organization)?;
        let client = AdoClient::new(&organization, Arc::new(AzureCliProvider::new()))?;
        let connection_data = client.connection_data().await?;
        let credential_key = azure_cli_credential_key(&organization);

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
        })
    }
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
}
