use chrono::{DateTime, Utc};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse<T> {
    pub value: Vec<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    pub id: String,
    pub name: String,
    pub project: Option<TeamProject>,
    /// Fully-qualified default branch ref, e.g. `refs/heads/main`. Absent on
    /// some response shapes, so kept optional.
    #[serde(default)]
    pub default_branch: Option<String>,
}

/// A Git ref (branch/tag) as returned by the refs API.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// Fully-qualified ref name, e.g. `refs/heads/main`.
    pub name: String,
    pub object_id: Option<String>,
}

/// A file or folder entry in a repository tree.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitItem {
    pub path: String,
    #[serde(default)]
    pub is_folder: bool,
    /// The latest commit touching this item. Only populated when the items
    /// request asks for it (`latestProcessedChange=true`).
    #[serde(default)]
    pub latest_processed_change: Option<GitCommitRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequest {
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub creation_date: DateTime<Utc>,
    /// Set when the PR is completed/abandoned; the date a PR actually merged.
    #[serde(default)]
    pub closed_date: Option<DateTime<Utc>>,
    pub created_by: Option<IdentityRef>,
    pub repository: Option<GitRepository>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub url: Option<String>,
    #[serde(rename = "_links")]
    pub links: Option<PullRequestLinks>,
    pub reviewers: Option<Vec<IdentityRefWithVote>>,
    pub is_draft: Option<bool>,
    pub merge_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    pub commit_id: String,
    pub comment: Option<String>,
    pub author: Option<GitUserDate>,
    pub committer: Option<GitUserDate>,
    pub remote_url: Option<String>,
    pub url: Option<String>,
    /// Parent commit ids; present on the single-commit endpoint, absent on the
    /// commit list endpoint.
    #[serde(default)]
    pub parents: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUserDate {
    pub name: Option<String>,
    pub email: Option<String>,
    pub date: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRefWithVote {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
    pub vote: i32,
    #[serde(default)]
    pub is_required: bool,
    /// For a group/team reviewer, the rolled-up votes of its members. A member
    /// who voted via the group appears here even though they are not a direct
    /// reviewer entry.
    #[serde(default)]
    pub voted_for: Option<Vec<IdentityRefWithVote>>,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestLinks {
    pub web: Option<LinkRef>,
}

#[derive(Debug, Deserialize)]
pub struct LinkRef {
    pub href: String,
}

#[derive(Debug, Clone, Default)]
pub struct CommitSearchCriteria {
    pub author: Option<String>,
    pub branch: Option<String>,
    /// Server-relative path (e.g. `/src/auth`) to restrict the search to
    /// commits that changed files under it. Maps to `searchCriteria.itemPath`.
    pub item_path: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub top: Option<u32>,
    pub skip: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullRequestStatus {
    Active,
    Completed,
    Abandoned,
    All,
}

impl PullRequestStatus {
    pub fn as_query_value(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Abandoned => "abandoned",
            Self::All => "all",
        }
    }
}
