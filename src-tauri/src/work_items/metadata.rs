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

    /// Fetches arbitrary field values for work items already on screen.
    ///
    /// Search and My Work Items render from the SQLite cache, which only holds
    /// the standard columns. Rather than widening the sync scope, extra columns
    /// are filled in on demand for the rows the user is actually looking at.
    pub async fn fetch_extra_fields(
        &self,
        input: FetchWorkItemExtraFieldsInput,
    ) -> Result<Vec<WorkItemExtraFields>> {
        let extra_fields = sanitize_extra_query_fields(Some(&input.extra_fields));
        if extra_fields.is_empty() || input.items.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        // The batch endpoint is per project, so group the ids before calling it.
        let mut ids_by_project: HashMap<String, Vec<i64>> = HashMap::new();
        for target in &input.items {
            let ids = ids_by_project.entry(target.project_id.clone()).or_default();
            if !ids.contains(&target.id) {
                ids.push(target.id);
            }
        }

        // `System.Id` keeps the response rows identifiable when every requested
        // field happens to be empty on an item.
        let mut fields = vec!["System.Id".to_string()];
        fields.extend(extra_fields.iter().cloned());

        let mut results = Vec::new();
        for (project_id, ids) in ids_by_project {
            let work_items = client
                .get_work_items_batch(&project_id, ids, fields.clone())
                .await?;
            results.extend(work_items.into_iter().map(|work_item| WorkItemExtraFields {
                id: work_item.id,
                extra_fields: extra_work_item_fields(&work_item, &extra_fields),
            }));
        }
        Ok(results)
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
