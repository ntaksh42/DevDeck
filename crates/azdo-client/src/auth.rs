use crate::error::Result;

#[async_trait::async_trait]
pub trait AdoCredentialProvider: Send + Sync {
    async fn auth_header_value(&self) -> Result<String>;
}

pub struct PatProvider {
    pat: String,
}

impl PatProvider {
    pub fn new(pat: impl Into<String>) -> Self {
        Self { pat: pat.into() }
    }
}

#[async_trait::async_trait]
impl AdoCredentialProvider for PatProvider {
    async fn auth_header_value(&self) -> Result<String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let encoded = STANDARD.encode(format!(":{}", self.pat));
        Ok(format!("Basic {encoded}"))
    }
}
