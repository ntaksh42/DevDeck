use serde_json::Value;

use super::types::{Identity, IdentityPickerIdentity};

pub(super) fn collect_identity_picker_identities(
    value: &Value,
    identities: &mut Vec<IdentityPickerIdentity>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_identity_picker_identities(item, identities);
            }
        }
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("identities") {
                for item in items {
                    if let Some(identity) = identity_picker_identity_from_value(item) {
                        identities.push(identity);
                    }
                }
            }
            for child in map.values() {
                collect_identity_picker_identities(child, identities);
            }
        }
        _ => {}
    }
}

fn identity_picker_identity_from_value(value: &Value) -> Option<IdentityPickerIdentity> {
    let mut identity: IdentityPickerIdentity = serde_json::from_value(value.clone()).ok()?;
    if let Some(properties) = value.get("properties") {
        identity.display_name = identity
            .display_name
            .or_else(|| picker_property(properties, "DisplayName"));
        identity.mail_address = identity
            .mail_address
            .or_else(|| picker_property(properties, "Mail"));
        identity.sign_in_address = identity
            .sign_in_address
            .or_else(|| picker_property(properties, "SignInAddress"));
        identity.subject_descriptor = identity
            .subject_descriptor
            .or_else(|| picker_property(properties, "SubjectDescriptor"));
        identity.active = identity
            .active
            .or_else(|| picker_bool_property(properties, "Active"));
    }
    identity_picker_identity_is_user(&identity).then_some(identity)
}

fn identity_picker_identity_is_user(identity: &IdentityPickerIdentity) -> bool {
    let user_type = identity
        .entity_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none_or(|value| value.eq_ignore_ascii_case("user"));
    user_type && identity.active != Some(false)
}

fn picker_property(properties: &Value, name: &str) -> Option<String> {
    let property = properties
        .as_object()?
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value))?;
    property
        .get("$value")
        .or_else(|| property.get("value"))
        .and_then(Value::as_str)
        .or_else(|| property.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn picker_bool_property(properties: &Value, name: &str) -> Option<bool> {
    let property = properties
        .as_object()?
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value))?;
    property
        .get("$value")
        .or_else(|| property.get("value"))
        .and_then(Value::as_bool)
        .or_else(|| property.as_bool())
        .or_else(|| {
            property
                .get("$value")
                .or_else(|| property.get("value"))
                .and_then(Value::as_str)
                .or_else(|| property.as_str())
                .and_then(|value| value.parse::<bool>().ok())
        })
}

pub(super) fn identity_search_filters(query: &str) -> &'static [&'static str] {
    if query.contains('@') {
        &["MailAddress", "General", "AccountName", "DisplayName"]
    } else {
        &["General", "DisplayName", "MailAddress", "AccountName"]
    }
}

pub(super) fn identity_search_rank(identity: &Identity, query: &str) -> usize {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return 0;
    }

    let values = [
        identity.provider_display_name.as_deref(),
        identity.custom_display_name.as_deref(),
        identity.display_name.as_deref(),
        identity.unique_name.as_deref(),
        identity.property_value("Mail"),
        identity.property_value("Account"),
        identity.property_value("Alias"),
    ];

    if values
        .iter()
        .flatten()
        .any(|value| value.eq_ignore_ascii_case(&query))
    {
        return 0;
    }
    if values
        .iter()
        .flatten()
        .any(|value| value.to_ascii_lowercase().starts_with(&query))
    {
        return 1;
    }
    2
}

pub(super) fn identity_is_duplicate(existing: &[Identity], candidate: &Identity) -> bool {
    existing.iter().any(|identity| {
        same_optional_identity_value(identity.id.as_deref(), candidate.id.as_deref())
            || same_optional_identity_value(
                identity.descriptor.as_deref(),
                candidate.descriptor.as_deref(),
            )
            || same_optional_identity_value(
                identity.subject_descriptor.as_deref(),
                candidate.subject_descriptor.as_deref(),
            )
            || same_optional_identity_value(
                identity.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || same_optional_identity_value(
                identity.property_value("Mail"),
                candidate.property_value("Mail"),
            )
            || same_optional_identity_value(
                identity.property_value("Account"),
                candidate.property_value("Account"),
            )
    })
}

fn same_optional_identity_value(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}
