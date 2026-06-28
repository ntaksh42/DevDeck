use super::super::*;

fn test_org(
    authenticated_user_id: Option<&str>,
    authenticated_user_display_name: Option<&str>,
) -> Organization {
    test_org_with_unique_name(authenticated_user_id, authenticated_user_display_name, None)
}

fn test_org_with_unique_name(
    authenticated_user_id: Option<&str>,
    authenticated_user_display_name: Option<&str>,
    authenticated_user_unique_name: Option<&str>,
) -> Organization {
    Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: None,
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: authenticated_user_id.map(ToString::to_string),
        authenticated_user_display_name: authenticated_user_display_name.map(ToString::to_string),
        authenticated_user_unique_name: authenticated_user_unique_name.map(ToString::to_string),
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
        provider_kind: "azdo".to_string(),
    }
}

#[test]
fn is_authenticated_user_matches_by_id() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user("user-1", "someone else", None, &org));
    assert!(is_authenticated_user("USER-1", "someone else", None, &org));
}

#[test]
fn is_authenticated_user_matches_by_display_name() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "naoto akashi",
        None,
        &org
    ));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "Naoto Akashi",
        None,
        &org
    ));
}

#[test]
fn is_authenticated_user_matches_by_unique_name() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "someone else",
        Some("user-1"),
        &org
    ));
}

#[test]
fn is_authenticated_user_does_not_match_different_person() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(!is_authenticated_user(
        "user-2",
        "other person",
        Some("other@example.com"),
        &org
    ));
}

#[test]
fn is_authenticated_user_no_stored_user_never_matches() {
    let org = test_org(None, None);
    assert!(!is_authenticated_user("user-1", "naoto akashi", None, &org));
}

#[test]
fn is_authenticated_user_matches_by_stored_unique_name() {
    let org = test_org_with_unique_name(
        Some("user-1"),
        Some("naoto akashi"),
        Some("naoto@example.com"),
    );
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "someone else",
        Some("Naoto@Example.com"),
        &org
    ));
}

#[test]
fn is_authenticated_user_keeps_namesake_with_different_unique_name() {
    let org = test_org_with_unique_name(
        Some("user-1"),
        Some("naoto akashi"),
        Some("naoto@example.com"),
    );
    // Same display name but a different e-mail: this is another person.
    assert!(!is_authenticated_user(
        "descriptor-other",
        "naoto akashi",
        Some("other.naoto@example.com"),
        &org
    ));
    // Without a unique name we cannot prove it's someone else; keep filtering.
    assert!(is_authenticated_user(
        "descriptor-other",
        "naoto akashi",
        None,
        &org
    ));
}
