//! Work item metadata requests (field values, states, saved queries,
//! classification nodes), split from `requests.rs` to keep files under 500 lines.

use serde::Deserialize;
use serde_json::Value;

use crate::client::AdoClient;
use crate::error::Result;

use super::requests::encode_path_segment;
use super::types::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkItemTypeFieldValues {
    #[serde(default)]
    allowed_values: Vec<Value>,
}

impl AdoClient {
    /// Returns the picklist values defined for a field on a work item type;
    /// empty when the field has no constrained value list.
    pub async fn list_work_item_type_field_allowed_values(
        &self,
        project_id: &str,
        work_item_type: &str,
        field_reference_name: &str,
    ) -> Result<Vec<String>> {
        let encoded_type = encode_path_segment(work_item_type);
        let encoded_field = encode_path_segment(field_reference_name);
        let path =
            format!("{project_id}/_apis/wit/workitemtypes/{encoded_type}/fields/{encoded_field}");
        let response: WorkItemTypeFieldValues = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$expand", "allowedValues")],
            )
            .await?;
        Ok(response
            .allowed_values
            .into_iter()
            .filter_map(|value| match value {
                Value::String(value) => Some(value),
                value if value.is_number() || value.is_boolean() => Some(value.to_string()),
                _ => None,
            })
            .collect())
    }

    pub async fn list_work_item_type_states(
        &self,
        project_id: &str,
        work_item_type: &str,
    ) -> Result<Vec<String>> {
        let encoded_type = encode_path_segment(work_item_type);
        let path = format!("{project_id}/_apis/wit/workitemtypes/{encoded_type}/states");
        let response: WorkItemTypeStatesList = self
            .get_json(&path, &[("api-version", "7.1-preview.1")])
            .await?;
        Ok(response.value.into_iter().map(|s| s.name).collect())
    }

    pub async fn list_work_item_fields(
        &self,
        project_id: &str,
    ) -> Result<Vec<WorkItemFieldDefinition>> {
        let path = if project_id.trim().is_empty() {
            "_apis/wit/fields".to_string()
        } else {
            format!("{project_id}/_apis/wit/fields")
        };
        let response: crate::git::ListResponse<WorkItemFieldDefinition> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    pub async fn get_saved_query(&self, project_id: &str, query_id: &str) -> Result<SavedQuery> {
        let path = format!("{project_id}/_apis/wit/queries/{query_id}");
        self.get_json(&path, &[("api-version", "7.1"), ("$expand", "all")])
            .await
    }

    /// Fetches a project's query hierarchy (the root "Shared Queries" / "My
    /// Queries" folders and their contents), with WIQL included on leaf
    /// queries. Azure DevOps caps `$depth` at 2.
    pub async fn list_queries(
        &self,
        project_id: &str,
        depth: u32,
    ) -> Result<Vec<QueryHierarchyItem>> {
        let path = format!("{project_id}/_apis/wit/queries");
        let depth_string = depth.to_string();
        let response: crate::git::ListResponse<QueryHierarchyItem> = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1"),
                    ("$depth", depth_string.as_str()),
                    ("$expand", "wiql"),
                ],
            )
            .await?;
        Ok(response.value)
    }

    /// Fetches one query folder with up to `depth` levels of its contents, for
    /// expanding folders that `list_queries` returned without their children.
    pub async fn get_query_folder(
        &self,
        project_id: &str,
        folder_id: &str,
        depth: u32,
    ) -> Result<QueryHierarchyItem> {
        let path = format!("{project_id}/_apis/wit/queries/{folder_id}");
        let depth_string = depth.to_string();
        self.get_json(
            &path,
            &[
                ("api-version", "7.1"),
                ("$depth", depth_string.as_str()),
                ("$expand", "wiql"),
            ],
        )
        .await
    }

    /// Fetches an area or iteration classification tree for a project.
    /// `structure_group` is `"areas"` or `"iterations"`; `depth` expands nested
    /// child nodes in a single request.
    pub async fn get_classification_nodes(
        &self,
        project_id: &str,
        structure_group: &str,
        depth: u32,
    ) -> Result<ClassificationNode> {
        let path = format!("{project_id}/_apis/wit/classificationnodes/{structure_group}");
        let depth = depth.to_string();
        self.get_json(
            &path,
            &[("api-version", "7.1-preview.2"), ("$depth", depth.as_str())],
        )
        .await
    }
}
