//! Cherry-pick and revert: the first write operations on the Commits screen.
//! Both call an Azure DevOps API that runs asynchronously (queued/inProgress
//! before completed/failed/abandoned), so `azdo_client` polls to a terminal
//! status before returning; this module only maps that result into the shape
//! the frontend renders and enforces read-only mode, mirroring
//! `work_items::mutations::ensure_write_enabled`.

use azdo_client::{GitAsyncOperationStatus, GitAsyncRefOperationDetail};

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};
use crate::settings::SettingsService;

use super::helpers::{branch_web_url, short_branch_name, to_full_ref_name};
use super::{CherryPickCommitInput, CommitRefOperationResult, CommitService, RevertCommitInput};

impl CommitService {
    pub async fn cherry_pick_commit(
        &self,
        input: CherryPickCommitInput,
    ) -> Result<CommitRefOperationResult> {
        self.ensure_write_enabled()?;
        let new_branch_name = require_branch_name(&input.new_branch_name)?;
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let onto_ref_name = to_full_ref_name(&input.onto_branch);
        let generated_ref_name = to_full_ref_name(&new_branch_name);
        let operation = client
            .cherry_pick_commit_and_wait(
                &input.project_id,
                &input.repository_id,
                &input.commit_id,
                &onto_ref_name,
                &generated_ref_name,
            )
            .await?;

        Ok(build_result(
            &organization,
            &input.project_name,
            &input.repository_name,
            &generated_ref_name,
            operation.status,
            operation.detailed_status,
        ))
    }

    pub async fn revert_commit(
        &self,
        input: RevertCommitInput,
    ) -> Result<CommitRefOperationResult> {
        self.ensure_write_enabled()?;
        let new_branch_name = require_branch_name(&input.new_branch_name)?;
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let onto_ref_name = to_full_ref_name(&input.onto_branch);
        let generated_ref_name = to_full_ref_name(&new_branch_name);
        let operation = client
            .revert_commit_and_wait(
                &input.project_id,
                &input.repository_id,
                &input.commit_id,
                &onto_ref_name,
                &generated_ref_name,
            )
            .await?;

        Ok(build_result(
            &organization,
            &input.project_name,
            &input.repository_name,
            &generated_ref_name,
            operation.status,
            operation.detailed_status,
        ))
    }

    /// Rejects the write when read-only validation mode is enabled, checked
    /// fresh on every call (not cached) so toggling the setting takes effect
    /// immediately, exactly like `work_items::mutations`.
    fn ensure_write_enabled(&self) -> Result<()> {
        if SettingsService::new(self.db.clone())
            .get()?
            .read_only_validation_mode_enabled
        {
            return Err(AppError::InvalidInput(
                "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps."
                    .to_string(),
            ));
        }
        Ok(())
    }
}

fn require_branch_name(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "new branch name is required".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn build_result(
    organization: &crate::db::Organization,
    project_name: &str,
    repository_name: &str,
    generated_ref_name: &str,
    status: GitAsyncOperationStatus,
    detailed_status: Option<GitAsyncRefOperationDetail>,
) -> CommitRefOperationResult {
    let branch_name = short_branch_name(generated_ref_name).to_string();
    let conflict = detailed_status.as_ref().is_some_and(|d| d.conflict);
    let failure_message = detailed_status.and_then(|d| d.failure_message);
    let new_branch_web_url = (status == GitAsyncOperationStatus::Completed)
        .then(|| branch_web_url(organization, project_name, repository_name, &branch_name));

    CommitRefOperationResult {
        status: status.as_str().to_string(),
        new_branch_name: branch_name,
        new_branch_web_url,
        conflict,
        failure_message,
    }
}
