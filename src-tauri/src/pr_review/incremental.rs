use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::{PrChangedFile, PrLocator, PrReviewService, PullRequestChanges};

impl PrReviewService {
    /// First review covers the PR; subsequent reviews cover only changes since
    /// the last successfully reviewed source commit, even after a force push.
    pub async fn list_changes_since(
        &self,
        pr: PrLocator,
        previous_commit: Option<&str>,
    ) -> Result<PullRequestChanges> {
        let Some(previous) = previous_commit else {
            return self.list_changes(pr).await;
        };
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let iterations = client
            .list_pull_request_iterations(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await?;
        let target = iterations
            .into_iter()
            .max_by_key(|iteration| iteration.id)
            .and_then(|iteration| iteration.source_ref_commit)
            .map(|commit| commit.commit_id)
            .ok_or_else(|| AppError::InvalidInput("PR source commit is unavailable".into()))?;
        let entries = if previous == target {
            Vec::new()
        } else {
            client
                .compare_commit_snapshots(&pr.project_id, &pr.repository_id, previous, &target)
                .await?
        };
        let files = entries
            .into_iter()
            .filter_map(|entry| {
                let item = entry.item?;
                if item.is_folder.unwrap_or(false) {
                    return None;
                }
                Some(PrChangedFile {
                    path: item.path?,
                    change_type: entry.change_type.unwrap_or_else(|| "edit".into()),
                    original_path: entry.source_server_item,
                })
            })
            .collect();
        Ok(PullRequestChanges {
            base_commit_id: Some(previous.into()),
            target_commit_id: Some(target),
            files,
        })
    }
}
