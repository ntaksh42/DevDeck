use serde::Deserialize;
use serde_json::{json, Value};

use crate::client::AdoClient;
use crate::error::{AdoError, Result};

use super::types::*;

/// Azure DevOps rejects a workitemsbatch request carrying more than 200 ids.
const WORK_ITEMS_BATCH_LIMIT: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkItemTypeFieldValues {
    #[serde(default)]
    allowed_values: Vec<Value>,
}

impl AdoClient {
    pub async fn query_work_item_ids(
        &self,
        project_id: &str,
        wiql: &str,
        top: Option<usize>,
    ) -> Result<Vec<i64>> {
        let path = format!("{project_id}/_apis/wit/wiql");
        let top_string;
        let mut params: Vec<(&str, &str)> = vec![("api-version", "7.1-preview")];
        if let Some(top) = top {
            top_string = top.to_string();
            params.push(("$top", &top_string));
        }
        let response: WiqlResponse = self
            .post_json(
                &path,
                &params,
                &WiqlRequest {
                    query: wiql.to_string(),
                },
            )
            .await?;
        // A `FROM WorkItemLinks` query parses into an empty `work_items` with a
        // populated `work_item_relations`. Returning an empty id list there
        // hides the misuse, so surface it instead of silently yielding nothing.
        if response.work_items.is_empty() && !response.work_item_relations.is_empty() {
            return Err(AdoError::WiqlQueryShape(
                "query returned WorkItemLinks relations; use query_work_item_links for FROM WorkItemLinks queries".to_string(),
            ));
        }
        Ok(response
            .work_items
            .into_iter()
            .map(|item| item.id)
            .collect())
    }

    /// Runs a `FROM WorkItemLinks` WIQL query and returns the link edges in
    /// the order Azure DevOps reports them (tree order for recursive queries).
    pub async fn query_work_item_links(
        &self,
        project_id: &str,
        wiql: &str,
        top: Option<usize>,
    ) -> Result<Vec<WorkItemLink>> {
        let path = format!("{project_id}/_apis/wit/wiql");
        let top_string;
        let mut params: Vec<(&str, &str)> = vec![("api-version", "7.1-preview")];
        if let Some(top) = top {
            top_string = top.to_string();
            params.push(("$top", &top_string));
        }
        let response: WiqlResponse = self
            .post_json(
                &path,
                &params,
                &WiqlRequest {
                    query: wiql.to_string(),
                },
            )
            .await?;
        // A flat `FROM WorkItems` query parses into an empty
        // `work_item_relations` with a populated `work_items`. Surface that
        // misuse rather than silently returning no links.
        if response.work_item_relations.is_empty() && !response.work_items.is_empty() {
            return Err(AdoError::WiqlQueryShape(
                "query returned flat WorkItems; use query_work_item_ids for FROM WorkItems queries"
                    .to_string(),
            ));
        }
        Ok(response
            .work_item_relations
            .into_iter()
            .filter_map(|relation| {
                relation.target.map(|target| WorkItemLink {
                    source_id: relation.source.map(|source| source.id),
                    target_id: target.id,
                })
            })
            .collect())
    }

    pub async fn get_work_items_batch(
        &self,
        project_id: &str,
        ids: Vec<i64>,
        fields: Vec<String>,
    ) -> Result<Vec<WorkItem>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // The workitemsbatch API rejects requests with more than 200 ids, so
        // split larger id lists into chunks and concatenate the responses.
        let path = format!("{project_id}/_apis/wit/workitemsbatch");
        let mut items = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(WORK_ITEMS_BATCH_LIMIT) {
            let response: crate::git::ListResponse<WorkItem> = self
                .post_json(
                    &path,
                    &[("api-version", "7.1-preview")],
                    &WorkItemsBatchRequest {
                        ids: chunk.to_vec(),
                        fields: fields.clone(),
                    },
                )
                .await?;
            items.extend(response.value);
        }
        Ok(items)
    }

    pub async fn get_work_item_relations(
        &self,
        project_id: &str,
        work_item_id: i64,
    ) -> Result<Vec<WorkItemRelation>> {
        let path = format!("{project_id}/_apis/wit/workitems/{work_item_id}");
        let response: WorkItemWithRelations = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$expand", "relations")],
            )
            .await?;
        Ok(response.relations)
    }

    /// Adds a relation (link) to a work item via JSON Patch. `rel` is an Azure
    /// DevOps link type reference (e.g. System.LinkTypes.Related) and `url` is
    /// the related work item's REST URL.
    pub async fn add_work_item_relation(
        &self,
        project_id: &str,
        work_item_id: i64,
        rel: &str,
        url: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let body = json!([{
            "op": "add",
            "path": "/relations/-",
            "value": { "rel": rel, "url": url }
        }]);
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &body,
        )
        .await
    }

    /// Removes the relation at `index` (its position in the work item's
    /// `relations` array) via JSON Patch.
    pub async fn remove_work_item_relation(
        &self,
        project_id: &str,
        work_item_id: i64,
        index: usize,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let body = json!([{ "op": "remove", "path": format!("/relations/{index}") }]);
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &body,
        )
        .await
    }

    pub async fn add_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        self.post_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
        .await
    }

    pub async fn delete_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
    ) -> Result<()> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.delete(&path, &[("api-version", "7.1-preview.4")])
            .await
    }

    pub async fn update_work_item_comment(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
        markdown: &str,
    ) -> Result<WorkItemComment> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview.4"), ("format", "markdown")],
            "application/json",
            &WorkItemCommentCreate {
                text: markdown.to_string(),
            },
        )
        .await
    }

    pub async fn list_work_item_comments(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemComment>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/comments");
        let top_str = top.to_string();
        // `$expand=all` returns both reactions and `renderedText`. Without
        // `renderedText`, Azure DevOps does not resolve `@<guid>` mention tokens
        // into display names, so the preview falls back to raw ids (and the
        // sanitizer can even drop the token entirely). `all` lets the service
        // resolve mentions the same way the web UI does.
        let response: WorkItemCommentsList = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview.4"),
                    ("$top", &top_str),
                    ("order", "desc"),
                    ("$expand", "all"),
                ],
            )
            .await?;
        Ok(response.comments)
    }

    /// Adds (`engaged = true`) or removes (`engaged = false`) the current user's
    /// reaction of `reaction_type` on a work item comment. `reaction_type` is one
    /// of `like`, `dislike`, `heart`, `hooray`, `smile`, `confused`.
    pub async fn set_work_item_comment_reaction(
        &self,
        project_id: &str,
        work_item_id: i64,
        comment_id: i64,
        reaction_type: &str,
        engaged: bool,
    ) -> Result<()> {
        let path = format!(
            "{project_id}/_apis/wit/workItems/{work_item_id}/comments/{comment_id}/reactions/{reaction_type}"
        );
        let query = [("api-version", "7.1-preview.1")];
        if engaged {
            let _: CommentReaction = self.put_json(&path, &query, &serde_json::json!({})).await?;
        } else {
            self.delete(&path, &query).await?;
        }
        Ok(())
    }

    pub async fn list_work_item_updates(
        &self,
        project_id: &str,
        work_item_id: i64,
        top: u32,
    ) -> Result<Vec<WorkItemUpdate>> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/updates");
        let top_str = top.to_string();
        let response: WorkItemUpdatesList = self
            .get_json(&path, &[("api-version", "7.1-preview"), ("$top", &top_str)])
            .await?;
        Ok(response.value)
    }

    pub async fn update_work_item_assigned_to(
        &self,
        project_id: &str,
        work_item_id: i64,
        assigned_to: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/System.AssignedTo".to_string(),
                value: json!(assigned_to),
            }],
        )
        .await
    }

    pub async fn update_work_item_state(
        &self,
        project_id: &str,
        work_item_id: i64,
        state: &str,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/System.State".to_string(),
                value: json!(state),
            }],
        )
        .await
    }

    pub async fn update_work_item_priority(
        &self,
        project_id: &str,
        work_item_id: i64,
        priority: i64,
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &[WorkItemPatchOperation {
                op: "add",
                path: "/fields/Microsoft.VSTS.Common.Priority".to_string(),
                value: json!(priority),
            }],
        )
        .await
    }

    /// Applies several field changes in a single JSON Patch request, so the
    /// whole update succeeds or fails atomically (state transition rules see
    /// all fields at once).
    pub async fn update_work_item_fields(
        &self,
        project_id: &str,
        work_item_id: i64,
        fields: &[(String, serde_json::Value)],
    ) -> Result<WorkItem> {
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}");
        let operations: Vec<WorkItemPatchOperation> = fields
            .iter()
            .map(|(reference_name, value)| WorkItemPatchOperation {
                op: "add",
                path: format!("/fields/{reference_name}"),
                value: value.clone(),
            })
            .collect();
        self.patch_json(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &operations,
        )
        .await
    }

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
        let path = format!("{project_id}/_apis/wit/fields");
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

pub(crate) fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}
