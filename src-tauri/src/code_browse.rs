mod util;

use azdo_client::{CommitSearchCriteria, GitCommitRef};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::secrets::SecretStore;

use util::{
    image_mime, leaf_name, normalize_scope, resolve_version, strip_heads_prefix,
    truncate_at_char_boundary,
};

/// Largest text file we render in full. Bigger files return their leading
/// bytes with `truncated=true` instead of nothing.
const MAX_FILE_BYTES: usize = 512 * 1024;

/// Largest image we inline as a base64 data URL. Bigger images are reported as
/// `too_large`.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;

/// Maximum commits returned for the Files > History tab.
const HISTORY_TOP: u32 = 50;

/// Maximum entries returned by the recursive path listing (tree filter). The
/// response carries `truncated=true` when the repository has more.
const MAX_RECURSIVE_PATHS: usize = 20_000;

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
    /// Optional ref overriding `branch`: `versionType` is `branch`, `commit`,
    /// or `tag`, and `version` names it. Both must be set together.
    #[serde(default)]
    pub version_type: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPathsInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    #[serde(default)]
    pub operation_id: Option<String>,
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
    /// Page size; defaults to `HISTORY_TOP` when omitted or zero.
    pub top: Option<u32>,
    /// Number of leading commits to skip, for "load more" paging.
    #[serde(default)]
    pub skip: Option<u32>,
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
    /// True when the blob exceeded its size cap; `content` is empty.
    pub too_large: bool,
    /// True when `content` holds only the leading [`MAX_FILE_BYTES`] of a
    /// larger text file.
    pub truncated: bool,
    /// A `data:` URL for image files, rendered instead of text content.
    pub image_data_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoPathItem {
    /// Display name (last path segment).
    pub name: String,
    /// Full repository path, e.g. `/src/main.py`.
    pub path: String,
    pub is_folder: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoPathList {
    pub items: Vec<RepoPathItem>,
    /// True when the repository has more entries than [`MAX_RECURSIVE_PATHS`].
    pub truncated: bool,
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
                false,
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

    /// Fetches a file's content at a ref (the branch tip by default, or the
    /// `versionType`/`version` override). Text comes back as a string (the
    /// leading [`MAX_FILE_BYTES`] with `truncated=true` when larger), images as
    /// a base64 data URL, and other binaries as `is_binary`.
    pub async fn get_file(&self, input: GetFileInput) -> Result<RepoFile> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (version_type, version) = resolve_version(&input)?;

        if let Some(mime) = image_mime(&input.path) {
            let response = client
                .get_item_bytes(
                    &input.project,
                    &input.repository,
                    &input.path,
                    version_type,
                    version,
                )
                .await?;
            if response.bytes.len() > MAX_IMAGE_BYTES {
                return Ok(RepoFile {
                    path: input.path,
                    content: String::new(),
                    is_binary: true,
                    too_large: true,
                    truncated: false,
                    image_data_url: None,
                });
            }
            let encoded = BASE64_STANDARD.encode(&response.bytes);
            return Ok(RepoFile {
                path: input.path,
                content: String::new(),
                is_binary: true,
                too_large: false,
                truncated: false,
                image_data_url: Some(format!("data:{mime};base64,{encoded}")),
            });
        }

        let item = client
            .get_item_content_at_version(
                &input.project,
                &input.repository,
                &input.path,
                version_type,
                version,
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
                truncated: false,
                image_data_url: None,
            });
        }
        // No content and not flagged binary is an empty file.
        let content = item.content.unwrap_or_default();
        let truncated = content.len() > MAX_FILE_BYTES;
        Ok(RepoFile {
            path: input.path,
            content: if truncated {
                truncate_at_char_boundary(&content, MAX_FILE_BYTES).to_string()
            } else {
                content
            },
            is_binary: false,
            too_large: false,
            truncated,
            image_data_url: None,
        })
    }

    /// Lists every path in a repository at a branch tip (one recursive items
    /// call), for filtering the tree across unexpanded folders. Sorted by
    /// path; capped at [`MAX_RECURSIVE_PATHS`] with `truncated` set.
    pub async fn list_paths(&self, input: ListPathsInput) -> Result<RepoPathList> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut items: Vec<RepoPathItem> = client
            .list_items(
                &input.project,
                &input.repository,
                &input.branch,
                "/",
                true,
                false,
            )
            .await?
            .into_iter()
            .filter(|item| item.path != "/")
            .map(|item| RepoPathItem {
                name: leaf_name(&item.path).to_string(),
                path: item.path,
                is_folder: item.is_folder,
            })
            .collect();
        items.sort_by_key(|item| item.path.to_lowercase());
        let truncated = items.len() > MAX_RECURSIVE_PATHS;
        items.truncate(MAX_RECURSIVE_PATHS);
        Ok(RepoPathList { items, truncated })
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
        let top = match input.top {
            Some(value) if value > 0 => value,
            _ => HISTORY_TOP,
        };
        let commits = client
            .list_commits(
                &input.project,
                &input.repository,
                CommitSearchCriteria {
                    branch: Some(input.branch),
                    item_path,
                    top: Some(top),
                    skip: input.skip,
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
