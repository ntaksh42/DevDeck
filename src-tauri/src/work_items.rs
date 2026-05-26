use azdo_client::WorkItem;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const WORK_ITEM_FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "System.ChangedDate",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWorkItemsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub state: Option<String>,
    pub work_item_type: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyWorkItemsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub id: i64,
    pub title: String,
    pub work_item_type: Option<String>,
    pub state: Option<String>,
    pub assigned_to: Option<String>,
    pub changed_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkItemService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl WorkItemService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn search(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default();
        let state = normalize_optional_filter(input.state);
        let work_item_type = normalize_optional_filter(input.work_item_type);
        let project_filter = normalize_optional_filter(input.project_id);
        let client = client_for_organization(&organization, &self.secrets)?;

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            if !matches_optional_filter(&project.id, project_filter.as_deref()) {
                continue;
            }
            let wiql = build_wiql(&query, state.as_deref(), work_item_type.as_deref());
            let ids = client.query_work_item_ids(&project.id, &wiql).await?;
            let ids: Vec<i64> = ids.into_iter().take(100).collect();
            let fields = WORK_ITEM_FIELDS
                .iter()
                .map(|field| field.to_string())
                .collect();
            let work_items = client
                .get_work_items_batch(&project.id, ids, fields)
                .await?;
            for work_item in work_items {
                results.push(summarize_work_item(
                    &organization,
                    &project.id,
                    &project.name,
                    work_item,
                ));
            }
        }

        results.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
        results.truncate(100);
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            "work item search completed"
        );
        Ok(results)
    }

    pub async fn list_my(&self, input: ListMyWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC";

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            let ids = client.query_work_item_ids(&project.id, wiql).await?;
            let ids: Vec<i64> = ids.into_iter().take(100).collect();
            let fields = WORK_ITEM_FIELDS
                .iter()
                .map(|field| field.to_string())
                .collect();
            let work_items = client
                .get_work_items_batch(&project.id, ids, fields)
                .await?;
            for work_item in work_items {
                results.push(summarize_work_item(
                    &organization,
                    &project.id,
                    &project.name,
                    work_item,
                ));
            }
        }

        results.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
        results.truncate(100);
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            "my work items listed"
        );
        Ok(results)
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .db
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }

        self.db
            .list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }
}

fn normalize_optional_filter(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

fn matches_optional_filter(value: &str, filter: Option<&str>) -> bool {
    filter.is_none_or(|filter| filter == value)
}

fn build_wiql(query: &str, state: Option<&str>, work_item_type: Option<&str>) -> String {
    let mut clauses = Vec::from(["[System.TeamProject] = @project".to_string()]);
    let query = query.trim();
    if !query.is_empty() {
        clauses.push(format!(
            "[System.Title] CONTAINS '{}'",
            escape_wiql_string(query)
        ));
    }
    if let Some(state) = state {
        clauses.push(format!(
            "[System.State] = '{}'",
            escape_wiql_string(state.trim())
        ));
    }
    if let Some(work_item_type) = work_item_type {
        clauses.push(format!(
            "[System.WorkItemType] = '{}'",
            escape_wiql_string(work_item_type.trim())
        ));
    }

    format!(
        "SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY [System.ChangedDate] DESC",
        clauses.join(" AND ")
    )
}

fn escape_wiql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn summarize_work_item(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
) -> WorkItemSummary {
    WorkItemSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: work_item.id,
        title: string_field(&work_item, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(&work_item, "System.WorkItemType"),
        state: string_field(&work_item, "System.State"),
        assigned_to: identity_field(&work_item, "System.AssignedTo"),
        changed_date: string_field(&work_item, "System.ChangedDate"),
        web_url: work_item
            .links
            .and_then(|links| links.html.map(|html| html.href))
            .or_else(|| {
                Some(format!(
                    "https://dev.azure.com/{}/{}/_workitems/edit/{}",
                    organization.name,
                    encode_path_segment(project_name),
                    work_item.id
                ))
            }),
    }
}

fn string_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        _ => None,
    }
}

fn identity_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        Value::Object(map) => map
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| map.get("uniqueName").and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

fn encode_path_segment(value: &str) -> String {
    value.replace(' ', "%20")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    #[test]
    fn matches_optional_filter_allows_none_and_matching_value() {
        assert!(matches_optional_filter("platform", None));
        assert!(matches_optional_filter("platform", Some("platform")));
        assert!(!matches_optional_filter("platform", Some("mobile")));
    }

    #[test]
    fn build_wiql_escapes_filters() {
        let wiql = build_wiql("can't save", Some("Active"), Some("Bug"));

        assert!(wiql.contains("[System.Title] CONTAINS 'can''t save'"));
        assert!(wiql.contains("[System.State] = 'Active'"));
        assert!(wiql.contains("[System.WorkItemType] = 'Bug'"));
    }

    #[test]
    fn summarize_maps_identity_object() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        let mut fields = HashMap::new();
        fields.insert("System.Title".to_string(), json!("Fix save"));
        fields.insert("System.WorkItemType".to_string(), json!("Bug"));
        fields.insert("System.State".to_string(), json!("Active"));
        fields.insert(
            "System.AssignedTo".to_string(),
            json!({ "displayName": "Test User" }),
        );

        let summary = summarize_work_item(
            &organization,
            "project-1",
            "Platform Team",
            WorkItem {
                id: 123,
                fields,
                links: None,
            },
        );

        assert_eq!(summary.title, "Fix save");
        assert_eq!(summary.assigned_to.as_deref(), Some("Test User"));
        assert_eq!(
            summary.web_url.as_deref(),
            Some("https://dev.azure.com/contoso/Platform%20Team/_workitems/edit/123")
        );
    }
}
