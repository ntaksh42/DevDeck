use std::collections::HashMap;

use azdo_client::WorkItem;

use crate::auth::client_for_organization;
use crate::error::Result;
use crate::work_items::{summarize_work_item, WorkItemSummary, WORK_ITEM_FIELDS};

use super::helpers::commit_artifact_uri;
use super::{CommitService, GetCommitWorkItemsInput};

impl CommitService {
    /// Returns the work items linked to a commit via Azure DevOps's artifact
    /// link mechanism — the same one used to find work items linked to a pull
    /// request — fetched live (not cached) since it is only used by the
    /// preview panel, not the grid.
    pub async fn get_commit_work_items(
        &self,
        input: GetCommitWorkItemsInput,
    ) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let artifact_uri =
            commit_artifact_uri(&input.project_id, &input.repository_id, &input.commit_id);
        let mut ids_by_uri = client
            .query_work_item_ids_for_artifact_uris(
                &input.project_id,
                std::slice::from_ref(&artifact_uri),
            )
            .await?;
        let ids = ids_by_uri.remove(&artifact_uri).unwrap_or_default();
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let fields: Vec<String> = WORK_ITEM_FIELDS
            .iter()
            .map(|field| field.to_string())
            .collect();
        let work_items = client
            .get_work_items_batch(&input.project_id, ids.clone(), fields)
            .await?;
        let mut items_by_id: HashMap<i64, WorkItem> =
            work_items.into_iter().map(|item| (item.id, item)).collect();

        Ok(ids
            .into_iter()
            .filter_map(|id| items_by_id.remove(&id))
            .map(|work_item| {
                summarize_work_item(
                    &organization,
                    &input.project_id,
                    &input.project_name,
                    work_item,
                )
            })
            .collect())
    }
}
