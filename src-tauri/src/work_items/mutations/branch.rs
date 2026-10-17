//! Creating a branch for a work item and linking it, so the branch shows in the
//! work item's Development section (issue #695).

use azdo_client::ZERO_OBJECT_ID;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::super::WorkItemService;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkItemBranchInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub work_item_id: i64,
    pub repository_id: String,
    /// Short name of the branch to start from, e.g. `main`.
    pub base_branch: String,
    /// Short name of the new branch, e.g. `feature/123-fix-login`.
    pub branch_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkItemBranchResult {
    pub branch_name: String,
    /// False when the branch exists but linking it to the work item failed.
    pub linked: bool,
    pub link_error: Option<String>,
}

/// Checks `name` against the Git ref-name rules and returns it trimmed.
pub(crate) fn validate_branch_name(name: &str) -> Result<String> {
    let name = name.trim();
    let invalid = |reason: &str| AppError::InvalidInput(format!("invalid branch name: {reason}"));
    if name.is_empty() {
        return Err(invalid("it is empty"));
    }
    if name == "@" || name.contains("@{") || name.contains("..") || name.contains("//") {
        return Err(invalid("it has a forbidden sequence (@, @{, .., //)"));
    }
    if name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
        return Err(invalid("it cannot start or end with / or end with a dot"));
    }
    if name
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
    {
        return Err(invalid("it has a space or one of ~ ^ : ? * [ \\"));
    }
    if name
        .split('/')
        .any(|part| part.starts_with('.') || part.ends_with(".lock"))
    {
        return Err(invalid("a path part cannot start with . or end with .lock"));
    }
    Ok(name.to_string())
}

/// `vstfs:///Git/Ref/{projectId}%2F{repositoryId}%2FGB{branch}`, the artifact
/// URL Azure DevOps uses for a branch link. Slashes in the branch name are
/// encoded because the whole value is one URL segment.
pub(crate) fn branch_artifact_url(project_id: &str, repository_id: &str, branch: &str) -> String {
    let branch = branch.replace('%', "%25").replace('/', "%2F");
    format!("vstfs:///Git/Ref/{project_id}%2F{repository_id}%2FGB{branch}")
}

impl WorkItemService {
    /// Creates `branch_name` from `base_branch`, then links it to the work item.
    /// The branch is kept when only the link fails, and the result says so.
    pub async fn create_branch(
        &self,
        input: CreateWorkItemBranchInput,
    ) -> Result<CreateWorkItemBranchResult> {
        let branch_name = validate_branch_name(&input.branch_name)?;
        let base = input.base_branch.trim().trim_start_matches("refs/heads/");
        if base.is_empty() {
            return Err(AppError::InvalidInput(
                "base branch is required".to_string(),
            ));
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let branches = client
            .list_branches(&input.project_id, &input.repository_id)
            .await?;
        let new_ref = format!("refs/heads/{branch_name}");
        if branches.iter().any(|branch| branch.name == new_ref) {
            return Err(AppError::InvalidInput(format!(
                "branch {branch_name} already exists"
            )));
        }
        let base_ref = format!("refs/heads/{base}");
        let base_id = branches
            .iter()
            .find(|branch| branch.name == base_ref)
            .and_then(|branch| branch.object_id.clone())
            .ok_or_else(|| AppError::InvalidInput(format!("base branch {base} was not found")))?;

        let update = client
            .update_ref(
                &input.project_id,
                &input.repository_id,
                &new_ref,
                ZERO_OBJECT_ID,
                &base_id,
            )
            .await?;
        if !update.success {
            let reason = update
                .custom_message
                .or(update.update_status)
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(AppError::InvalidInput(format!(
                "could not create the branch: {reason}"
            )));
        }

        let artifact_url =
            branch_artifact_url(&input.project_id, &input.repository_id, &branch_name);
        let link = client
            .add_work_item_artifact_link(
                &input.project_id,
                input.work_item_id,
                &artifact_url,
                "Branch",
            )
            .await;
        Ok(CreateWorkItemBranchResult {
            branch_name,
            linked: link.is_ok(),
            link_error: link.err().map(|error| AppError::from(error).to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_branch_names_pass_and_are_trimmed() {
        assert_eq!(
            validate_branch_name(" feature/123-fix-login ").unwrap(),
            "feature/123-fix-login"
        );
        assert!(validate_branch_name("bugfix/日本語-修正").is_ok());
    }

    #[test]
    fn git_ref_rule_violations_are_rejected() {
        for name in [
            "",
            "   ",
            "@",
            "a b",
            "a..b",
            "a//b",
            "/a",
            "a/",
            "a.",
            "a~b",
            "a^b",
            "a:b",
            "a?b",
            "a*b",
            "a[b",
            r"a\b",
            "a@{b",
            "a/.hidden",
            "x.lock",
            "a/b.lock/c",
            ".a",
        ] {
            assert!(
                validate_branch_name(name).is_err(),
                "{name:?} should be rejected"
            );
        }
    }

    #[test]
    fn artifact_url_encodes_slashes_in_the_branch_name() {
        assert_eq!(
            branch_artifact_url("p", "r", "feature/10-fix"),
            "vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F10-fix"
        );
    }
}
