use std::collections::HashMap;

use serde::Deserialize;

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
    pub properties: Option<HashMap<String, IdentityProperty>>,
}

impl AuthenticatedUser {
    pub fn property_value(&self, name: &str) -> Option<&str> {
        property_value(self.properties.as_ref()?, name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: Option<String>,
    pub descriptor: Option<String>,
    pub subject_descriptor: Option<String>,
    pub provider_display_name: Option<String>,
    pub custom_display_name: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
    pub properties: Option<HashMap<String, IdentityProperty>>,
}

#[derive(Debug, Deserialize)]
pub struct IdentityProperty {
    #[serde(rename = "$value")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPickerIdentity {
    #[serde(default, alias = "entityId")]
    pub entity_id: Option<String>,
    #[serde(default, alias = "originId")]
    pub origin_id: Option<String>,
    #[serde(default, alias = "localId")]
    pub local_id: Option<String>,
    #[serde(default, alias = "subjectDescriptor")]
    pub subject_descriptor: Option<String>,
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, alias = "mailAddress", alias = "mail")]
    pub mail_address: Option<String>,
    #[serde(default, alias = "signInAddress")]
    pub sign_in_address: Option<String>,
    #[serde(default, alias = "entityType")]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
}

impl Identity {
    pub fn property_value(&self, name: &str) -> Option<&str> {
        property_value(self.properties.as_ref()?, name)
    }
}

fn property_value<'a>(
    properties: &'a HashMap<String, IdentityProperty>,
    name: &str,
) -> Option<&'a str> {
    properties
        .get(name)
        .or_else(|| {
            properties
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value)
        })
        .and_then(|property| property.value.as_deref())
        .filter(|value| !value.trim().is_empty())
}
