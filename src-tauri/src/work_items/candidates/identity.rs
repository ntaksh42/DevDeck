use azdo_client::{AdoClient, Identity, IdentityPickerIdentity};

use crate::db::Organization;
use crate::error::Result;

/// Search the identity picker and map each result, falling back to the
/// identities API (mapped through `fallback`) when the picker call fails.
///
/// `search_mentions` and `search_assignees` share this exact control flow;
/// only the per-identity mappers differ.
pub(crate) async fn search_identity_picker_with_fallback<T, P, F>(
    client: &AdoClient,
    query: &str,
    limit: usize,
    picker: P,
    fallback: F,
) -> Result<Vec<T>>
where
    P: FnMut(IdentityPickerIdentity) -> Option<T>,
    F: FnMut(Identity) -> Option<T>,
{
    match client.search_identity_picker(query, limit).await {
        Ok(identities) => Ok(identities.into_iter().filter_map(picker).collect()),
        Err(error) => {
            tracing::warn!(%error, "identity picker search failed; falling back to identities API");
            Ok(client
                .search_identities(query, limit)
                .await?
                .into_iter()
                .filter_map(fallback)
                .collect())
        }
    }
}

/// Azure DevOps resolves markdown mentions only for storage-key GUIDs.
pub(crate) fn is_mention_resolvable_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

pub(crate) fn is_authenticated_user(
    id: &str,
    display_name: &str,
    unique_name: Option<&str>,
    organization: &Organization,
) -> bool {
    let uid = organization.authenticated_user_id.as_deref().unwrap_or("");
    let self_unique = organization
        .authenticated_user_unique_name
        .as_deref()
        .unwrap_or("");
    let dn = organization
        .authenticated_user_display_name
        .as_deref()
        .unwrap_or("");
    if !uid.is_empty()
        && (id.eq_ignore_ascii_case(uid)
            || unique_name.is_some_and(|un| un.eq_ignore_ascii_case(uid)))
    {
        return true;
    }
    if !self_unique.is_empty() && unique_name.is_some_and(|un| un.eq_ignore_ascii_case(self_unique))
    {
        return true;
    }
    if !dn.is_empty() && display_name.eq_ignore_ascii_case(dn) {
        // Same display name, but a unique name that provably belongs to
        // someone else: do not treat a namesake as the authenticated user.
        let provably_different = !self_unique.is_empty()
            && unique_name.is_some_and(|un| !un.eq_ignore_ascii_case(self_unique));
        return !provably_different;
    }
    false
}

pub(crate) fn is_user_like_identity(identity: &Identity) -> bool {
    let schema = identity.property_value("SchemaClassName");
    let special_type = identity.property_value("SpecialType");
    let meta_type = identity.property_value("MetaType");
    let active = identity.property_value("Active");
    let domain = identity.property_value("Domain");
    let account = identity.property_value("Account");
    let has_mail_or_account = identity.property_value("Mail").is_some()
        || account.is_some()
        || identity
            .unique_name
            .as_deref()
            .is_some_and(|value| value.contains('@'));

    if is_azure_devops_service_identity(identity, domain, account) {
        return false;
    }
    if active.is_some_and(|value| value.eq_ignore_ascii_case("false")) {
        return false;
    }
    if schema.is_some_and(|value| !value.eq_ignore_ascii_case("User")) {
        return false;
    }
    if special_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }
    if meta_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }

    schema.is_some() || has_mail_or_account || identity.id.is_some()
}

pub(crate) fn is_azure_devops_service_identity(
    identity: &Identity,
    domain: Option<&str>,
    account: Option<&str>,
) -> bool {
    let service_domain = domain.is_some_and(|value| {
        value.eq_ignore_ascii_case("Build") || value.eq_ignore_ascii_case("AgentPool")
    });
    let service_account = account.is_some_and(|value| {
        let value = value.to_lowercase();
        value.starts_with("build\\")
            || value.starts_with("agentpool\\")
            || value == "project collection build service"
    });
    let service_display = [
        identity.provider_display_name.as_deref(),
        identity.custom_display_name.as_deref(),
        identity.display_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| is_azure_devops_service_identity_name(value, None));

    service_domain || service_account || service_display
}

pub(crate) fn is_azure_devops_service_identity_name(
    display_name: &str,
    unique_name: Option<&str>,
) -> bool {
    let display_name = display_name.to_lowercase();
    display_name.contains(" build service (")
        || display_name.starts_with("agent pool service")
        || unique_name.is_some_and(|value| {
            let value = value.to_lowercase();
            value.starts_with("build\\")
                || value.starts_with("agentpool\\")
                || value.eq_ignore_ascii_case("Project Collection Build Service")
        })
}

pub(crate) fn same_optional_mention_value(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}

/// Returns true only when both sides have a unique_name and they differ — the only
/// case where same display_name candidates are definitively distinct people.
pub(crate) fn both_unique_names_differ(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(l), Some(r)) => !l.eq_ignore_ascii_case(r),
        _ => false,
    }
}
