//! Branch statistics (`stats/branches`): per-branch tip commit and the
//! ahead/behind counts against the repository's base (default) branch.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

use super::{GitCommitRef, ListResponse};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchStats {
    /// Short branch name (no `refs/heads/` prefix).
    pub name: String,
    #[serde(default)]
    pub ahead_count: i64,
    #[serde(default)]
    pub behind_count: i64,
    /// True for the base version the counts are measured against.
    #[serde(default)]
    pub is_base_version: bool,
    /// The branch tip commit.
    pub commit: Option<GitCommitRef>,
}

impl GitBranchStats {
    /// The tip commit's committer date, falling back to the author date.
    pub fn tip_date(&self) -> Option<DateTime<Utc>> {
        let commit = self.commit.as_ref()?;
        commit
            .committer
            .as_ref()
            .and_then(|user| user.date)
            .or_else(|| commit.author.as_ref().and_then(|user| user.date))
    }
}

impl AdoClient {
    /// Every branch of a repository with its tip commit and ahead/behind counts
    /// against the default branch.
    pub async fn list_branch_stats(
        &self,
        project_id: &str,
        repository_id: &str,
    ) -> Result<Vec<GitBranchStats>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/stats/branches");
        let response: ListResponse<GitBranchStats> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }
}
