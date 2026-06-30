//! Provider abstraction. A single active connection (chosen in Settings)
//! determines one `Provider` that the command layer talks to, so the UI never
//! has to know whether it is talking to Azure DevOps or GitHub. The concrete
//! provider is swapped when the active connection changes.
//!
//! Operations that only one platform supports are still declared here; the
//! provider that lacks them returns `AppError::NotSupported`, and the
//! `capabilities()` map lets the UI hide the corresponding affordances up front
//! so a `NotSupported` error is never actually hit during normal use.

mod azdo;
mod github;

pub(crate) use azdo::AzdoProvider;
pub(crate) use github::GithubProvider;

use async_trait::async_trait;
use serde::Serialize;

use crate::code_browse::{
    GetFileBinaryInput, GetFileInput, ListBranchesInput, ListHistoryInput, ListTreeInput,
    RepoBranch, RepoCommitInfo, RepoFile, RepoFileBinary, RepoTreeItem,
};
use crate::code_search::{
    CodeContextResult, CodeSearchResults, GetCodeContextInput, SearchCodeInput,
};
use crate::commits::{
    CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitFileDiff, CommitPullRequest,
    CommitRepositoryOption, CommitSearchResult, GetCommitChangesInput, GetCommitFileDiffInput,
    GetCommitPullRequestsInput, ListCommitRepositoriesInput, SearchCommitsInput,
};
use crate::error::Result;
use crate::pipelines::{
    CancelPipelineRunInput, GetPipelineDefinitionInput, GetPipelineRunInput,
    GetPipelineRunLogTailInput, ListPipelineApprovalsInput, ListPipelineArtifactsInput,
    ListPipelineDefinitionsInput, ListPipelineProjectsInput, ListPipelineRunsInput,
    PipelineApprovalSummary, PipelineArtifact, PipelineDefinitionDetail, PipelineDefinitionOption,
    PipelineLogTail, PipelineProjectOption, PipelineRunDetail, PipelineRunSummary,
    QueuePipelineRunInput, RerunPipelineRunInput, UpdatePipelineApprovalInput,
};
use crate::pr_review::{
    DeletePullRequestCommentInput, EditPullRequestCommentInput, GetPullRequestFileDiffInput,
    PostPullRequestCommentInput, PrCommit, PrDetailsResult, PrFileDiff, PrLocator, PrReviewer,
    PrStatusResult, PrThread, PullRequestChanges, PullRequestReview,
    RemovePullRequestReviewerInput, SearchPullRequestMentionsInput,
    SetPullRequestReviewerRequiredInput, SetPullRequestThreadStatusInput,
    SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput, UpdatePullRequestInput,
};
use crate::prs::{
    ListMyCreatedPullRequestsInput, ListMyReviewPullRequestsInput, MyCreatedPullRequestSummary,
    PullRequestSearchResult, ReviewPullRequestSummary, SearchPullRequestsInput,
};
use crate::work_items::{
    AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult, DeleteWorkItemCommentInput,
    GetWorkItemPreviewInput, ListMyWorkItemsInput, ListWorkItemProjectsInput,
    ListWorkItemUpdatesInput, MentionCandidate, SearchWorkItemAssigneesInput,
    SearchWorkItemMentionsInput, SearchWorkItemsInput, SetWorkItemsPriorityInput,
    SetWorkItemsStateInput, SetWorkItemsTagsInput, UpdateWorkItemCommentInput,
    WorkItemAssigneeCandidate, WorkItemComment, WorkItemPreview, WorkItemProjectOption,
    WorkItemSummary, WorkItemUpdateSummary,
};

/// Which optional features the active provider supports. Serialized to the
/// frontend so provider-specific UI (e.g. Pipelines, work-item priority) can be
/// hidden when the active connection cannot serve it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    /// Stable identifier of the platform: "azdo" | "github".
    #[serde(skip)]
    pub kind: &'static str,
    pub pull_requests: bool,
    pub pull_request_review: bool,
    pub work_items: bool,
    pub commits: bool,
    pub code_search: bool,
    pub code_browse: bool,
    pub pipelines: bool,
    /// Work-item priority field (Azure DevOps only).
    pub work_item_priority: bool,
    /// Resolving inline review threads (GitHub: via GraphQL; Azure DevOps: yes).
    pub resolve_review_threads: bool,
}

/// The platform name exposed to the frontend, derived from `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub kind: String,
    pub capabilities: ProviderCapabilities,
}

/// Domain operations the command layer invokes, independent of platform.
#[async_trait]
pub(crate) trait Provider: Send + Sync {
    fn capabilities(&self) -> ProviderCapabilities;

    // --- Pull requests ---
    async fn search_pull_requests(
        &self,
        input: SearchPullRequestsInput,
    ) -> Result<PullRequestSearchResult>;
    async fn list_my_created_pull_requests(
        &self,
        input: ListMyCreatedPullRequestsInput,
    ) -> Result<Vec<MyCreatedPullRequestSummary>>;
    async fn list_my_review_pull_requests(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>>;

    // --- Work items (GitHub: issues) ---
    async fn search_work_items(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>>;
    async fn list_my_work_items(&self, input: ListMyWorkItemsInput)
        -> Result<Vec<WorkItemSummary>>;
    async fn list_work_item_projects(
        &self,
        input: ListWorkItemProjectsInput,
    ) -> Result<Vec<WorkItemProjectOption>>;
    async fn get_work_item_preview(
        &self,
        input: GetWorkItemPreviewInput,
    ) -> Result<WorkItemPreview>;
    async fn list_work_item_updates(
        &self,
        input: ListWorkItemUpdatesInput,
    ) -> Result<Vec<WorkItemUpdateSummary>>;
    async fn add_work_item_comment(
        &self,
        input: AddWorkItemCommentInput,
    ) -> Result<WorkItemComment>;
    async fn update_work_item_comment(
        &self,
        input: UpdateWorkItemCommentInput,
    ) -> Result<WorkItemComment>;
    async fn delete_work_item_comment(&self, input: DeleteWorkItemCommentInput) -> Result<()>;
    async fn set_work_items_state(
        &self,
        input: SetWorkItemsStateInput,
    ) -> Result<Vec<BulkWorkItemResult>>;
    async fn assign_work_items(
        &self,
        input: AssignWorkItemsInput,
    ) -> Result<Vec<BulkWorkItemResult>>;
    async fn set_work_items_tags(
        &self,
        input: SetWorkItemsTagsInput,
    ) -> Result<Vec<BulkWorkItemResult>>;
    async fn set_work_items_priority(
        &self,
        input: SetWorkItemsPriorityInput,
    ) -> Result<Vec<BulkWorkItemResult>>;
    async fn search_work_item_mentions(
        &self,
        input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>>;
    async fn search_work_item_assignees(
        &self,
        input: SearchWorkItemAssigneesInput,
    ) -> Result<Vec<WorkItemAssigneeCandidate>>;

    // --- Commits ---
    async fn search_commits(&self, input: SearchCommitsInput) -> Result<CommitSearchResult>;
    async fn list_commit_repositories(
        &self,
        input: ListCommitRepositoriesInput,
    ) -> Result<Vec<CommitRepositoryOption>>;
    async fn commit_activity(&self, input: CommitActivityInput) -> Result<Vec<CommitActivityDay>>;
    async fn get_commit_changes(&self, input: GetCommitChangesInput) -> Result<CommitChangeSet>;
    async fn get_commit_file_diff(&self, input: GetCommitFileDiffInput) -> Result<CommitFileDiff>;
    async fn get_commit_pull_requests(
        &self,
        input: GetCommitPullRequestsInput,
    ) -> Result<Vec<CommitPullRequest>>;

    // --- Pull request review ---
    async fn get_pull_request_review(&self, input: PrLocator) -> Result<PullRequestReview>;
    async fn list_pull_request_changes(&self, input: PrLocator) -> Result<PullRequestChanges>;
    async fn get_pull_request_file_diff(
        &self,
        input: GetPullRequestFileDiffInput,
    ) -> Result<PrFileDiff>;
    async fn list_pull_request_commits(&self, input: PrLocator) -> Result<Vec<PrCommit>>;
    async fn post_pull_request_comment(
        &self,
        input: PostPullRequestCommentInput,
    ) -> Result<PrThread>;
    async fn set_pull_request_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread>;
    async fn submit_pull_request_vote(
        &self,
        input: SubmitPullRequestVoteInput,
    ) -> Result<PrReviewer>;
    async fn update_pull_request(&self, input: UpdatePullRequestInput) -> Result<PrStatusResult>;
    async fn set_pull_request_reviewer_required(
        &self,
        input: SetPullRequestReviewerRequiredInput,
    ) -> Result<()>;
    async fn remove_pull_request_reviewer(
        &self,
        input: RemovePullRequestReviewerInput,
    ) -> Result<()>;
    async fn update_pull_request_details(
        &self,
        input: UpdatePullRequestDetailsInput,
    ) -> Result<PrDetailsResult>;
    async fn search_pull_request_mentions(
        &self,
        input: SearchPullRequestMentionsInput,
    ) -> Result<Vec<MentionCandidate>>;
    async fn edit_pull_request_comment(
        &self,
        input: EditPullRequestCommentInput,
    ) -> Result<PrThread>;
    async fn delete_pull_request_comment(&self, input: DeletePullRequestCommentInput)
        -> Result<()>;

    // --- Code search & browse ---
    async fn search_code(&self, input: SearchCodeInput) -> Result<CodeSearchResults>;
    async fn get_code_search_context(
        &self,
        input: GetCodeContextInput,
    ) -> Result<CodeContextResult>;
    async fn list_repo_branches(&self, input: ListBranchesInput) -> Result<Vec<RepoBranch>>;
    async fn list_repo_tree(&self, input: ListTreeInput) -> Result<Vec<RepoTreeItem>>;
    async fn get_repo_file(&self, input: GetFileInput) -> Result<RepoFile>;
    async fn get_repo_file_binary(&self, input: GetFileBinaryInput) -> Result<RepoFileBinary>;
    async fn list_repo_history(&self, input: ListHistoryInput) -> Result<Vec<RepoCommitInfo>>;

    // --- Pipelines (GitHub: not supported) ---
    async fn list_pipeline_projects(
        &self,
        input: ListPipelineProjectsInput,
    ) -> Result<Vec<PipelineProjectOption>>;
    async fn list_pipeline_runs(
        &self,
        input: ListPipelineRunsInput,
    ) -> Result<Vec<PipelineRunSummary>>;
    async fn list_pipeline_definitions(
        &self,
        input: ListPipelineDefinitionsInput,
    ) -> Result<Vec<PipelineDefinitionOption>>;
    async fn get_pipeline_run(&self, input: GetPipelineRunInput) -> Result<PipelineRunDetail>;
    async fn list_pipeline_artifacts(
        &self,
        input: ListPipelineArtifactsInput,
    ) -> Result<Vec<PipelineArtifact>>;
    async fn get_pipeline_definition(
        &self,
        input: GetPipelineDefinitionInput,
    ) -> Result<PipelineDefinitionDetail>;
    async fn get_pipeline_run_log_tail(
        &self,
        input: GetPipelineRunLogTailInput,
    ) -> Result<PipelineLogTail>;
    async fn rerun_pipeline_run(&self, input: RerunPipelineRunInput) -> Result<PipelineRunSummary>;
    async fn queue_pipeline_run(&self, input: QueuePipelineRunInput) -> Result<PipelineRunSummary>;
    async fn cancel_pipeline_run(
        &self,
        input: CancelPipelineRunInput,
    ) -> Result<PipelineRunSummary>;
    async fn list_pipeline_approvals(
        &self,
        input: ListPipelineApprovalsInput,
    ) -> Result<Vec<PipelineApprovalSummary>>;
    async fn update_pipeline_approval(
        &self,
        input: UpdatePipelineApprovalInput,
    ) -> Result<Vec<PipelineApprovalSummary>>;

    // --- Cross-kind command palette search ---
    async fn search_all(
        &self,
        input: crate::search::SearchAllInput,
    ) -> Result<crate::search::SearchAllResult>;
}
