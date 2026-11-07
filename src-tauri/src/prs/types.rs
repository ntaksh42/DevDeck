use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyReviewPullRequestsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub my_is_required: bool,
    pub is_draft: bool,
    pub merge_status: Option<String>,
    pub ci_status: Option<String>,
    pub ci_context: Option<String>,
    pub ci_check_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyCreatedPullRequestsInput {
    pub organization_id: Option<String>,
}

// Summary for PRs the authenticated user authored. Unlike a review summary the
// user's own vote is meaningless here, so it carries an approvals aggregate
// (how many reviewers approved) instead of a personal vote.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyCreatedPullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub is_draft: bool,
    pub approvals: i64,
    pub reviewer_count: i64,
    pub ready_to_merge: bool,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MyCreatedPullRequestsResult {
    pub pull_requests: Vec<MyCreatedPullRequestSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestsInput {
    pub progressive: Option<bool>,
    pub search_id: Option<String>,
    pub continuation_token: Option<String>,
    pub retry_failed: Option<bool>,
    pub author_id: Option<String>,
    pub reviewer_id: Option<String>,
    pub exclude_words: Option<String>,
    pub organization_id: Option<String>,
    pub query: Option<String>,
    /// Statuses to include. Empty/omitted defaults to active (cached) only.
    pub statuses: Option<Vec<String>>,
    /// Projects to include. Empty/omitted means all projects.
    pub project_ids: Option<Vec<String>>,
    /// Repositories to include. Empty/omitted means all repositories.
    pub repository_ids: Option<Vec<String>>,
    /// Target branches to filter by, e.g. `main` or `refs/heads/main`.
    pub target_branches: Option<Vec<String>>,
    /// Inclusive date window (`YYYY-MM-DD`) interpreted against `date_basis`.
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    /// `created` (default) or `closed`: which date the window applies to.
    pub date_basis: Option<String>,
    pub exclude_drafts: Option<bool>,
    /// `created` (default), `closed`, or `title`.
    pub sort_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub closed_date: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub is_draft: bool,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSearchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanned_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_scopes: Option<Vec<String>>,
    pub pull_requests: Vec<PullRequestSummary>,
    /// Total matches before the display cap, so the UI can show "100+".
    pub total: usize,
    pub truncated: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPullRequestSearchInput {
    pub organization_id: Option<String>,
    pub search_id: String,
}
