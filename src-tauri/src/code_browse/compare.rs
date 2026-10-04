//! Files > Compare: tags for the revision pickers and the changed-file list
//! between two arbitrary revisions (branch, tag or commit).

use azdo_client::{GitCommitDiffs, GitVersionType};
use serde::{Deserialize, Serialize};

use super::{CodeBrowseService, ListBranchesInput};
use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

/// Most changed files requested for one comparison; the response is flagged
/// `truncated` when the repository diff has more.
const COMPARE_TOP: u32 = 1000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRevisionsInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    /// `branch`, `tag` or `commit`.
    pub base_type: String,
    pub base: String,
    pub target_type: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionChange {
    pub path: String,
    /// `edit`, `add`, `delete`, `rename`, ...
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionComparison {
    pub changes: Vec<RevisionChange>,
    pub truncated: bool,
}

fn parse_version_type(value: &str) -> Result<GitVersionType> {
    match value {
        "branch" => Ok(GitVersionType::Branch),
        "tag" => Ok(GitVersionType::Tag),
        "commit" => Ok(GitVersionType::Commit),
        other => Err(AppError::InvalidInput(format!(
            "unknown revision type: {other}"
        ))),
    }
}

fn require_revision<'a>(label: &str, value: &'a str) -> Result<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "{label} revision is required"
        )));
    }
    Ok(trimmed)
}

/// Keeps the changed files (folders carry no content change of their own) in
/// path order, and flags a server-side cap.
fn map_comparison(diffs: GitCommitDiffs) -> RevisionComparison {
    let mut changes: Vec<RevisionChange> = diffs
        .changes
        .into_iter()
        .filter_map(|change| {
            let item = change.item?;
            if item.is_folder == Some(true) {
                return None;
            }
            Some(RevisionChange {
                path: item.path?,
                change_type: change.change_type,
                original_path: change.original_path,
            })
        })
        .collect();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    RevisionComparison {
        changes,
        truncated: diffs.all_changes_included == Some(false),
    }
}

impl CodeBrowseService {
    /// Lists a repository's tag names (newest-looking names first).
    pub async fn list_tags(&self, input: ListBranchesInput) -> Result<Vec<String>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut tags: Vec<String> = client
            .list_tags(&input.project, &input.repository)
            .await?
            .into_iter()
            .map(|git_ref| {
                git_ref
                    .name
                    .strip_prefix("refs/tags/")
                    .unwrap_or(&git_ref.name)
                    .to_string()
            })
            .collect();
        tags.sort_by(|a, b| b.cmp(a));
        Ok(tags)
    }

    /// The files changed between two revisions.
    pub async fn compare_revisions(
        &self,
        input: CompareRevisionsInput,
    ) -> Result<RevisionComparison> {
        let base_type = parse_version_type(&input.base_type)?;
        let target_type = parse_version_type(&input.target_type)?;
        let base = require_revision("base", &input.base)?;
        let target = require_revision("target", &input.target)?;
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let diffs = client
            .compare_revisions(
                &input.project,
                &input.repository,
                (base_type, base),
                (target_type, target),
                COMPARE_TOP,
            )
            .await?;
        Ok(map_comparison(diffs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use azdo_client::{GitDiffChange, GitDiffItem};

    fn change(path: &str, change_type: &str, is_folder: bool) -> GitDiffChange {
        GitDiffChange {
            change_type: change_type.to_string(),
            item: Some(GitDiffItem {
                path: Some(path.to_string()),
                is_folder: Some(is_folder),
            }),
            original_path: None,
        }
    }

    #[test]
    fn map_comparison_drops_folders_sorts_by_path_and_flags_truncation() {
        let comparison = map_comparison(GitCommitDiffs {
            changes: vec![
                change("/z.ts", "edit", false),
                change("/dir", "add", true),
                change("/a.ts", "add", false),
            ],
            all_changes_included: Some(false),
            common_commit: None,
        });
        let paths: Vec<_> = comparison.changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, ["/a.ts", "/z.ts"]);
        assert!(comparison.truncated);
    }

    #[test]
    fn map_comparison_is_complete_when_the_server_includes_everything() {
        let comparison = map_comparison(GitCommitDiffs {
            changes: vec![],
            all_changes_included: Some(true),
            common_commit: None,
        });
        assert!(!comparison.truncated);
        assert!(comparison.changes.is_empty());
    }

    #[test]
    fn revision_types_and_values_are_validated() {
        assert!(parse_version_type("branch").is_ok());
        assert!(parse_version_type("tag").is_ok());
        assert!(parse_version_type("commit").is_ok());
        assert!(parse_version_type("head").is_err());
        assert!(require_revision("base", "  ").is_err());
        assert_eq!(require_revision("base", " main ").unwrap(), "main");
    }
}
