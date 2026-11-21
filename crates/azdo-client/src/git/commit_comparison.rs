//! Exact snapshot comparisons, paged independently of the server's default 100 changes.

use serde::Deserialize;

use crate::{AdoClient, AdoError, GitChangeEntry, Result};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComparisonPage {
    #[serde(default)]
    changes: Vec<GitChangeEntry>,
    all_changes_included: Option<bool>,
}

impl AdoClient {
    /// Compares the actual base and target snapshots, including across a force push.
    /// `diffCommonCommit=false` deliberately avoids comparing against the merge base.
    pub async fn compare_commit_snapshots(
        &self,
        project_id: &str,
        repository_id: &str,
        base_commit_id: &str,
        target_commit_id: &str,
    ) -> Result<Vec<GitChangeEntry>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/diffs/commits");
        let mut changes = Vec::new();
        loop {
            let skip = changes.len().to_string();
            let page: ComparisonPage = self
                .get_json(
                    &path,
                    &[
                        ("api-version", "7.1"),
                        ("diffCommonCommit", "false"),
                        ("baseVersion", base_commit_id),
                        ("baseVersionType", "commit"),
                        ("targetVersion", target_commit_id),
                        ("targetVersionType", "commit"),
                        ("$top", "1000"),
                        ("$skip", &skip),
                    ],
                )
                .await?;
            let count = page.changes.len();
            changes.extend(page.changes);
            if page.all_changes_included == Some(true)
                || (page.all_changes_included.is_none() && count < 1000)
            {
                return Ok(changes);
            }
            if count == 0 {
                return Err(AdoError::api(
                    502,
                    "commit comparison returned an incomplete empty page".into(),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests;
