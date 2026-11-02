use super::*;

impl WorkItemService {
    pub async fn list_projects(
        &self,
        input: ListWorkItemProjectsInput,
    ) -> Result<Vec<WorkItemProjectOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut projects = self
            .projects
            .list(&client, &organization.id)
            .await?
            .into_iter()
            .map(|project| WorkItemProjectOption {
                project_id: project.id,
                project_name: project.name,
            })
            .collect::<Vec<_>>();
        projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));
        Ok(projects)
    }

    pub fn search(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let states = normalize_filter_set(input.states);
        let work_item_types = normalize_filter_set(input.work_item_types);
        let project_ids = normalize_filter_set(input.project_ids);

        let cached = if query.is_empty() {
            self.db.search_work_items(
                &organization.id,
                project_ids.as_deref(),
                states.as_deref(),
                work_item_types.as_deref(),
                None,
            )?
        } else {
            let mut results = self.db.search_work_items_fts(&organization.id, &query)?;
            results.retain(|item| {
                filter_matches(&project_ids, Some(item.project_id.as_str()))
                    && filter_matches(&states, item.state.as_deref())
                    && filter_matches(&work_item_types, item.work_item_type.as_deref())
            });
            results
        };

        Ok(cached.into_iter().map(cached_wi_to_summary).collect())
    }

    pub(crate) async fn search_palette(
        &self,
        org_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(Some(org_id))?;
        let client = client_for_organization(&organization, &self.secrets)?;
        self.search_palette_with_client(&client, &organization, query, limit)
            .await
    }

    pub(crate) async fn search_palette_with_client(
        &self,
        client: &AdoClient,
        organization: &Organization,
        query: &str,
        limit: usize,
    ) -> Result<Vec<WorkItemSummary>> {
        let work_items = if let Ok(id) = query.parse::<i32>() {
            client
                .get_work_item_org(i64::from(id), WORK_ITEM_FIELDS)
                .await?
                .into_iter()
                .collect()
        } else {
            // WIQL string literals escape apostrophes by doubling them.
            let title = query.replace('\'', "''");
            let wiql = format!("SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '{title}' ORDER BY [System.ChangedDate] DESC");
            let ids = client
                .query_work_item_ids_org(&wiql, Some(limit + 1))
                .await?;
            client
                .get_work_items_batch_org(
                    ids,
                    WORK_ITEM_FIELDS.iter().map(|s| s.to_string()).collect(),
                )
                .await?
        };
        if work_items.is_empty() {
            return Ok(Vec::new());
        }
        let projects = self
            .projects
            .list(client, &organization.id)
            .await
            .unwrap_or_default();
        Ok(work_items
            .into_iter()
            .filter_map(|wi| {
                let project_name = string_field(&wi, "System.TeamProject")?;
                let project_id = projects
                    .iter()
                    .find(|p| p.name.eq_ignore_ascii_case(&project_name))
                    .map(|p| p.id.as_str())
                    .unwrap_or(&project_name);
                Some(cached_wi_to_summary(work_item_to_cached(
                    organization,
                    project_id,
                    &project_name,
                    &wi,
                )))
            })
            .collect())
    }
}
