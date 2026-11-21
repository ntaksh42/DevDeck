use serde_json::{json, Value};

use crate::client::AdoClient;
use crate::error::{AdoError, Result};

use super::types::*;

/// Azure DevOps rejects a workitemsbatch request carrying more than 200 ids.
const WORK_ITEMS_BATCH_LIMIT: usize = 200;

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
            .post_json_read(
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
            .post_json_read(
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
        self.fetch_work_items_batch(project_id, ids, Some(fields), None)
            .await
    }

    /// Same as [`get_work_items_batch`](Self::get_work_items_batch), but also
    /// populates each item's relations (e.g. to find linked pull requests)
    /// without an extra per-item request.
    ///
    /// Azure DevOps rejects a workitemsbatch request that sets both `fields`
    /// and `$expand` at once, so this issues two batch requests — one for the
    /// requested fields, one with `$expand=Relations` and no `fields` — and
    /// merges the relations into the field-carrying items by id.
    pub async fn get_work_items_batch_with_relations(
        &self,
        project_id: &str,
        ids: Vec<i64>,
        fields: Vec<String>,
    ) -> Result<Vec<WorkItem>> {
        let mut items = self
            .fetch_work_items_batch(project_id, ids.clone(), Some(fields), None)
            .await?;
        let mut relations_by_id: std::collections::HashMap<i64, Vec<WorkItemRelation>> = self
            .fetch_work_items_batch(project_id, ids, None, Some(WorkItemExpand::Relations))
            .await?
            .into_iter()
            .map(|item| (item.id, item.relations))
            .collect();
        for item in &mut items {
            if let Some(relations) = relations_by_id.remove(&item.id) {
                item.relations = relations;
            }
        }
        Ok(items)
    }

    async fn fetch_work_items_batch(
        &self,
        project_id: &str,
        ids: Vec<i64>,
        fields: Option<Vec<String>>,
        expand: Option<WorkItemExpand>,
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
                .post_json_read(
                    &path,
                    &[("api-version", "7.1-preview")],
                    &WorkItemsBatchRequest {
                        ids: chunk.to_vec(),
                        fields: fields.clone(),
                        expand,
                        error_policy: None,
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
        self.patch_json_once(
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
        self.patch_json_once(
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

    /// The latest `keep` updates, oldest first. The API lists updates oldest
    /// first, so `$top` alone would return the oldest ones; page with `$skip`
    /// and keep the tail.
    pub async fn list_work_item_updates(
        &self,
        project_id: &str,
        work_item_id: i64,
        keep: u32,
    ) -> Result<Vec<WorkItemUpdate>> {
        const PAGE: usize = 200;
        let path = format!("{project_id}/_apis/wit/workItems/{work_item_id}/updates");
        let top = PAGE.to_string();
        let mut all = Vec::new();
        for _ in 0..50 {
            let skip = all.len().to_string();
            let query = [
                ("api-version", "7.1-preview"),
                ("$top", &top),
                ("$skip", &skip),
            ];
            let page: WorkItemUpdatesList = self.get_json(&path, &query).await?;
            let len = page.value.len();
            all.extend(page.value);
            if len < PAGE {
                break;
            }
        }
        Ok(all.split_off(all.len().saturating_sub(keep as usize)))
    }

    /// Creates a work item of `work_item_type` in a project. `fields` are
    /// `(reference_name, value)` pairs applied as a single JSON Patch document,
    /// so type rules validate the full field set at once. Azure DevOps requires
    /// the `application/json-patch+json` content type on this POST.
    pub async fn create_work_item(
        &self,
        project_id: &str,
        work_item_type: &str,
        fields: &[(String, Value)],
    ) -> Result<WorkItem> {
        let encoded_type = encode_path_segment(work_item_type);
        let path = format!("{project_id}/_apis/wit/workitems/${encoded_type}");
        let operations: Vec<WorkItemPatchOperation> = fields
            .iter()
            .map(|(reference_name, value)| WorkItemPatchOperation {
                op: "add",
                path: format!("/fields/{reference_name}"),
                value: value.clone(),
            })
            .collect();
        self.post_json_with_content_type(
            &path,
            &[("api-version", "7.1-preview")],
            "application/json-patch+json",
            &operations,
        )
        .await
    }

    /// Lists the work item type names defined for a project (e.g. Bug, Task).
    pub async fn list_work_item_types(&self, project_id: &str) -> Result<Vec<String>> {
        let path = format!("{project_id}/_apis/wit/workitemtypes");
        let response: crate::git::ListResponse<WorkItemTypeDefinition> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value.into_iter().map(|t| t.name).collect())
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
