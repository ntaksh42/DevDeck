use serde::{Deserialize, Serialize};

use crate::db::AppDatabase;
use crate::secrets::SecretStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrLocator {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub pull_request_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPullRequestFileDiffInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub file_path: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub base_commit_id: Option<String>,
    pub target_commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    /// None creates a new thread; Some replies to an existing thread.
    pub thread_id: Option<i64>,
    pub content: String,
    /// File + line anchor for a new inline thread. `right_line` targets the new
    /// side of the diff, `left_line` the old side; at most one is set.
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
    pub left_line: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPullRequestThreadStatusInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    /// "active" | "closed"
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPullRequestVoteInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub vote: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePullRequestInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    /// "abandon" | "reactivate" | "publish" | "complete"
    pub action: String,
    /// Required for "complete": noFastForward | squash | rebase | rebaseMerge
    pub merge_strategy: Option<String>,
    pub delete_source_branch: Option<bool>,
    /// When completing, transition linked work items to their next state.
    pub transition_work_items: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPullRequestReviewerRequiredInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub reviewer_id: String,
    pub is_required: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovePullRequestReviewerInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub reviewer_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePullRequestDetailsInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailsResult {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusResult {
    pub status: Option<String>,
    pub is_draft: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestMentionsInput {
    pub organization_id: Option<String>,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    pub comment_id: i64,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    pub comment_id: i64,
}

/// Adds a label to a pull request by name (issue #386).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPullRequestLabelInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub name: String,
}

/// Removes a label from a pull request by its id (issue #386).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovePullRequestLabelInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub label_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReview {
    pub pull_request_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub created_by: Option<String>,
    pub creation_date: Option<String>,
    pub is_draft: bool,
    pub auto_complete: bool,
    pub reviewers: Vec<PrReviewer>,
    pub labels: Vec<PrLabel>,
    pub threads: Vec<PrThread>,
}

/// A pull request label (tag), issue #386.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrLabel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewer {
    /// Azure DevOps identity id, used to target reviewer mutations.
    pub id: Option<String>,
    pub display_name: String,
    pub vote: i32,
    pub vote_label: String,
    pub is_required: bool,
    pub is_me: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrThread {
    pub id: i64,
    pub status: Option<String>,
    pub is_resolved: bool,
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
    pub left_line: Option<i64>,
    pub comments: Vec<PrComment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: i64,
    pub parent_comment_id: Option<i64>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub is_system: bool,
    pub is_mine: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChanges {
    pub base_commit_id: Option<String>,
    pub target_commit_id: Option<String>,
    pub files: Vec<PrChangedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrChangedFile {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileDiff {
    pub file_path: String,
    pub base_content: Option<String>,
    pub target_content: Option<String>,
    pub base_unavailable_reason: Option<String>,
    pub target_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PrReviewService {
    pub(super) db: AppDatabase,
    pub(super) secrets: SecretStore,
}

impl PrReviewService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }
}
