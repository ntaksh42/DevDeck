//! Files > Branches: every branch with its tip commit, ahead/behind counts
//! against the default branch, and the active pull requests it is the source of.

use std::collections::HashMap;

use azdo_client::{GitBranchStats, GitPullRequest, PullRequestStatus};
use chrono::{DateTime, Utc};
use serde::Serialize;

use super::util::strip_heads_prefix;
use super::{CodeBrowseService, ListBranchesInput};
use crate::auth::client_for_organization;
use crate::error::Result;

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
