//! Work item creation. Builds the JSON Patch field set from the command input,
//! creates the item via the REST client, and reflects it into the local cache
//! so My Work Items shows it without waiting for the next background sync.

use serde_json::Value;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::super::{summarize_work_item, work_item_to_cached, WorkItemService};
use super::normalize_tags;
use crate::work_items::{CreateWorkItemInput, WorkItemSummary};

impl WorkItemService {
    pub async fn create_item(&self, input: CreateWorkItemInput) -> Result<WorkItemSummary> {
        let work_item_type = input.work_item_type.trim().to_string();
        if work_item_type.is_empty() {
            return Err(AppError::InvalidInput(
                "work item type is required".to_string(),
            ));
        }
        let fields = build_create_fields(&input)?;
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;

        let created = client
            .create_work_item(&project.id, &work_item_type, &fields)
            .await?;

        let cached = work_item_to_cached(&organization, &project.id, &project.name, &created);
        if let Err(e) = self.db.apply_work_item_updates(
            &[cached],
            organization.authenticated_user_unique_name.as_deref(),
        ) {
            tracing::warn!(error = %e, "failed to update work item cache after create");
        }

        Ok(summarize_work_item(
            &organization,
            &project.id,
            &project.name,
            created,
        ))
    }
}

/// Builds the `(reference_name, value)` pairs for the create patch document.
/// Only fields the user actually filled are sent, so project defaults (state,
/// area, iteration) still apply for omitted ones.
fn build_create_fields(input: &CreateWorkItemInput) -> Result<Vec<(String, Value)>> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("title is required".to_string()));
    }
    let mut fields = vec![("System.Title".to_string(), Value::from(title))];
    if let Some(description) = trimmed(&input.description) {
        fields.push((
            "System.Description".to_string(),
            Value::from(description_html(description)),
        ));
    }
    if let Some(assigned_to) = trimmed(&input.assigned_to) {
        fields.push(("System.AssignedTo".to_string(), Value::from(assigned_to)));
    }
    if let Some(area_path) = trimmed(&input.area_path) {
        fields.push(("System.AreaPath".to_string(), Value::from(area_path)));
    }
    if let Some(iteration_path) = trimmed(&input.iteration_path) {
        fields.push((
            "System.IterationPath".to_string(),
            Value::from(iteration_path),
        ));
    }
    if let Some(priority) = input.priority {
        if priority <= 0 {
            return Err(AppError::InvalidInput(
                "priority must be positive".to_string(),
            ));
        }
        fields.push((
            "Microsoft.VSTS.Common.Priority".to_string(),
            Value::from(priority),
        ));
    }
    let tags = normalize_tags(&input.tags);
    if !tags.is_empty() {
        fields.push(("System.Tags".to_string(), Value::from(tags.join("; "))));
    }
    Ok(fields)
}

fn trimmed(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// `System.Description` stores HTML, so escape user text and keep line breaks.
fn description_html(text: &str) -> String {
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    escaped.replace("\r\n", "\n").replace('\n', "<br>")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(title: &str) -> CreateWorkItemInput {
        CreateWorkItemInput {
            organization_id: None,
            project_id: "project-1".to_string(),
            work_item_type: "Bug".to_string(),
            title: title.to_string(),
            description: None,
            assigned_to: None,
            area_path: None,
            iteration_path: None,
            priority: None,
            tags: Vec::new(),
        }
    }

    #[test]
    fn build_create_fields_rejects_blank_title() {
        assert!(build_create_fields(&input("   ")).is_err());
    }

    #[test]
    fn build_create_fields_sends_only_filled_fields() {
        let fields = build_create_fields(&input("Fix crash")).unwrap();
        assert_eq!(
            fields,
            vec![("System.Title".to_string(), Value::from("Fix crash"))]
        );
    }

    #[test]
    fn build_create_fields_includes_optional_fields() {
        let mut full = input("  Fix crash  ");
        full.description = Some("line1\nline2 <b>".to_string());
        full.assigned_to = Some(" alice@contoso.example ".to_string());
        full.area_path = Some("Contoso\\Web".to_string());
        full.iteration_path = Some("Contoso\\Sprint 1".to_string());
        full.priority = Some(2);
        full.tags = vec![" ui ".to_string(), "UI".to_string(), "backlog".to_string()];

        let fields = build_create_fields(&full).unwrap();
        let get = |name: &str| {
            fields
                .iter()
                .find(|(reference_name, _)| reference_name == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(get("System.Title"), Some(Value::from("Fix crash")));
        assert_eq!(
            get("System.Description"),
            Some(Value::from("line1<br>line2 &lt;b&gt;"))
        );
        assert_eq!(
            get("System.AssignedTo"),
            Some(Value::from("alice@contoso.example"))
        );
        assert_eq!(get("System.AreaPath"), Some(Value::from("Contoso\\Web")));
        assert_eq!(
            get("System.IterationPath"),
            Some(Value::from("Contoso\\Sprint 1"))
        );
        assert_eq!(get("Microsoft.VSTS.Common.Priority"), Some(Value::from(2)));
        // Tags are de-duplicated case-insensitively and ';'-joined.
        assert_eq!(get("System.Tags"), Some(Value::from("ui; backlog")));
    }

    #[test]
    fn build_create_fields_rejects_non_positive_priority() {
        let mut bad = input("Fix crash");
        bad.priority = Some(0);
        assert!(build_create_fields(&bad).is_err());
    }
}
