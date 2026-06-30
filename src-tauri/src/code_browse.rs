use azdo_client::{CommitSearchCriteria, GitCommitRef};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::secrets::SecretStore;

/// Largest file we render in the browser. Bigger blobs are reported as
/// `too_large` instead of being streamed into the UI.
const MAX_FILE_BYTES: usize = 512 * 1024;

/// Largest binary blob we fetch for inline preview (e.g. images). Mirrors the
/// work item attachment image cap; bigger files are reported as `too_large`
/// so the frontend can fall back to opening the file in Azure DevOps instead.
const MAX_BINARY_PREVIEW_BYTES: usize = 10 * 1024 * 1024;

/// Maximum commits returned for the Files > History tab.
const HISTORY_TOP: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBranchesInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTreeInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    /// Folder to list, e.g. `/` or `/src`. Defaults to the repository root.
    #[serde(default)]
    pub path: Option<String>,
    /// When true, each item carries its latest commit (for the folder table).
    /// The lightweight tree omits this to keep expansion cheap.
    #[serde(default)]
    pub include_last_commit: Option<bool>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFileInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    pub path: String,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFileBinaryInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHistoryInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    /// Path whose commit history to list, e.g. `/` or `/src/main.py`.
    pub path: String,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranch {
    /// Short branch name, e.g. `main` (the `refs/heads/` prefix is stripped).
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoTreeItem {
    /// Display name (last path segment).
    pub name: String,
    /// Full repository path, e.g. `/src/main.py`.
    pub path: String,
    pub is_folder: bool,
    /// The item's latest commit, when requested via `include_last_commit`.
    pub last_commit: Option<RepoCommitInfo>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommitInfo {
    /// Short commit id (first 8 chars) for display.
    pub short_id: String,
    /// Full commit id, for building the Azure DevOps commit link.
    pub commit_id: String,
    /// First line of the commit message.
    pub message: String,
    pub author: Option<String>,
    /// ISO-8601 commit date (committer date, falling back to author date).
    pub date: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFile {
    pub path: String,
    pub content: String,
    /// True when Azure DevOps flagged the blob as binary; `content` is empty.
    pub is_binary: bool,
    /// True when the blob exceeded [`MAX_FILE_BYTES`]; `content` is empty.
    pub too_large: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFileBinary {
    pub path: String,
    /// Base64-encoded file bytes; empty when `too_large`.
    pub content_base64: String,
    /// True when the blob exceeded [`MAX_BINARY_PREVIEW_BYTES`].
    pub too_large: bool,
}

#[derive(Debug, Clone)]
pub struct CodeBrowseService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl CodeBrowseService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    /// Lists a repository's branches, marking the repo default.
    pub async fn list_branches(&self, input: ListBranchesInput) -> Result<Vec<RepoBranch>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        // The refs API does not report which branch is the default, so resolve
        // the repository's `defaultBranch` (a `refs/heads/...` ref) separately.
        let default_ref = client
            .list_repositories(&input.project)
            .await?
            .into_iter()
            .find(|repo| repo.id == input.repository || repo.name == input.repository)
            .and_then(|repo| repo.default_branch);

        let mut branches: Vec<RepoBranch> = client
            .list_branches(&input.project, &input.repository)
            .await?
            .into_iter()
            .map(|git_ref| {
                let is_default = default_ref.as_deref() == Some(git_ref.name.as_str());
                RepoBranch {
                    name: strip_heads_prefix(&git_ref.name).to_string(),
                    is_default,
                }
            })
            .collect();
        // Default branch first, then alphabetical for stable, scannable order.
        branches.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));
        Ok(branches)
    }

    /// Lists the direct children of a folder at the tip of a branch, folders
    /// before files, each alphabetical.
    pub async fn list_tree(&self, input: ListTreeInput) -> Result<Vec<RepoTreeItem>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let scope = normalize_scope(input.path.as_deref());
        let include_last_commit = input.include_last_commit.unwrap_or(false);

        let mut items: Vec<RepoTreeItem> = client
            .list_items(
                &input.project,
                &input.repository,
                &input.branch,
                &scope,
                include_last_commit,
            )
            .await?
            .into_iter()
            // The API echoes the scope folder itself; keep only its children.
            .filter(|item| item.path != scope)
            .map(|item| RepoTreeItem {
                name: leaf_name(&item.path).to_string(),
                path: item.path,
                is_folder: item.is_folder,
                last_commit: item.latest_processed_change.map(commit_info),
            })
            .collect();
        items.sort_by(|a, b| {
            b.is_folder
                .cmp(&a.is_folder)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(items)
    }

    /// Fetches a file's text content at the tip of a branch.
    pub async fn get_file(&self, input: GetFileInput) -> Result<RepoFile> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let item = client
            .get_item_content_at_branch(
                &input.project,
                &input.repository,
                &input.path,
                &input.branch,
            )
            .await?;

        let is_binary = item
            .content_metadata
            .as_ref()
            .and_then(|metadata| metadata.is_binary)
            .unwrap_or(false);
        if is_binary {
            return Ok(RepoFile {
                path: input.path,
                content: String::new(),
                is_binary: true,
                too_large: false,
            });
        }
        match item.content {
            Some(content) if content.len() > MAX_FILE_BYTES => Ok(RepoFile {
                path: input.path,
                content: String::new(),
                is_binary: false,
                too_large: true,
            }),
            Some(content) => Ok(RepoFile {
                path: input.path,
                content,
                is_binary: false,
                too_large: false,
            }),
            // No content and not flagged binary: treat as an empty file.
            None => Ok(RepoFile {
                path: input.path,
                content: String::new(),
                is_binary: false,
                too_large: false,
            }),
        }
    }

    /// Fetches a file's raw bytes at the tip of a branch, base64-encoded, for
    /// inline preview (e.g. images) distinct from the text content path. Used
    /// only when the caller already knows it wants binary content; callers
    /// decide previewability (e.g. by file extension) rather than this method.
    pub async fn get_file_binary(&self, input: GetFileBinaryInput) -> Result<RepoFileBinary> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let response = client
            .get_item_bytes_at_branch(
                &input.project,
                &input.repository,
                &input.path,
                &input.branch,
            )
            .await?;

        if response.bytes.len() > MAX_BINARY_PREVIEW_BYTES {
            return Ok(RepoFileBinary {
                path: input.path,
                content_base64: String::new(),
                too_large: true,
            });
        }
        Ok(RepoFileBinary {
            path: input.path,
            content_base64: BASE64_STANDARD.encode(response.bytes),
            too_large: false,
        })
    }

    /// Lists the commit history for a path at a branch (the Files > History tab).
    pub async fn list_history(&self, input: ListHistoryInput) -> Result<Vec<RepoCommitInfo>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        // The root lists the whole repository; a sub-path scopes to commits that
        // touched it.
        let item_path = match input.path.trim() {
            "" | "/" => None,
            path => Some(path.to_string()),
        };
        let commits = client
            .list_commits(
                &input.project,
                &input.repository,
                CommitSearchCriteria {
                    branch: Some(input.branch),
                    item_path,
                    top: Some(HISTORY_TOP),
                    ..Default::default()
                },
            )
            .await?;
        Ok(commits.into_iter().map(commit_info).collect())
    }
}

fn commit_info(change: GitCommitRef) -> RepoCommitInfo {
    let short_id = change.commit_id.chars().take(8).collect();
    let message = change
        .comment
        .as_deref()
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    // Prefer the committer's name/date (when the change landed), falling back to
    // the author's.
    let author = change
        .committer
        .as_ref()
        .and_then(|user| user.name.clone())
        .or_else(|| change.author.as_ref().and_then(|user| user.name.clone()));
    let date = change
        .committer
        .as_ref()
        .and_then(|user| user.date)
        .or_else(|| change.author.as_ref().and_then(|user| user.date))
        .map(|date| date.to_rfc3339());
    RepoCommitInfo {
        short_id,
        commit_id: change.commit_id,
        message,
        author,
        date,
    }
}

fn strip_heads_prefix(ref_name: &str) -> &str {
    ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name)
}

/// Normalizes a tree scope path: blank/`""` becomes `/`, trailing slashes are
/// trimmed (except the root) so it matches the path the API echoes back.
fn normalize_scope(path: Option<&str>) -> String {
    let trimmed = path.unwrap_or("/").trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

fn leaf_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_scope_defaults_to_root() {
        assert_eq!(normalize_scope(None), "/");
        assert_eq!(normalize_scope(Some("")), "/");
        assert_eq!(normalize_scope(Some("  ")), "/");
        assert_eq!(normalize_scope(Some("/src/")), "/src");
        assert_eq!(normalize_scope(Some("/src")), "/src");
    }

    #[test]
    fn leaf_name_takes_last_segment() {
        assert_eq!(leaf_name("/src/main.py"), "main.py");
        assert_eq!(leaf_name("/README.md"), "README.md");
        assert_eq!(leaf_name("/src/lib"), "lib");
    }

    #[test]
    fn strip_heads_prefix_shortens_branch() {
        assert_eq!(strip_heads_prefix("refs/heads/main"), "main");
        assert_eq!(strip_heads_prefix("refs/heads/feature/x"), "feature/x");
        assert_eq!(strip_heads_prefix("main"), "main");
    }
}
