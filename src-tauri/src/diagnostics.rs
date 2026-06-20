use serde::Serialize;

use crate::db::AppDatabase;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    pub file_path: String,
}

/// Builds a plain-text diagnostics bundle for bug reports. Deliberately omits
/// every secret: PAT / Azure CLI tokens are never read here, and the keyring
/// credential key on each organization is excluded. Only stable identifiers
/// (org name, base URL, auth provider), the schema version, and sync-state
/// summaries (including the last error MESSAGE) are included.
pub fn build_diagnostics_report(db: &AppDatabase, app_version: &str, os: &str) -> Result<String> {
    let schema_version = db.schema_version()?;
    let organizations = db.list_organizations().unwrap_or_default();
    let sync_states = db.list_sync_states().unwrap_or_default();

    let mut report = String::new();
    report.push_str("AzDoDeck diagnostics\n");
    report.push_str("====================\n");
    report.push_str(&format!("App version: {app_version}\n"));
    report.push_str(&format!("OS: {os}\n"));
    report.push_str(&format!("Database schema version: {schema_version}\n"));

    report.push_str(&format!("\nOrganizations ({}):\n", organizations.len()));
    for org in &organizations {
        // Note: credential_key and any token are intentionally NOT included.
        report.push_str(&format!(
            "  - {} [{}] {}\n",
            org.name, org.auth_provider, org.base_url
        ));
    }

    report.push_str(&format!("\nSync state ({}):\n", sync_states.len()));
    if sync_states.is_empty() {
        report.push_str("  (no sync has completed yet)\n");
    }
    for state in &sync_states {
        report.push_str(&format!(
            "  - {} (org {}): last_synced={}, errors={}\n",
            state.scope,
            state.org_id,
            state.last_synced_at.as_deref().unwrap_or("never"),
            state.error_count,
        ));
        if let Some(error) = &state.last_error {
            report.push_str(&format!("      last error: {error}\n"));
        }
        if let Some(warning) = &state.last_warning {
            report.push_str(&format!("      last warning: {warning}\n"));
        }
    }

    report.push_str(
        "\nNote: tracing logs are written to the app log directory and are not bundled here.\n",
    );

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AppDatabase, OrganizationDraft};

    fn temp_db() -> (AppDatabase, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = AppDatabase::new(dir.path().join("test.sqlite3"));
        db.initialize().unwrap();
        (db, dir)
    }

    #[test]
    fn report_includes_version_and_schema_but_no_credential_key() {
        let (db, _dir) = temp_db();
        db.upsert_organization(OrganizationDraft {
            id: "org1".to_string(),
            name: "Contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
        })
        .unwrap();

        let report = build_diagnostics_report(&db, "9.9.9", "testos").unwrap();

        assert!(report.contains("App version: 9.9.9"));
        assert!(report.contains("Database schema version:"));
        assert!(report.contains("Contoso"));
        assert!(report.contains("https://dev.azure.com/contoso"));
        // The keyring credential key must never leak into the bundle.
        assert!(!report.contains("azdodeck:org:contoso:pat"));
        assert!(!report.to_lowercase().contains("credential_key"));
    }
}
