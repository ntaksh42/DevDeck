use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::git::{IdentityRef, IdentityRefWithVote, WebApiTagDefinition};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequestDetail {
    pub pull_request_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub created_by: Option<IdentityRef>,
    pub creation_date: Option<DateTime<Utc>>,
    pub reviewers: Option<Vec<IdentityRefWithVote>>,
    pub is_draft: Option<bool>,
    pub status: Option<String>,
    /// Set when auto-complete is enabled (the identity that turned it on).
    pub auto_complete_set_by: Option<IdentityRef>,
    /// Tip of the source branch; required when completing a PR to guard against
    /// merging a stale revision.
    pub last_merge_source_commit: Option<GitCommitRefId>,
    /// Labels (tags) on the pull request (issue #386). Absent on older
    /// responses, so this defaults to empty rather than failing to deserialize.
    #[serde(default)]
    pub labels: Vec<WebApiTagDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThread {
    pub id: i64,
    pub status: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
    pub comments: Option<Vec<GitThreadComment>>,
    pub thread_context: Option<GitThreadContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThreadComment {
    pub id: i64,
    pub parent_comment_id: Option<i64>,
    pub content: Option<String>,
    pub comment_type: Option<String>,
    pub author: Option<IdentityRef>,
    pub published_date: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitThreadContext {
    pub file_path: Option<String>,
    pub right_file_start: Option<GitFilePosition>,
    pub left_file_start: Option<GitFilePosition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFilePosition {
    pub line: i64,
}

/// Anchor for a new file-scoped thread. Set `right_line` to anchor on the
/// target (new) side of the diff, `left_line` to anchor on the base (old) side.
#[derive(Debug, Clone)]
pub struct NewThreadContext {
    pub file_path: String,
    pub right_line: Option<i64>,
    pub left_line: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIteration {
    pub id: i64,
    pub source_ref_commit: Option<GitCommitRefId>,
    pub common_ref_commit: Option<GitCommitRefId>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRefId {
    pub commit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIterationChanges {
    #[serde(default)]
    pub change_entries: Vec<GitChangeEntry>,
    /// Continuation cursor when the change set spans multiple pages.
    pub next_skip: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeEntry {
    pub change_type: Option<String>,
    pub item: Option<GitChangeItem>,
    /// Pre-rename path when the change is a rename.
    pub source_server_item: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeItem {
    pub path: Option<String>,
    pub is_folder: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitItemContent {
    pub content: Option<String>,
    pub content_metadata: Option<GitContentMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContentMetadata {
    pub is_binary: Option<bool>,
}
