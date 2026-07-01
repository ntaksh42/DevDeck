//! GitHub provider. Maps GitHub REST/GraphQL responses onto the shared domain
//! DTOs via the `crate::github` modules. Operations GitHub does not support
//! return `AppError::NotSupported`; `capabilities()` advertises what works so
//! the UI hides the rest.

use async_trait::async_trait;

use crate::code_browse::{
    CreateBranchInput, DeleteBranchInput, GetFileInput, ListBranchesInput, ListHistoryInput,
    ListTreeInput, RepoBranch, RepoCommitInfo, RepoFile, RepoTreeItem,
};
use crate::code_search::{
    CodeContextResult, CodeSearchResults, GetCodeContextInput, SearchCodeInput,
};
use crate::commits::{
    CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitFileDiff, CommitPullRequest,
    CommitRepositoryOption, CommitSearchResult, GetCommitChangesInput, GetCommitFileDiffInput,
    GetCommitPullRequestsInput, ListCommitRepositoriesInput, SearchCommitsInput,
};
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::github;
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
use crate::search::{SearchAllInput, SearchAllResult, SearchAllTotals};
use crate::secrets::SecretStore;
use crate::work_items::{
    AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult, DeleteWorkItemCommentInput,
    GetWorkItemPreviewInput, ListMyWorkItemsInput, ListWorkItemProjectsInput,
    ListWorkItemUpdatesInput, MentionCandidate, SearchWorkItemAssigneesInput,
    SearchWorkItemMentionsInput, SearchWorkItemsInput, SetWorkItemsPriorityInput,
    SetWorkItemsStateInput, SetWorkItemsTagsInput, UpdateWorkItemCommentInput,
    WorkItemAssigneeCandidate, WorkItemComment, WorkItemPreview, WorkItemProjectOption,
    WorkItemSummary, WorkItemUpdateSummary,
};

use super::{Provider, ProviderCapabilities};

/// Upper bound for GitHub PR search result sets.
const PR_RESULT_LIMIT: u32 = 100;

pub(crate) struct GithubProvider {
    org: Organization,
    secrets: SecretStore,
}

impl GithubProvider {
    pub(crate) fn new(org: Organization, secrets: SecretStore) -> Self {
        Self { org, secrets }
    }
}

#[async_trait]
impl Provider for GithubProvider {
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            kind: "github",
            pull_requests: true,
            pull_request_review: true,
            work_items: true,
            commits: true,
            code_search: true,
            code_browse: false,
            pipelines: false,
            work_item_priority: false,
            resolve_review_threads: true,
        }
    }

    async fn search_pull_requests(
        &self,
        input: SearchPullRequestsInput,
    ) -> Result<PullRequestSearchResult> {
        let active_only = input
            .statuses
            .as_ref()
            .map(|s| s.is_empty() || s.iter().all(|s| s.eq_ignore_ascii_case("active")))
            .unwrap_or(true);
        let query = input.query.unwrap_or_default();
        let mut results = github::prs::search_pull_requests(
            &self.org,
            &self.secrets,
            &query,
            active_only,
            PR_RESULT_LIMIT,
        )
        .await?;
        if input.exclude_drafts.unwrap_or(false) {
            results.retain(|pr| !pr.is_draft);
        }
        let total = results.len();
        Ok(PullRequestSearchResult {
            pull_requests: results,
            total,
            truncated: false,
        })
    }

    async fn list_my_created_pull_requests(
        &self,
        _input: ListMyCreatedPullRequestsInput,
    ) -> Result<Vec<MyCreatedPullRequestSummary>> {
        github::prs::list_my_created_pull_requests(&self.org, &self.secrets).await
    }

    async fn list_my_review_pull_requests(
        &self,
        _input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        github::prs::list_my_reviews(&self.org, &self.secrets).await
    }

    async fn search_work_items(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let query = input.query.unwrap_or_default();
        github::work_items::search(&self.org, &self.secrets, &query).await
    }

    async fn list_my_work_items(
        &self,
        _input: ListMyWorkItemsInput,
    ) -> Result<Vec<WorkItemSummary>> {
        github::work_items::list_my(&self.org, &self.secrets).await
    }

    async fn list_work_item_projects(
        &self,
        _input: ListWorkItemProjectsInput,
    ) -> Result<Vec<WorkItemProjectOption>> {
        // GitHub issues are grouped by repository, not projects; no filter list.
        Ok(Vec::new())
    }

    async fn get_work_item_preview(
        &self,
        input: GetWorkItemPreviewInput,
    ) -> Result<WorkItemPreview> {
        github::work_items::get_preview(&self.org, &self.secrets, input).await
    }

    async fn list_work_item_updates(
        &self,
        _input: ListWorkItemUpdatesInput,
    ) -> Result<Vec<WorkItemUpdateSummary>> {
        // GitHub issue timelines are not mapped yet.
        Ok(Vec::new())
    }

    async fn add_work_item_comment(
        &self,
        input: AddWorkItemCommentInput,
    ) -> Result<WorkItemComment> {
        github::work_items::add_comment(&self.org, &self.secrets, input).await
    }

    async fn update_work_item_comment(
        &self,
        input: UpdateWorkItemCommentInput,
    ) -> Result<WorkItemComment> {
        github::work_items::update_comment(&self.org, &self.secrets, input).await
    }

    async fn delete_work_item_comment(&self, input: DeleteWorkItemCommentInput) -> Result<()> {
        github::work_items::delete_comment(&self.org, &self.secrets, input).await
    }

    async fn set_work_items_state(
        &self,
        input: SetWorkItemsStateInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        github::work_items::set_state(&self.org, &self.secrets, input).await
    }

    async fn assign_work_items(
        &self,
        input: AssignWorkItemsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        github::work_items::assign(&self.org, &self.secrets, input).await
    }

    async fn set_work_items_tags(
        &self,
        input: SetWorkItemsTagsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        github::work_items::set_tags(&self.org, &self.secrets, input).await
    }

    async fn set_work_items_priority(
        &self,
        _input: SetWorkItemsPriorityInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        Err(AppError::NotSupported(
            "GitHub issues have no priority field".to_string(),
        ))
    }

    async fn search_work_item_mentions(
        &self,
        _input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        Ok(Vec::new())
    }

    async fn search_work_item_assignees(
        &self,
        _input: SearchWorkItemAssigneesInput,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        Ok(Vec::new())
    }

    async fn search_commits(&self, input: SearchCommitsInput) -> Result<CommitSearchResult> {
        github::commits::search(&self.org, &self.secrets, &input).await
    }

    async fn list_commit_repositories(
        &self,
        _input: ListCommitRepositoriesInput,
    ) -> Result<Vec<CommitRepositoryOption>> {
        // The GitHub commit search spans all repositories; no pre-fetched list.
        Ok(Vec::new())
    }

    async fn commit_activity(&self, _input: CommitActivityInput) -> Result<Vec<CommitActivityDay>> {
        Ok(Vec::new())
    }

    async fn get_commit_changes(&self, input: GetCommitChangesInput) -> Result<CommitChangeSet> {
        github::commits::get_commit_changes(&self.org, &self.secrets, input).await
    }

    async fn get_commit_file_diff(&self, input: GetCommitFileDiffInput) -> Result<CommitFileDiff> {
        github::commits::get_commit_file_diff(&self.org, &self.secrets, input).await
    }

    async fn get_commit_pull_requests(
        &self,
        input: GetCommitPullRequestsInput,
    ) -> Result<Vec<CommitPullRequest>> {
        github::commits::get_commit_pull_requests(&self.org, &self.secrets, input).await
    }

    async fn get_pull_request_review(&self, input: PrLocator) -> Result<PullRequestReview> {
        github::pr_review::get_review(&self.org, &self.secrets, input).await
    }

    async fn list_pull_request_changes(&self, input: PrLocator) -> Result<PullRequestChanges> {
        github::pr_review::list_changes(&self.org, &self.secrets, input).await
    }

    async fn get_pull_request_file_diff(
        &self,
        input: GetPullRequestFileDiffInput,
    ) -> Result<PrFileDiff> {
        github::pr_review::get_file_diff(&self.org, &self.secrets, input).await
    }

    async fn list_pull_request_commits(&self, input: PrLocator) -> Result<Vec<PrCommit>> {
        github::pr_review::list_commits(&self.org, &self.secrets, input).await
    }

    async fn post_pull_request_comment(
        &self,
        input: PostPullRequestCommentInput,
    ) -> Result<PrThread> {
        github::pr_review::post_comment(&self.org, &self.secrets, input).await
    }

    async fn set_pull_request_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread> {
        github::pr_review::set_thread_status(&self.org, &self.secrets, input).await
    }

    async fn submit_pull_request_vote(
        &self,
        input: SubmitPullRequestVoteInput,
    ) -> Result<PrReviewer> {
        github::pr_review::submit_vote(&self.org, &self.secrets, input).await
    }

    async fn update_pull_request(&self, input: UpdatePullRequestInput) -> Result<PrStatusResult> {
        github::pr_review::update_pull_request(&self.org, &self.secrets, input).await
    }

    async fn set_pull_request_reviewer_required(
        &self,
        input: SetPullRequestReviewerRequiredInput,
    ) -> Result<()> {
        github::pr_review::set_reviewer_required(&self.org, &self.secrets, input).await
    }

    async fn remove_pull_request_reviewer(
        &self,
        input: RemovePullRequestReviewerInput,
    ) -> Result<()> {
        github::pr_review::remove_reviewer(&self.org, &self.secrets, input).await
    }

    async fn update_pull_request_details(
        &self,
        input: UpdatePullRequestDetailsInput,
    ) -> Result<PrDetailsResult> {
        github::pr_review::update_pull_request_details(&self.org, &self.secrets, input).await
    }

    async fn search_pull_request_mentions(
        &self,
        _input: SearchPullRequestMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        Ok(Vec::new())
    }

    async fn edit_pull_request_comment(
        &self,
        input: EditPullRequestCommentInput,
    ) -> Result<PrThread> {
        github::pr_review::edit_comment(&self.org, &self.secrets, input).await
    }

    async fn delete_pull_request_comment(
        &self,
        input: DeletePullRequestCommentInput,
    ) -> Result<()> {
        github::pr_review::delete_comment(&self.org, &self.secrets, input).await
    }

    async fn search_code(&self, input: SearchCodeInput) -> Result<CodeSearchResults> {
        github::code::search(&self.org, &self.secrets, &input).await
    }

    async fn get_code_search_context(
        &self,
        _input: GetCodeContextInput,
    ) -> Result<CodeContextResult> {
        Err(AppError::NotSupported(
            "code search context preview is not available for GitHub".to_string(),
        ))
    }

    async fn list_repo_branches(&self, _input: ListBranchesInput) -> Result<Vec<RepoBranch>> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn list_repo_tree(&self, _input: ListTreeInput) -> Result<Vec<RepoTreeItem>> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn get_repo_file(&self, _input: GetFileInput) -> Result<RepoFile> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn list_repo_history(&self, _input: ListHistoryInput) -> Result<Vec<RepoCommitInfo>> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn create_branch(&self, _input: CreateBranchInput) -> Result<RepoBranch> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn delete_branch(&self, _input: DeleteBranchInput) -> Result<()> {
        Err(AppError::NotSupported(
            "code browsing is not available for GitHub yet".to_string(),
        ))
    }

    async fn list_pipeline_projects(
        &self,
        _input: ListPipelineProjectsInput,
    ) -> Result<Vec<PipelineProjectOption>> {
        Ok(Vec::new())
    }

    async fn list_pipeline_runs(
        &self,
        _input: ListPipelineRunsInput,
    ) -> Result<Vec<PipelineRunSummary>> {
        Ok(Vec::new())
    }

    async fn list_pipeline_definitions(
        &self,
        _input: ListPipelineDefinitionsInput,
    ) -> Result<Vec<PipelineDefinitionOption>> {
        Ok(Vec::new())
    }

    async fn get_pipeline_run(&self, _input: GetPipelineRunInput) -> Result<PipelineRunDetail> {
        Err(pipelines_unsupported())
    }

    async fn list_pipeline_artifacts(
        &self,
        _input: ListPipelineArtifactsInput,
    ) -> Result<Vec<PipelineArtifact>> {
        Ok(Vec::new())
    }

    async fn get_pipeline_definition(
        &self,
        _input: GetPipelineDefinitionInput,
    ) -> Result<PipelineDefinitionDetail> {
        Err(pipelines_unsupported())
    }

    async fn get_pipeline_run_log_tail(
        &self,
        _input: GetPipelineRunLogTailInput,
    ) -> Result<PipelineLogTail> {
        Err(pipelines_unsupported())
    }

    async fn rerun_pipeline_run(
        &self,
        _input: RerunPipelineRunInput,
    ) -> Result<PipelineRunSummary> {
        Err(pipelines_unsupported())
    }

    async fn queue_pipeline_run(
        &self,
        _input: QueuePipelineRunInput,
    ) -> Result<PipelineRunSummary> {
        Err(pipelines_unsupported())
    }

    async fn cancel_pipeline_run(
        &self,
        _input: CancelPipelineRunInput,
    ) -> Result<PipelineRunSummary> {
        Err(pipelines_unsupported())
    }

    async fn list_pipeline_approvals(
        &self,
        _input: ListPipelineApprovalsInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        Ok(Vec::new())
    }

    async fn update_pipeline_approval(
        &self,
        _input: UpdatePipelineApprovalInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        Err(pipelines_unsupported())
    }

    async fn search_all(&self, _input: SearchAllInput) -> Result<SearchAllResult> {
        // The command palette degrades to no results for GitHub (no local cache);
        // the dedicated PR/Issue/Commit/Code screens cover live GitHub search.
        Ok(SearchAllResult {
            work_items: Vec::new(),
            pull_requests: Vec::new(),
            commits: Vec::new(),
            totals: SearchAllTotals {
                work_items: 0,
                pull_requests: 0,
                commits: 0,
            },
        })
    }
}

fn pipelines_unsupported() -> AppError {
    AppError::NotSupported("Pipelines are not available for GitHub connections".to_string())
}
