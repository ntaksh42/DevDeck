//! Local "follow" watchlist for work items (issue #304). Azure DevOps has no
//! public REST API to set the server-side follow/subscription, so following an
//! item just records it in the local SQLite cache; see the migration step for
//! schema version 18.

use chrono::Utc;

use crate::db::CachedFollowedWorkItem;
use crate::error::{AppError, Result};

use super::{
    FollowWorkItemInput, ListFollowedWorkItemsInput, UnfollowWorkItemInput, WorkItemService,
    WorkItemSummary,
};

impl WorkItemService {
    pub fn follow_work_item(&self, input: FollowWorkItemInput) -> Result<()> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let title = input.title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title is required".to_string()));
        }
        self.db.upsert_followed_work_item(
            &organization.id,
            &CachedFollowedWorkItem {
                work_item_id: input.work_item_id,
                project_id: input.project_id,
                project_name: input.project_name,
                title: title.to_string(),
                work_item_type: input.work_item_type,
                state: input.state,
                assigned_to: input.assigned_to,
                web_url: input.web_url,
                followed_at: Utc::now().to_rfc3339(),
            },
        )
    }

    pub fn unfollow_work_item(&self, input: UnfollowWorkItemInput) -> Result<()> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        self.db
            .delete_followed_work_item(&organization.id, input.work_item_id)
    }

    pub fn list_followed_work_items(
        &self,
        input: ListFollowedWorkItemsInput,
    ) -> Result<Vec<WorkItemSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let rows = self.db.list_followed_work_items(&organization.id)?;
        Ok(rows
            .into_iter()
            .map(|row| WorkItemSummary {
                organization_id: organization.id.clone(),
                project_id: row.project_id,
                project_name: row.project_name,
                id: row.work_item_id,
                title: row.title,
                work_item_type: row.work_item_type,
                state: row.state,
                assigned_to: row.assigned_to,
                changed_date: None,
                web_url: row.web_url,
                extra_fields: Vec::new(),
                depth: None,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AppDatabase;
    use crate::secrets::SecretStore;

    fn service() -> (WorkItemService, tempfile::NamedTempFile) {
        let tf = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(tf.path().to_path_buf());
        db.initialize().unwrap();
        (WorkItemService::new(db, SecretStore), tf)
    }

    fn make_org(db: &AppDatabase, id: &str) {
        db.upsert_organization(crate::db::OrganizationDraft {
            id: id.to_string(),
            name: id.to_string(),
            display_name: None,
            base_url: format!("https://dev.azure.com/{id}"),
            auth_provider: "pat".to_string(),
            credential_key: format!("azdodeck:org:{id}:pat"),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".to_string(),
        })
        .unwrap();
    }

    fn sample_input() -> FollowWorkItemInput {
        FollowWorkItemInput {
            organization_id: Some("org1".to_string()),
            project_id: "p1".to_string(),
            project_name: "Project One".to_string(),
            work_item_id: 42,
            title: "Fix login".to_string(),
            work_item_type: Some("Bug".to_string()),
            state: Some("Active".to_string()),
            assigned_to: Some("Alice".to_string()),
            web_url: Some("https://dev.azure.com/org1/p1/_workitems/edit/42".to_string()),
        }
    }

    #[test]
    fn follow_then_list_then_unfollow() {
        let (service, _tf) = service();
        make_org(&service.db, "org1");

        service.follow_work_item(sample_input()).unwrap();
        let items = service
            .list_followed_work_items(ListFollowedWorkItemsInput {
                organization_id: Some("org1".to_string()),
            })
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, 42);
        assert_eq!(items[0].title, "Fix login");
        assert_eq!(items[0].organization_id, "org1");

        service
            .unfollow_work_item(UnfollowWorkItemInput {
                organization_id: Some("org1".to_string()),
                work_item_id: 42,
            })
            .unwrap();
        let items = service
            .list_followed_work_items(ListFollowedWorkItemsInput {
                organization_id: Some("org1".to_string()),
            })
            .unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn follow_rejects_blank_title() {
        let (service, _tf) = service();
        make_org(&service.db, "org1");

        let mut input = sample_input();
        input.title = "   ".to_string();
        let result = service.follow_work_item(input);
        assert!(result.is_err());
    }
}
