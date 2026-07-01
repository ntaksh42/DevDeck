use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCommitsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub author: Option<String>,
    pub branch: Option<String>,
    pub item_path: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    /// Projects to include. Empty/omitted means all projects.
    pub project_ids: Option<Vec<String>>,
    /// Repositories to include. Empty/omitted means all repositories.
    pub repository_ids: Option<Vec<String>>,
    /// Offset into the sorted result set for "Load more" pagination.
    /// When omitted or 0 the first page is returned.
    pub offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCommitRepositoriesInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityInput {
    pub organization_id: Option<String>,
    pub author: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityDay {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRepositoryOption {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub author_date: Option<String>,
    pub web_url: Option<String>,
}

/// Result of a commit search. `total` is the match count before the display
/// cap; `truncated` is true when more matches existed than were returned, so
/// the UI can show "Showing N of total" instead of silently dropping rows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSearchResult {
    pub commits: Vec<CommitSummary>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitChangesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub commit_id: String,
    /// Parent commit to diff against, for merge commits with more than one
    /// parent. `None` uses the provider's default parent. Azure DevOps honors
    /// this for any parent; GitHub only exposes the default parent's changes
    /// (see `github::commits::get_commit_changes`).
    pub base_commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitFileDiffInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub file_path: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub commit_id: String,
    pub parent_commit_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangedFile {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangeSet {
    pub commit_id: String,
    /// All parent commit ids, in the provider's order (first parent first).
    /// More than one entry means this is a merge commit.
    pub parents: Vec<String>,
    pub files: Vec<CommitChangedFile>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDiff {
    pub file_path: String,
    pub base_content: Option<String>,
    pub target_content: Option<String>,
    pub base_unavailable_reason: Option<String>,
    pub target_unavailable_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitPullRequestsInput {
    pub organization_id: Option<String>,
    pub repository_id: String,
    pub commit_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPullRequest {
    pub pull_request_id: i64,
    pub repository_id: String,
    pub title: String,
    pub status: String,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub web_url: Option<String>,
}

/// Shared shape for [`CherryPickCommitInput`] and [`RevertCommitInput`]: both
/// name a single source commit, the branch to apply it onto, and a proposed
/// name for the new branch Azure DevOps creates. `project_name`/
/// `repository_name` are passed through from the already-loaded
/// [`CommitSummary`] on the frontend so building the result's web URL does not
/// need an extra lookup.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickCommitInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    /// Target branch to cherry-pick onto (short name, e.g. `main`).
    pub onto_branch: String,
    /// Proposed name for the new branch (short name, e.g. `cherry-pick/abc1234`).
    pub new_branch_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertCommitInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    /// Target branch to revert onto (short name, e.g. `main`).
    pub onto_branch: String,
    /// Proposed name for the new branch (short name, e.g. `revert/abc1234`).
    pub new_branch_name: String,
}

/// Outcome of a cherry-pick or revert. Azure DevOps runs the operation
/// server-side and this is only known for certain once `status` is
/// `"completed"` (branch created, `new_branch_web_url` populated) or
/// `"failed"`/`"abandoned"` (`failure_message` explains why, no branch was
/// created). `"queued"`/`"inProgress"` means the client's poll budget ran out
/// before Azure DevOps finished — the operation may still complete later, so
/// this is reported to the UI rather than treated as an error.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRefOperationResult {
    pub status: String,
    pub new_branch_name: String,
    pub new_branch_web_url: Option<String>,
    pub conflict: bool,
    pub failure_message: Option<String>,
}
