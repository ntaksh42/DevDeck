//! Files > Branches > Tags: every tag with the commit it points at, plus
//! creating and deleting (lightweight) tags (issue #536).

use azdo_client::ZERO_OBJECT_ID;
use serde::{Deserialize, Serialize};

use super::branches::{require_ref_update, validate_branch_name};
use super::{CodeBrowseService, ListBranchesInput};
use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagOverviewItem {
    pub name: String,
    /// The tagged commit (the peeled commit for an annotated tag).
    pub commit_id: Option<String>,
    /// What the ref itself points at: the commit for a lightweight tag, the tag
    /// object for an annotated one. Needed to delete the tag.
    pub object_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    /// Short name of the new tag, e.g. `v1.2.0`.
    pub name: String,
    /// The commit to tag.
    pub commit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTagInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub name: String,
    /// The ref's object id the caller saw; the delete is refused if the tag has
    /// been moved meanwhile.
    pub object_id: String,
}

impl CodeBrowseService {
    /// Lists tags with their commits, newest-looking names first.
    pub async fn list_tag_overview(
        &self,
        input: ListBranchesInput,
    ) -> Result<Vec<TagOverviewItem>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut tags: Vec<TagOverviewItem> = client
            .list_tags(&input.project, &input.repository)
            .await?
            .into_iter()
            .map(|git_ref| TagOverviewItem {
                name: git_ref
                    .name
                    .strip_prefix("refs/tags/")
                    .unwrap_or(&git_ref.name)
                    .to_string(),
                commit_id: git_ref
                    .peeled_object_id
                    .or_else(|| git_ref.object_id.clone()),
                object_id: git_ref.object_id,
            })
            .collect();
        tags.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(tags)
    }

    /// Creates the lightweight tag `refs/tags/{name}` at `commit_id`.
    pub async fn create_tag(&self, input: CreateTagInput) -> Result<()> {
        let name = validate_tag_name(&input.name)?;
        if input.commit_id.trim().is_empty() {
            return Err(AppError::InvalidInput("a commit is required".to_string()));
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let result = client
            .update_ref(
                &input.project,
                &input.repository,
                &format!("refs/tags/{name}"),
                ZERO_OBJECT_ID,
                input.commit_id.trim(),
            )
            .await?;
        require_ref_update("create the tag", result)
    }

    /// Deletes `refs/tags/{name}` if it still points at `object_id`.
    pub async fn delete_tag(&self, input: DeleteTagInput) -> Result<()> {
        let name = validate_tag_name(&input.name)?;
        if input.object_id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "the tag's object id is required".to_string(),
            ));
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let result = client
            .update_ref(
                &input.project,
                &input.repository,
                &format!("refs/tags/{name}"),
                input.object_id.trim(),
                ZERO_OBJECT_ID,
            )
            .await?;
        require_ref_update("delete the tag", result)
    }
}

/// Tag names follow the same Git ref-name rules as branch names.
fn validate_tag_name(name: &str) -> Result<&str> {
    validate_branch_name(name)
        .map_err(|_| AppError::InvalidInput(format!("invalid tag name: {}", name.trim())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_names_follow_git_ref_rules() {
        assert_eq!(validate_tag_name(" v1.2.0 ").unwrap(), "v1.2.0");
        assert!(validate_tag_name("release/2026-10").is_ok());
        for bad in ["", "v 1", "v1..2", "v1.lock", "-v1", "v1~2"] {
            let error = validate_tag_name(bad).unwrap_err().to_string();
            assert!(error.contains("invalid tag name"), "{bad}: {error}");
        }
    }
}
