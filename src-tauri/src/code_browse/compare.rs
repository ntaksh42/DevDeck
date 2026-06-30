//! Files > Compare: diffing two arbitrary revisions (branch, tag, or commit)
//! of a repository, plus the folder-level changed-files list between them.
//! Split out of `code_browse/mod.rs` to keep that file under the project's
//! 500-line limit; methods are added to the same [`CodeBrowseService`] since
//! they share its `db`/`secrets` handles and the Files tab they back.

use azdo_client::{AdoClient, AdoError};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::error::Result;

use super::CodeBrowseService;

/// Largest file content we fetch for a single-file diff. Mirrors
/// `commits::helpers::MAX_DIFF_CONTENT_BYTES`.
const MAX_DIFF_CONTENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoTag {
    /// Short tag name, e.g. `v1.0.0` (the `refs/tags/` prefix is stripped).
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRevisionsInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub base_revision: String,
    /// One of `"branch"`, `"tag"`, or `"commit"`.
    pub base_revision_type: String,
    pub target_revision: String,
    /// One of `"branch"`, `"tag"`, or `"commit"`.
    pub target_revision_type: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRevisionFileDiffInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub file_path: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub base_revision: String,
    /// One of `"branch"`, `"tag"`, or `"commit"`.
    pub base_revision_type: String,
    pub target_revision: String,
    /// One of `"branch"`, `"tag"`, or `"commit"`.
    pub target_revision_type: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionFileDiff {
    pub file_path: String,
    pub base_content: Option<String>,
    pub target_content: Option<String>,
    pub base_unavailable_reason: Option<String>,
    pub target_unavailable_reason: Option<String>,
}

/// Mirrors `commits::helpers::ChangeFlags`: a pure add has no base side to
/// fetch, a pure delete has no target side.
struct ChangeFlags {
    is_add: bool,
    is_delete: bool,
}

impl ChangeFlags {
    fn parse(change_type: &str) -> Self {
        let tokens: Vec<&str> = change_type.split(',').map(|token| token.trim()).collect();
        Self {
            is_add: tokens.contains(&"add") || tokens.contains(&"undelete"),
            is_delete: tokens.contains(&"delete"),
        }
    }
}

impl CodeBrowseService {
    /// Lists a repository's tags, alphabetically.
    pub async fn list_tags(&self, input: ListTagsInput) -> Result<Vec<RepoTag>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut tags: Vec<RepoTag> = client
            .list_tags(&input.project, &input.repository)
            .await?
            .into_iter()
            .map(|git_ref| RepoTag {
                name: strip_tags_prefix(&git_ref.name).to_string(),
            })
            .collect();
        tags.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(tags)
    }

    /// Lists the changed files between two arbitrary revisions (the Files >
    /// Compare folder-level diff).
    pub async fn compare_revisions(
        &self,
        input: CompareRevisionsInput,
    ) -> Result<Vec<ChangedFile>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let diff = client
            .get_branches_diff(
                &input.project,
                &input.repository,
                &input.base_revision,
                &input.base_revision_type,
                &input.target_revision,
                &input.target_revision_type,
            )
            .await?;
        let files = diff
            .changes
            .into_iter()
            .filter_map(|entry| {
                let item = entry.item?;
                if item.is_folder.unwrap_or(false) {
                    return None;
                }
                Some(ChangedFile {
                    path: item.path?,
                    change_type: entry.change_type.unwrap_or_else(|| "edit".to_string()),
                    // `diffs/commits` reports a rename's old path via
                    // `originalPath`, not `sourceServerItem` (that field is
                    // populated by the commit/PR-iteration changes endpoints).
                    original_path: entry.original_path.or(entry.source_server_item),
                })
            })
            .collect();
        Ok(files)
    }

    /// Fetches a single file's diff between two arbitrary revisions, skipping
    /// the side a pure add/delete doesn't have. Mirrors
    /// `CommitService::get_commit_file_diff`.
    pub async fn get_revision_file_diff(
        &self,
        input: GetRevisionFileDiffInput,
    ) -> Result<RevisionFileDiff> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let flags = ChangeFlags::parse(&input.change_type);
        let base_path = input
            .original_path
            .clone()
            .unwrap_or_else(|| input.file_path.clone());

        let base_future = async {
            if flags.is_add {
                Ok((None, None))
            } else {
                fetch_revision_side(
                    &client,
                    &input.project,
                    &input.repository,
                    &base_path,
                    &input.base_revision,
                    &input.base_revision_type,
                )
                .await
            }
        };
        let target_future = async {
            if flags.is_delete {
                Ok((None, None))
            } else {
                fetch_revision_side(
                    &client,
                    &input.project,
                    &input.repository,
                    &input.file_path,
                    &input.target_revision,
                    &input.target_revision_type,
                )
                .await
            }
        };
        let ((base_content, base_unavailable_reason), (target_content, target_unavailable_reason)) =
            tokio::try_join!(base_future, target_future)?;

        Ok(RevisionFileDiff {
            file_path: input.file_path,
            base_content,
            target_content,
            base_unavailable_reason,
            target_unavailable_reason,
        })
    }
}

async fn fetch_revision_side(
    client: &AdoClient,
    project_id: &str,
    repository_id: &str,
    path: &str,
    revision: &str,
    revision_type: &str,
) -> Result<(Option<String>, Option<String>)> {
    match client
        .get_item_content_at_version(project_id, repository_id, path, revision, revision_type)
        .await
    {
        Ok(item) => {
            if item
                .content_metadata
                .as_ref()
                .and_then(|metadata| metadata.is_binary)
                .unwrap_or(false)
            {
                return Ok((None, Some("binary".to_string())));
            }
            match item.content {
                Some(content) if content.len() > MAX_DIFF_CONTENT_BYTES => {
                    Ok((None, Some("tooLarge".to_string())))
                }
                Some(content) => Ok((Some(content), None)),
                None => Ok((None, Some("binary".to_string()))),
            }
        }
        Err(AdoError::Api { status: 404, .. }) => Ok((None, Some("missing".to_string()))),
        Err(error) => Err(error.into()),
    }
}

fn strip_tags_prefix(ref_name: &str) -> &str {
    ref_name.strip_prefix("refs/tags/").unwrap_or(ref_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_tags_prefix_shortens_tag() {
        assert_eq!(strip_tags_prefix("refs/tags/v1.0.0"), "v1.0.0");
        assert_eq!(strip_tags_prefix("v1.0.0"), "v1.0.0");
    }

    #[test]
    fn change_flags_parse_detects_add_and_delete() {
        let add = ChangeFlags::parse("add");
        assert!(add.is_add);
        assert!(!add.is_delete);

        let delete = ChangeFlags::parse("delete");
        assert!(!delete.is_add);
        assert!(delete.is_delete);

        let edit = ChangeFlags::parse("edit");
        assert!(!edit.is_add);
        assert!(!edit.is_delete);

        let undelete = ChangeFlags::parse("undelete, edit");
        assert!(undelete.is_add);
    }
}
