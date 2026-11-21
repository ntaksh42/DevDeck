use super::*;

impl WorkItemService {
    pub async fn list_field_allowed_values(
        &self,
        input: ListWorkItemFieldAllowedValuesInput,
    ) -> Result<Vec<String>> {
        let field = validate_editable_field_reference_name(&input.field_reference_name)?;
        let work_item_type = input.work_item_type.trim();
        if work_item_type.is_empty() {
            return Err(AppError::InvalidInput(
                "work item type is required".to_string(),
            ));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        Ok(client
            .list_work_item_type_field_allowed_values(&input.project_id, work_item_type, field)
            .await?)
    }

    pub async fn list_types(&self, input: ListWorkItemTypesInput) -> Result<Vec<String>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        Ok(client.list_work_item_types(&input.project_id).await?)
    }

    pub async fn list_type_states(
        &self,
        input: ListWorkItemTypeStatesInput,
    ) -> Result<Vec<String>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        Ok(client
            .list_work_item_type_states(&input.project_id, &input.work_item_type)
            .await?)
    }

    pub async fn list_fields(
        &self,
        input: ListWorkItemFieldsInput,
    ) -> Result<Vec<WorkItemFieldOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut fields = client
            .list_work_item_fields(&input.project_id)
            .await?
            .into_iter()
            .filter(|field| is_valid_field_reference_name(&field.reference_name))
            .map(|field| WorkItemFieldOption {
                custom: field.reference_name.starts_with("Custom."),
                name: field.name,
                reference_name: field.reference_name,
                field_type: field.field_type,
            })
            .collect::<Vec<_>>();
        fields.sort_by(|left, right| {
            right
                .custom
                .cmp(&left.custom)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(fields)
    }

    pub async fn get_saved_query(&self, input: GetSavedQueryInput) -> Result<SavedQueryResult> {
        let query_id = input.query_id.trim().to_string();
        if query_id.is_empty() {
            return Err(AppError::InvalidInput("query ID is required".to_string()));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let query = client.get_saved_query(&input.project_id, &query_id).await?;
        Ok(SavedQueryResult {
            id: query.id,
            name: query.name,
            wiql: query.wiql,
        })
    }

    /// Fetches the project's query hierarchy (Shared Queries / My Queries),
    /// flattened into its importable leaf queries for the View editor's
    /// "import from Azure DevOps" picker.
    pub async fn list_project_queries(
        &self,
        input: ListProjectQueriesInput,
    ) -> Result<Vec<ProjectQueryOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut roots = client
            .list_queries(&input.project_id, PROJECT_QUERY_DEPTH)
            .await?;
        expand_truncated_query_folders(&client, &input.project_id, &mut roots).await;
        let mut queries = Vec::new();
        for root in &roots {
            flatten_query_hierarchy(root, "", &mut queries);
        }
        queries.sort_by(|a, b| {
            a.folder_path
                .cmp(&b.folder_path)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(queries)
    }

    /// Fetches the project's area and iteration trees, flattened into ordered
    /// lists whose `path` values can be assigned to `System.AreaPath` /
    /// `System.IterationPath` (via `update_fields`).
    pub async fn list_classification_nodes(
        &self,
        input: ListClassificationNodesInput,
    ) -> Result<ClassificationNodesResult> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let areas_root = client
            .get_classification_nodes(&input.project_id, "areas", CLASSIFICATION_NODE_DEPTH)
            .await?;
        let iterations_root = client
            .get_classification_nodes(&input.project_id, "iterations", CLASSIFICATION_NODE_DEPTH)
            .await?;
        let mut areas = Vec::new();
        flatten_classification_node(&areas_root, None, 0, &mut areas);
        let mut iterations = Vec::new();
        flatten_classification_node(&iterations_root, None, 0, &mut iterations);
        Ok(ClassificationNodesResult { areas, iterations })
    }
}

/// `$depth` stops at 2, so queries in deeper folders (e.g.
/// `Shared Queries/Team/Sub/Query`) are missing from `list_queries`. Fetch each
/// cut-off folder level by level until the whole tree is loaded. A folder that
/// fails to load is skipped so the rest of the picker still works.
pub(super) async fn expand_truncated_query_folders(
    client: &AdoClient,
    project_id: &str,
    roots: &mut [azdo_client::QueryHierarchyItem],
) {
    let mut attempted = HashSet::new();
    loop {
        let mut pending = Vec::new();
        for root in roots.iter() {
            collect_truncated_query_folders(root, &mut pending);
        }
        pending.retain(|id| !attempted.contains(id));
        pending.truncate(MAX_QUERY_FOLDER_EXPANSIONS - attempted.len());
        if pending.is_empty() {
            return;
        }
        attempted.extend(pending.iter().cloned());
        let mut tasks = JoinSet::new();
        for folder_id in pending {
            let client = client.clone();
            let project_id = project_id.to_string();
            tasks.spawn(async move {
                client
                    .get_query_folder(&project_id, &folder_id, PROJECT_QUERY_DEPTH)
                    .await
            });
        }
        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok(Ok(folder)) => graft_query_folder(roots, folder),
                Ok(Err(error)) => tracing::warn!(%error, "failed to expand query folder"),
                Err(error) => tracing::warn!(%error, "query folder task failed"),
            }
        }
    }
}
