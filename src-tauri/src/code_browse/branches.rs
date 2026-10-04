//! Files > Branches: every branch with its tip commit, ahead/behind counts
//! against the default branch, and the active pull requests it is the source of.

use std::collections::HashMap;

use azdo_client::{
    GitBranchStats, GitPullRequest, GitRefUpdateResult, PullRequestStatus, ZERO_OBJECT_ID,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::util::strip_heads_prefix;
use super::{CodeBrowseService, ListBranchesInput};
use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequest {
    pub pull_request_id: i64,
    pub title: String,
    pub is_draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchOverviewItem {
    pub name: String,
    pub is_default: bool,
    pub ahead: i64,
    pub behind: i64,
    pub last_commit_id: Option<String>,
    pub last_author: Option<String>,
    pub last_date: Option<DateTime<Utc>>,
    /// First line of the tip commit message.
    pub last_comment: Option<String>,
    /// Active pull requests whose source is this branch.
    pub pull_requests: Vec<BranchPullRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    /// Short name of the new branch, e.g. `feature/x`.
    pub name: String,
    /// The commit the new branch starts at (a branch tip, typically).
    pub source_commit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub name: String,
    /// The tip the caller saw; the delete is refused if the branch has moved.
    pub commit_id: String,
}

/// Checks `name` against Git's ref-name rules (the ones a user can plausibly
/// break), so a bad name fails here with a clear message.
pub(super) fn validate_branch_name(name: &str) -> Result<&str> {
    let name = name.trim();
    let invalid = name.is_empty()
        || name.starts_with('/')
        || name.ends_with('/')
        || name.starts_with('-')
        || name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name == "@"
        || name
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c))
        || name
            .split('/')
            .any(|part| part.starts_with('.') || part.ends_with(".lock"));
    if invalid {
        return Err(AppError::InvalidInput(format!(
            "invalid branch name: {name}"
        )));
    }
    Ok(name)
}

/// Turns a refused ref update into an error carrying the server's reason.
pub(super) fn require_ref_update(action: &str, result: GitRefUpdateResult) -> Result<()> {
    if result.success {
        return Ok(());
    }
    let reason = result
        .custom_message
        .or(result.update_status)
        .unwrap_or_else(|| "the update was rejected".to_string());
    Err(AppError::AzureDevOps(format!(
        "could not {action}: {reason}"
    )))
}

fn build_overview(
    stats: Vec<GitBranchStats>,
    pull_requests: Vec<GitPullRequest>,
) -> Vec<BranchOverviewItem> {
    let mut prs_by_branch: HashMap<String, Vec<BranchPullRequest>> = HashMap::new();
    for pr in pull_requests {
        prs_by_branch
            .entry(strip_heads_prefix(&pr.source_ref_name).to_string())
            .or_default()
            .push(BranchPullRequest {
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                is_draft: pr.is_draft.unwrap_or(false),
            });
    }

    let mut items: Vec<BranchOverviewItem> = stats
        .into_iter()
        .map(|branch| {
            let last_date = branch.tip_date();
            let commit = branch.commit.as_ref();
            BranchOverviewItem {
                is_default: branch.is_base_version,
                ahead: branch.ahead_count,
                behind: branch.behind_count,
                last_commit_id: commit.map(|c| c.commit_id.clone()),
                last_author: commit.and_then(|c| {
                    c.committer
                        .as_ref()
                        .or(c.author.as_ref())
                        .and_then(|user| user.name.clone())
                }),
                last_date,
                last_comment: commit
                    .and_then(|c| c.comment.as_deref())
                    .and_then(|comment| comment.lines().next())
                    .map(str::to_string),
                pull_requests: prs_by_branch.remove(&branch.name).unwrap_or_default(),
                name: branch.name,
            }
        })
        .collect();
    // Default branch first, then the most recently updated.
    items.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then(b.last_date.cmp(&a.last_date))
            .then(a.name.cmp(&b.name))
    });
    items
}

impl CodeBrowseService {
    /// Creates `refs/heads/{name}` at `source_commit_id` (issue #536).
    pub async fn create_branch(&self, input: CreateBranchInput) -> Result<()> {
        let name = validate_branch_name(&input.name)?;
        if input.source_commit_id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "a source commit is required".to_string(),
            ));
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let result = client
            .update_ref(
                &input.project,
                &input.repository,
                &format!("refs/heads/{name}"),
                ZERO_OBJECT_ID,
                input.source_commit_id.trim(),
            )
            .await?;
        require_ref_update("create the branch", result)
    }

    /// Deletes `refs/heads/{name}` if it still points at `commit_id` (issue #536).
    pub async fn delete_branch(&self, input: DeleteBranchInput) -> Result<()> {
        let name = validate_branch_name(&input.name)?;
        if input.commit_id.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "the branch tip commit is required".to_string(),
            ));
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let result = client
            .update_ref(
                &input.project,
                &input.repository,
                &format!("refs/heads/{name}"),
                input.commit_id.trim(),
                ZERO_OBJECT_ID,
            )
            .await?;
        require_ref_update("delete the branch", result)
    }

    pub async fn list_branch_overview(
        &self,
        input: ListBranchesInput,
    ) -> Result<Vec<BranchOverviewItem>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (stats, pull_requests) = tokio::try_join!(
            client.list_branch_stats(&input.project, &input.repository),
            client.list_pull_requests(&input.project, &input.repository, PullRequestStatus::Active),
        )?;
        Ok(build_overview(stats, pull_requests))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(json: serde_json::Value) -> GitBranchStats {
        serde_json::from_value(json).unwrap()
    }

    fn pull_request(id: i64, source: &str, draft: Option<bool>) -> GitPullRequest {
        serde_json::from_value(serde_json::json!({
            "pullRequestId": id,
            "title": format!("PR {id}"),
            "status": "active",
            "creationDate": "2026-06-01T00:00:00Z",
            "sourceRefName": source,
            "targetRefName": "refs/heads/main",
            "isDraft": draft,
        }))
        .unwrap()
    }

    #[test]
    fn branch_names_follow_git_ref_rules() {
        for ok in [
            "main",
            "feature/x",
            "release/1.2.3",
            "user/ann/fix-1",
            "a.b",
        ] {
            assert!(validate_branch_name(ok).is_ok(), "{ok}");
        }
        assert_eq!(validate_branch_name("  topic  ").unwrap(), "topic");
        for bad in [
            "",
            "  ",
            "/x",
            "x/",
            "-x",
            ".x",
            "x.",
            "x.lock",
            "a..b",
            "a//b",
            "a b",
            "a~b",
            "a^b",
            "a:b",
            "a?b",
            "a*b",
            "a[b",
            "a\\b",
            "a@{b",
            "@",
            "feature/.hidden",
            "feature/x.lock/y",
        ] {
            assert!(validate_branch_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_refused_update_becomes_an_error_with_the_reason() {
        let ok = GitRefUpdateResult {
            success: true,
            update_status: None,
            custom_message: None,
        };
        assert!(require_ref_update("create the branch", ok).is_ok());
        let refused = GitRefUpdateResult {
            success: false,
            update_status: Some("staleOldObjectId".to_string()),
            custom_message: None,
        };
        let message = require_ref_update("delete the branch", refused)
            .unwrap_err()
            .to_string();
        assert!(message.contains("delete the branch"));
        assert!(message.contains("staleOldObjectId"));
    }

    #[test]
    fn overview_puts_default_first_then_newest_and_attaches_active_prs() {
        let items = build_overview(
            vec![
                stats(serde_json::json!({
                    "name": "old", "aheadCount": 1, "behindCount": 9,
                    "commit": { "commitId": "c1", "comment": "Old work\nbody",
                        "author": { "name": "Ann", "date": "2026-01-01T00:00:00Z" } }
                })),
                stats(serde_json::json!({
                    "name": "main", "isBaseVersion": true,
                    "commit": { "commitId": "c0", "comment": "Release",
                        "committer": { "name": "Bot", "date": "2025-12-01T00:00:00Z" } }
                })),
                stats(serde_json::json!({
                    "name": "fresh", "aheadCount": 2,
                    "commit": { "commitId": "c2", "comment": "New work",
                        "committer": { "name": "Bob", "date": "2026-06-01T00:00:00Z" } }
                })),
            ],
            vec![
                pull_request(7, "refs/heads/fresh", Some(true)),
                pull_request(8, "refs/heads/fresh", None),
            ],
        );

        let names: Vec<_> = items.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, ["main", "fresh", "old"]);
        assert!(items[0].is_default);
        assert_eq!((items[2].ahead, items[2].behind), (1, 9));
        assert_eq!(items[2].last_comment.as_deref(), Some("Old work"));
        assert_eq!(items[2].last_author.as_deref(), Some("Ann"));
        let fresh_prs: Vec<_> = items[1]
            .pull_requests
            .iter()
            .map(|pr| (pr.pull_request_id, pr.is_draft))
            .collect();
        assert_eq!(fresh_prs, [(7, true), (8, false)]);
        assert!(items[2].pull_requests.is_empty());
    }
}
