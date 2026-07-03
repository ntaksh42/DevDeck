//! Pure JSON transform applied to a raw build definition document ahead of
//! a PUT back to Azure DevOps. Kept separate from `service.rs` (which owns
//! the network calls) so the variable/trigger merge logic can be unit tested
//! without a mock HTTP server.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::error::{AppError, Result};

use super::types::{PipelineCiTriggerUpdate, PipelineVariableUpdate};

/// Mutates a raw build definition JSON document (as fetched via
/// `get_build_definition_raw`) in place to apply the desired non-secret
/// variable set and, when provided, the desired CI trigger state.
pub(super) fn apply_definition_update(
    raw: &mut Value,
    variables: &[PipelineVariableUpdate],
    ci_trigger: Option<&PipelineCiTriggerUpdate>,
) -> Result<()> {
    apply_variables(raw, variables)?;
    if let Some(trigger) = ci_trigger {
        apply_ci_trigger(raw, trigger)?;
    }
    Ok(())
}

/// Replaces the non-secret variable set with `variables` (add/change/remove),
/// leaving every existing `isSecret: true` entry untouched. An input entry
/// that names an existing secret variable is rejected rather than silently
/// dropped or overwritten, since the read API never exposes a secret's value
/// for the frontend to safely round-trip.
fn apply_variables(raw: &mut Value, variables: &[PipelineVariableUpdate]) -> Result<()> {
    let existing = raw
        .get("variables")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let secret_names: HashSet<&str> = existing
        .iter()
        .filter(|(_, value)| {
            value
                .get("isSecret")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .map(|(name, _)| name.as_str())
        .collect();

    let mut next = serde_json::Map::new();
    for name in &secret_names {
        if let Some(value) = existing.get(*name) {
            next.insert((*name).to_string(), value.clone());
        }
    }
    for variable in variables {
        if secret_names.contains(variable.name.as_str()) {
            return Err(AppError::InvalidInput(format!(
                "cannot modify secret variable \"{}\"",
                variable.name
            )));
        }
        next.insert(
            variable.name.clone(),
            json!({
                "value": variable.value,
                "isSecret": false,
                "allowOverride": variable.allow_override,
            }),
        );
    }

    raw["variables"] = Value::Object(next);
    Ok(())
}

/// Enables, updates, or removes the `continuousIntegration` trigger entry.
/// Other trigger types (schedule, pull request, ...) are left untouched. When
/// enabling, an existing CI entry is updated in place (preserving fields this
/// app does not model, e.g. `batchChanges`); when none exists, a minimal
/// entry is created.
fn apply_ci_trigger(raw: &mut Value, trigger: &PipelineCiTriggerUpdate) -> Result<()> {
    let mut triggers = raw
        .get("triggers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let ci_index = triggers.iter().position(|entry| {
        entry.get("triggerType").and_then(Value::as_str) == Some("continuousIntegration")
    });

    if trigger.enabled {
        if trigger.branch_filters.is_empty() {
            return Err(AppError::InvalidInput(
                "a CI trigger requires at least one branch filter".to_string(),
            ));
        }
        match ci_index {
            Some(index) => {
                let entry = &mut triggers[index];
                entry["branchFilters"] = json!(trigger.branch_filters);
                entry["pathFilters"] = json!(trigger.path_filters);
            }
            None => {
                triggers.push(json!({
                    "triggerType": "continuousIntegration",
                    "branchFilters": trigger.branch_filters,
                    "pathFilters": trigger.path_filters,
                }));
            }
        }
    } else if let Some(index) = ci_index {
        triggers.remove(index);
    }

    raw["triggers"] = Value::Array(triggers);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variable(name: &str, value: &str, allow_override: bool) -> PipelineVariableUpdate {
        PipelineVariableUpdate {
            name: name.to_string(),
            value: Some(value.to_string()),
            allow_override,
        }
    }

    #[test]
    fn apply_variables_replaces_non_secret_set_and_preserves_secrets() {
        let mut raw = json!({
            "variables": {
                "BuildConfiguration": { "value": "Debug", "allowOverride": true },
                "Obsolete": { "value": "gone", "allowOverride": false },
                "DeployApiKey": { "isSecret": true }
            }
        });

        apply_definition_update(
            &mut raw,
            &[variable("BuildConfiguration", "Release", false)],
            None,
        )
        .unwrap();

        let vars = raw["variables"].as_object().unwrap();
        assert_eq!(vars.len(), 2);
        assert_eq!(vars["BuildConfiguration"]["value"], json!("Release"));
        assert_eq!(vars["BuildConfiguration"]["allowOverride"], json!(false));
        assert!(!vars.contains_key("Obsolete"));
        // Secret is untouched: still present, still marked secret.
        assert_eq!(vars["DeployApiKey"]["isSecret"], json!(true));
    }

    #[test]
    fn apply_variables_rejects_input_naming_a_secret() {
        let mut raw = json!({
            "variables": {
                "DeployApiKey": { "isSecret": true }
            }
        });

        let err =
            apply_definition_update(&mut raw, &[variable("DeployApiKey", "leaked", false)], None)
                .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn apply_variables_handles_missing_variables_key() {
        let mut raw = json!({});
        apply_definition_update(&mut raw, &[variable("New", "value", true)], None).unwrap();
        assert_eq!(raw["variables"]["New"]["value"], json!("value"));
    }

    #[test]
    fn apply_ci_trigger_creates_entry_when_missing() {
        let mut raw = json!({ "triggers": [] });
        apply_definition_update(
            &mut raw,
            &[],
            Some(&PipelineCiTriggerUpdate {
                enabled: true,
                branch_filters: vec!["+refs/heads/main".to_string()],
                path_filters: vec![],
            }),
        )
        .unwrap();

        let triggers = raw["triggers"].as_array().unwrap();
        assert_eq!(triggers.len(), 1);
        assert_eq!(triggers[0]["triggerType"], json!("continuousIntegration"));
        assert_eq!(triggers[0]["branchFilters"], json!(["+refs/heads/main"]));
    }

    #[test]
    fn apply_ci_trigger_updates_existing_entry_preserving_other_fields() {
        let mut raw = json!({
            "triggers": [{
                "triggerType": "continuousIntegration",
                "branchFilters": ["+refs/heads/old"],
                "pathFilters": [],
                "batchChanges": true
            }]
        });
        apply_definition_update(
            &mut raw,
            &[],
            Some(&PipelineCiTriggerUpdate {
                enabled: true,
                branch_filters: vec!["+refs/heads/main".to_string()],
                path_filters: vec!["-/docs".to_string()],
            }),
        )
        .unwrap();

        let triggers = raw["triggers"].as_array().unwrap();
        assert_eq!(triggers.len(), 1);
        assert_eq!(triggers[0]["branchFilters"], json!(["+refs/heads/main"]));
        assert_eq!(triggers[0]["pathFilters"], json!(["-/docs"]));
        // Fields this app does not model survive the update.
        assert_eq!(triggers[0]["batchChanges"], json!(true));
    }

    #[test]
    fn apply_ci_trigger_removes_entry_when_disabled() {
        let mut raw = json!({
            "triggers": [
                { "triggerType": "continuousIntegration", "branchFilters": ["+refs/heads/main"] },
                { "triggerType": "schedule", "branchFilters": ["+refs/heads/main"] }
            ]
        });
        apply_definition_update(
            &mut raw,
            &[],
            Some(&PipelineCiTriggerUpdate {
                enabled: false,
                branch_filters: vec![],
                path_filters: vec![],
            }),
        )
        .unwrap();

        let triggers = raw["triggers"].as_array().unwrap();
        assert_eq!(triggers.len(), 1);
        assert_eq!(triggers[0]["triggerType"], json!("schedule"));
    }

    #[test]
    fn apply_ci_trigger_rejects_empty_branch_filters_when_enabling() {
        let mut raw = json!({ "triggers": [] });
        let err = apply_definition_update(
            &mut raw,
            &[],
            Some(&PipelineCiTriggerUpdate {
                enabled: true,
                branch_filters: vec![],
                path_filters: vec![],
            }),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn apply_definition_update_leaves_triggers_unchanged_when_ci_trigger_is_none() {
        let mut raw = json!({
            "triggers": [
                { "triggerType": "continuousIntegration", "branchFilters": ["+refs/heads/main"] }
            ]
        });
        apply_definition_update(&mut raw, &[], None).unwrap();
        assert_eq!(
            raw["triggers"][0]["branchFilters"],
            json!(["+refs/heads/main"])
        );
    }
}
