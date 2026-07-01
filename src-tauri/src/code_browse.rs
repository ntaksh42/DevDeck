use std::collections::HashMap;

use azdo_client::{
    CommitSearchCriteria, GitBranchStats, GitCommitRef, GitPullRequest, PullRequestStatus,
};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::secrets::SecretStore;

/// Largest file we render in the browser. Bigger blobs are reported as
/// `too_large` instead of being streamed into the UI.
const MAX_FILE_BYTES: usize = 512 * 1024;

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

/// A repository branch with its tip-commit metadata, divergence from the base
/// branch, and the active pull request that uses it as a source branch, if
/// any (issue #398).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummary {
    pub name: String,
    pub is_base_version: bool,
    pub ahead_count: i64,
    pub behind_count: i64,
    pub last_commit_id: Option<String>,
    pub last_commit_comment: Option<String>,
    pub last_updated: Option<String>,
    pub last_author: Option<String>,
    pub pull_request_id: Option<i64>,
    pub pull_request_title: Option<String>,
    pub pull_request_url: Option<String>,
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

    /// Lists the repository's branches with tip-commit metadata and
    /// ahead/behind counts relative to the base branch, linking each to the
    /// active pull request that uses it as a source branch, if any (issue
    /// #398). Hits the API on demand rather than reading the cache.
    pub async fn list_branch_summaries(
        &self,
        input: ListBranchesInput,
    ) -> Result<Vec<BranchSummary>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let stats = client
            .list_branch_stats(&input.project, &input.repository)
            .await?;

        // A 404 (e.g. an empty repository) is treated as "no active PRs"
        // rather than failing the whole branch list.
        let active = client
            .list_pull_requests(&input.project, &input.repository, PullRequestStatus::Active)
            .await
            .unwrap_or_default();
        Ok(build_branch_summaries(
            &organization.base_url,
            stats,
            active,
        ))
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

fn strip_heads_prefix(ref_name: &str) -> &str {
    ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name)
}

/// Combines branch ahead/behind stats with the active pull requests that use
/// each branch as a source, sorted base branch first then most-recently
/// updated (issue #398). Pure so it can be unit tested without network I/O.
fn build_branch_summaries(
    org_base_url: &str,
    stats: Vec<GitBranchStats>,
    active_prs: Vec<GitPullRequest>,
) -> Vec<BranchSummary> {
    // Map active PRs by source branch so each branch can surface its open PR.
    let mut pr_by_branch: HashMap<String, (i64, String, Option<String>)> = HashMap::new();
    for pr in active_prs {
        let branch = strip_heads_prefix(&pr.source_ref_name).to_string();
        let web_url = pr.repository.as_ref().and_then(|repo| {
            repo.project.as_ref().map(|project| {
                format!(
                    "{org_base_url}/{}/_git/{}/pullrequest/{}",
                    encode_path_segment(&project.name),
                    encode_path_segment(&repo.name),
                    pr.pull_request_id
                )
            })
        });
        // Keep the lowest PR id when several PRs share a source branch.
        pr_by_branch
            .entry(branch)
            .or_insert((pr.pull_request_id, pr.title.clone(), web_url));
    }

    let mut branches: Vec<BranchSummary> = stats
        .into_iter()
        .map(|stat| {
            let (last_commit_id, last_commit_comment, last_updated, last_author) = match stat.commit
            {
                Some(commit) => (
                    Some(commit.commit_id),
                    commit.comment,
                    commit
                        .committer
                        .as_ref()
                        .and_then(|user| user.date)
                        .map(|date| date.to_rfc3339()),
                    commit.committer.and_then(|user| user.name),
                ),
                None => (None, None, None, None),
            };
            let linked = pr_by_branch.get(&stat.name);
            BranchSummary {
                name: stat.name,
                is_base_version: stat.is_base_version,
                ahead_count: stat.ahead_count,
                behind_count: stat.behind_count,
                last_commit_id,
                last_commit_comment,
                last_updated,
                last_author,
                pull_request_id: linked.map(|l| l.0),
                pull_request_title: linked.map(|l| l.1.clone()),
                pull_request_url: linked.and_then(|l| l.2.clone()),
            }
        })
        .collect();

    // Base branch first, then most-recently updated.
    branches.sort_by(|a, b| {
        b.is_base_version
            .cmp(&a.is_base_version)
            .then_with(|| b.last_updated.cmp(&a.last_updated))
    });
    branches
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
mod tests_branch_summaries;

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
