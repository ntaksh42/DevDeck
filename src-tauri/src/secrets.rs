use keyring::Entry;

use crate::error::Result;

const SERVICE_NAME: &str = "AzDoDeck";

#[derive(Debug, Clone, Default)]
pub struct SecretStore;

impl SecretStore {
    pub fn set_pat(&self, credential_key: &str, pat: &str) -> Result<()> {
        Entry::new(SERVICE_NAME, credential_key)?.set_password(pat)?;
        Ok(())
    }

    pub fn get_pat(&self, credential_key: &str) -> Result<String> {
        Ok(Entry::new(SERVICE_NAME, credential_key)?.get_password()?)
    }

    pub fn delete_credential(&self, credential_key: &str) -> Result<()> {
        match Entry::new(SERVICE_NAME, credential_key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}
