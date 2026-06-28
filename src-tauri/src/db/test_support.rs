use super::OrganizationDraft;

pub(crate) fn make_org_draft(id: &str) -> OrganizationDraft {
    OrganizationDraft {
        id: id.to_string(),
        name: id.to_string(),
        display_name: None,
        base_url: format!("https://dev.azure.com/{id}"),
        auth_provider: "pat".to_string(),
        credential_key: format!("azdodeck:org:{id}:pat"),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        provider_kind: "azdo".to_string(),
    }
}
