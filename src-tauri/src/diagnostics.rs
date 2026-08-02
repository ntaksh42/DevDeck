//! Builds the diagnostic report attached to bug reports.
//!
//! Secrets are excluded structurally rather than by filtering: this module is
//! handed only the fields it may publish, and never touches the keyring or an
//! `Organization` (which carries `credential_key`). Connections are reduced to
//! `ConnectionFacts` at the call site, so a PAT has no path into a report even
//! if this file is edited carelessly later.

use serde::Serialize;

use crate::db::{SyncState, SCHEMA_VERSION};

/// The publishable facts about one connection. Deliberately omits
/// `credential_key`, tokens, and the authenticated user's identity.
pub struct ConnectionFacts {
    pub id: String,
    pub provider_kind: String,
    pub auth_provider: String,
}

pub struct DiagnosticsInput {
    pub app_version: String,
    pub os: String,
    pub connections: Vec<ConnectionFacts>,
    pub sync_states: Vec<SyncState>,
    /// When true, organization identifiers are replaced with `<org-N>`.
    pub redact_organizations: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub app_version: String,
    pub os: String,
    pub schema_version: i64,
    pub connections: Vec<ConnectionReport>,
    pub sync_states: Vec<SyncStateReport>,
    /// Error messages only; no request bodies or headers.
    pub recent_errors: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionReport {
    pub organization: String,
    pub provider_kind: String,
    pub auth_provider: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateReport {
    pub scope: String,
    pub organization: String,
    pub last_synced_at: Option<String>,
    pub error_count: i64,
}

/// Maps organization ids to stable `<org-N>` placeholders so a report stays
/// internally consistent (the same org reads the same everywhere) without
/// naming the customer.
struct OrgLabels {
    ids: Vec<String>,
    redact: bool,
}

impl OrgLabels {
    fn new(input: &DiagnosticsInput) -> Self {
        let mut ids: Vec<String> = Vec::new();
        for connection in &input.connections {
            if !ids.contains(&connection.id) {
                ids.push(connection.id.clone());
            }
        }
        for state in &input.sync_states {
            if !ids.contains(&state.org_id) {
                ids.push(state.org_id.clone());
            }
        }
        Self {
            ids,
            redact: input.redact_organizations,
        }
    }

    fn label(&self, org_id: &str) -> String {
        if !self.redact {
            return org_id.to_string();
        }
        match self.ids.iter().position(|id| id == org_id) {
            Some(index) => format!("<org-{}>", index + 1),
            None => "<org>".to_string(),
        }
    }

    /// Sync scopes embed the organization id (`prs:contoso`), so redacting only
    /// the dedicated org fields would still leak the name through the scope.
    fn scrub(&self, text: &str) -> String {
        if !self.redact {
            return text.to_string();
        }
        let mut out = text.to_string();
        for (index, id) in self.ids.iter().enumerate() {
            out = out.replace(id.as_str(), &format!("<org-{}>", index + 1));
        }
        out
    }
}

pub fn build_report(input: DiagnosticsInput) -> DiagnosticsReport {
    let labels = OrgLabels::new(&input);

    let connections = input
        .connections
        .iter()
        .map(|connection| ConnectionReport {
            organization: labels.label(&connection.id),
            provider_kind: connection.provider_kind.clone(),
            auth_provider: connection.auth_provider.clone(),
        })
        .collect();

    let recent_errors = input
        .sync_states
        .iter()
        .filter_map(|state| {
            state
                .last_error
                .as_ref()
                .map(|error| format!("{}: {}", labels.label(&state.org_id), labels.scrub(error)))
        })
        .collect();

    let sync_states = input
        .sync_states
        .iter()
        .map(|state| SyncStateReport {
            scope: labels.scrub(&state.scope),
            organization: labels.label(&state.org_id),
            last_synced_at: state.last_synced_at.clone(),
            error_count: state.error_count,
        })
        .collect();

    DiagnosticsReport {
        app_version: input.app_version,
        os: input.os,
        schema_version: SCHEMA_VERSION,
        connections,
        sync_states,
        recent_errors,
    }
}

pub fn report_to_json(report: &DiagnosticsReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sync_state(scope: &str, org: &str, error: Option<&str>) -> SyncState {
        SyncState {
            scope: scope.to_string(),
            org_id: org.to_string(),
            last_synced_at: Some("2026-08-02T00:00:00Z".to_string()),
            error_count: if error.is_some() { 1 } else { 0 },
            last_error: error.map(str::to_string),
            last_warning: None,
        }
    }

    fn input(redact: bool) -> DiagnosticsInput {
        DiagnosticsInput {
            app_version: "0.1.16".to_string(),
            os: "windows".to_string(),
            connections: vec![ConnectionFacts {
                id: "contoso".to_string(),
                provider_kind: "azdo".to_string(),
                auth_provider: "pat".to_string(),
            }],
            sync_states: vec![
                sync_state("prs:contoso", "contoso", Some("status 429 rate limited")),
                sync_state("work_items:contoso", "contoso", None),
            ],
            redact_organizations: redact,
        }
    }

    #[test]
    fn includes_version_sync_state_and_recent_errors() {
        let report = build_report(input(false));
        assert_eq!(report.app_version, "0.1.16");
        assert_eq!(report.schema_version, SCHEMA_VERSION);
        assert_eq!(report.sync_states.len(), 2);
        assert_eq!(
            report.recent_errors,
            vec!["contoso: status 429 rate limited".to_string()]
        );
    }

    #[test]
    fn keeps_organization_names_when_redaction_is_off() {
        let report = build_report(input(false));
        assert_eq!(report.connections[0].organization, "contoso");
        assert_eq!(report.sync_states[0].organization, "contoso");
    }

    #[test]
    fn replaces_organization_names_when_redaction_is_on() {
        let report = build_report(input(true));
        let json = report_to_json(&report);
        assert_eq!(report.connections[0].organization, "<org-1>");
        // Scopes and error messages embed the org id too, so redaction has to
        // reach inside those strings rather than only the dedicated fields.
        assert_eq!(report.sync_states[0].scope, "prs:<org-1>");
        assert_eq!(
            report.recent_errors,
            vec!["<org-1>: status 429 rate limited".to_string()]
        );
        assert!(
            !json.contains("contoso"),
            "redacted report leaked an org id"
        );
    }

    /// The acceptance criterion from docs/spec-reliability-foundation.md F-40:
    /// a report must never carry a credential. `ConnectionFacts` has no field
    /// to put one in, so this guards against the type gaining one later.
    #[test]
    fn report_contains_no_secrets() {
        let report = build_report(input(false));
        let json = report_to_json(&report).to_lowercase();
        for needle in [
            "pat",
            "token",
            "secret",
            "password",
            "credential",
            "authorization",
            "bearer",
        ] {
            // "pat" appears legitimately as the auth provider name; make sure
            // nothing else resembling a credential shows up.
            let allowed = matches!(needle, "pat");
            assert!(
                allowed || !json.contains(needle),
                "diagnostics report contained {needle}"
            );
        }
        assert!(!json.contains("credential_key"));
        assert!(!json.contains("credentialkey"));
    }

    #[test]
    fn labels_unknown_organizations_without_panicking() {
        let labels = OrgLabels {
            ids: vec!["known".to_string()],
            redact: true,
        };
        assert_eq!(labels.label("known"), "<org-1>");
        assert_eq!(labels.label("surprise"), "<org>");
    }
}
