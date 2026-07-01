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
    pub parent_commit_id: Option<String>,
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

/// Input for the commit graph view: parent ids for a bounded batch of
/// commits, all from the same repository (a DAG spanning repositories would
/// not be meaningful).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitParentsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub commit_ids: Vec<String>,
}

/// A commit's parent ids, used to lay out the commit graph. A commit whose
/// parents could not be resolved (lookup failure, or simply not requested) is
/// omitted from the response rather than represented with an empty list, so
/// the frontend can tell "no parents" (root commit) apart from "unknown".
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitParents {
    pub commit_id: String,
    pub parent_ids: Vec<String>,
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
