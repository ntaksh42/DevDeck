//! Azure DevOps provider. Delegates to the existing domain services, which talk
//! to the Azure DevOps REST API. Holds cheap service clones (path + secret
//! handles) so swapping the active connection is inexpensive.

use async_trait::async_trait;

use crate::app_state::run_blocking;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::pipelines::{
    CancelPipelineRunInput, GetPipelineDefinitionInput, GetPipelineRunInput,
    GetPipelineRunLogTailInput, ListPipelineApprovalsInput, ListPipelineArtifactsInput,
    ListPipelineDefinitionsInput, ListPipelineProjectsInput, ListPipelineRunsInput,
    ListPipelineTestResultsInput, PipelineApprovalSummary, PipelineArtifact,
    PipelineDefinitionDetail, PipelineDefinitionOption, PipelineLogTail, PipelineProjectOption,
    PipelineRunDetail, PipelineRunSummary, PipelineService, PipelineTestResults,
    QueuePipelineRunInput, RerunPipelineRunInput, RetryPipelineStageInput,
    UpdatePipelineApprovalInput, UpdatePipelineDefinitionInput,
};
use crate::pr_review::{
    AddPullRequestLabelInput, AddPullRequestReviewerInput, DeletePullRequestCommentInput,
    EditPullRequestCommentInput, GetPullRequestFileDiffInput, PostPullRequestCommentInput,
    PrCommit, PrDetailsResult, PrFileDiff, PrLabel, PrLocator, PrReviewService, PrReviewer,
    PrStatusResult, PrThread, PullRequestChanges, PullRequestReview, RemovePullRequestLabelInput,
    RemovePullRequestReviewerInput, SearchPullRequestMentionsInput,
    SetPullRequestReviewerRequiredInput, SetPullRequestThreadStatusInput,
    SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput, UpdatePullRequestInput,
};
use crate::project_info::ProjectInfoService;
use crate::project_info::{ProjectInfoInput, ProjectTeams, ServiceConnectionInfo, ServiceHookInfo};
use crate::prs::{
    ListMyCreatedPullRequestsInput, ListMyReviewPullRequestsInput, MyCreatedPullRequestsResult,
    PullRequestSearchResult, PullRequestService, ReviewPullRequestSummary, SearchPullRequestsInput,
};
use crate::repos::{
    ListBranchesInput, ListRepositoriesInput, RepoBranch, RepoService, RepositoryOption,
};
use crate::search::{self, SearchAllInput, SearchAllResult};
use crate::wiki::{
    GetWikiPageInput, SearchWikiInput, WikiPageContent, WikiSearchResults, WikiService,
};
use crate::work_items::{
    AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult, DeleteWorkItemCommentInput,
    GetWorkItemPreviewInput, ListMyWorkItemsInput, ListWorkItemProjectsInput,
    ListWorkItemUpdatesInput, MentionCandidate, SearchWorkItemAssigneesInput,
    SearchWorkItemMentionsInput, SearchWorkItemsInput, SetWorkItemsPriorityInput,
    SetWorkItemsStateInput, SetWorkItemsTagsInput, UpdateWorkItemCommentInput,
    WorkItemAssigneeCandidate, WorkItemComment, WorkItemPreview, WorkItemProjectOption,
    WorkItemService, WorkItemSummary, WorkItemUpdateSummary,
};

use super::{Provider, ProviderCapabilities};

pub(crate) struct AzdoProvider {
    pull_requests: PullRequestService,
    pr_review: PrReviewService,
    work_items: WorkItemService,
    repos: RepoService,
    wiki: WikiService,
    project_info: ProjectInfoService,
    pipelines: PipelineService,
    db: AppDatabase,
}

impl AzdoProvider {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        pull_requests: PullRequestService,
        pr_review: PrReviewService,
        work_items: WorkItemService,
        repos: RepoService,
        wiki: WikiService,
        project_info: ProjectInfoService,
        pipelines: PipelineService,
        db: AppDatabase,
    ) -> Self {
        Self {
            pull_requests,
            pr_review,
            work_items,
            repos,
            wiki,
            project_info,
            pipelines,
            db,
        }
    }
}

#[async_trait]
impl Provider for AzdoProvider {
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            kind: "azdo",
            pull_requests: true,
            pull_request_review: true,
            work_items: true,
            pipelines: true,
            work_item_priority: true,
            resolve_review_threads: true,
        }
    }

    async fn search_pull_requests(
        &self,
        input: SearchPullRequestsInput,
    ) -> Result<PullRequestSearchResult> {
        self.pull_requests.search(input).await
    }

    async fn list_my_created_pull_requests(
        &self,
        input: ListMyCreatedPullRequestsInput,
    ) -> Result<MyCreatedPullRequestsResult> {
        self.pull_requests
            .list_my_created_pull_requests(input)
            .await
    }

    async fn list_my_review_pull_requests(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        let service = self.pull_requests.clone();
        run_blocking(move || service.list_my_reviews(input)).await
    }

    async fn search_work_items(&self, input: SearchWorkItemsInput) -> Result<Vec<WorkItemSummary>> {
        let service = self.work_items.clone();
        run_blocking(move || service.search(input)).await
    }

    async fn list_my_work_items(
        &self,
        input: ListMyWorkItemsInput,
    ) -> Result<Vec<WorkItemSummary>> {
        let service = self.work_items.clone();
        run_blocking(move || service.list_my(input)).await
    }

    async fn list_work_item_projects(
        &self,
        input: ListWorkItemProjectsInput,
    ) -> Result<Vec<WorkItemProjectOption>> {
        self.work_items.list_projects(input).await
    }

    async fn get_work_item_preview(
        &self,
        input: GetWorkItemPreviewInput,
    ) -> Result<WorkItemPreview> {
        self.work_items.preview(input).await
    }

    async fn list_work_item_updates(
        &self,
        input: ListWorkItemUpdatesInput,
    ) -> Result<Vec<WorkItemUpdateSummary>> {
        self.work_items.list_updates(input).await
    }

    async fn add_work_item_comment(
        &self,
        input: AddWorkItemCommentInput,
    ) -> Result<WorkItemComment> {
        self.work_items.add_comment(input).await
    }

    async fn update_work_item_comment(
        &self,
        input: UpdateWorkItemCommentInput,
    ) -> Result<WorkItemComment> {
        self.work_items.update_comment(input).await
    }

    async fn delete_work_item_comment(&self, input: DeleteWorkItemCommentInput) -> Result<()> {
        self.work_items.delete_comment(input).await
    }

    async fn set_work_items_state(
        &self,
        input: SetWorkItemsStateInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        self.work_items.set_items_state(input).await
    }

    async fn assign_work_items(
        &self,
        input: AssignWorkItemsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        self.work_items.assign_items(input).await
    }

    async fn set_work_items_tags(
        &self,
        input: SetWorkItemsTagsInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        self.work_items.set_items_tags(input).await
    }

    async fn set_work_items_priority(
        &self,
        input: SetWorkItemsPriorityInput,
    ) -> Result<Vec<BulkWorkItemResult>> {
        self.work_items.set_items_priority(input).await
    }

    async fn search_work_item_mentions(
        &self,
        input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        self.work_items.search_mentions(input).await
    }

    async fn search_work_item_assignees(
        &self,
        input: SearchWorkItemAssigneesInput,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        self.work_items.search_assignees(input).await
    }

    async fn get_pull_request_review(&self, input: PrLocator) -> Result<PullRequestReview> {
        self.pr_review.get_review(input).await
    }

    async fn list_pull_request_changes(&self, input: PrLocator) -> Result<PullRequestChanges> {
        self.pr_review.list_changes(input).await
    }

    async fn get_pull_request_file_diff(
        &self,
        input: GetPullRequestFileDiffInput,
    ) -> Result<PrFileDiff> {
        self.pr_review.get_file_diff(input).await
    }

    async fn list_pull_request_commits(&self, input: PrLocator) -> Result<Vec<PrCommit>> {
        self.pr_review.list_commits(input).await
    }

    async fn list_pull_request_work_items(&self, input: PrLocator) -> Result<Vec<i64>> {
        self.pr_review.list_work_item_ids(input).await
    }

    async fn post_pull_request_comment(
        &self,
        input: PostPullRequestCommentInput,
    ) -> Result<PrThread> {
        self.pr_review.post_comment(input).await
    }

    async fn set_pull_request_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread> {
        self.pr_review.set_thread_status(input).await
    }

    async fn submit_pull_request_vote(
        &self,
        input: SubmitPullRequestVoteInput,
    ) -> Result<PrReviewer> {
        self.pr_review.submit_vote(input).await
    }

    async fn update_pull_request(&self, input: UpdatePullRequestInput) -> Result<PrStatusResult> {
        self.pr_review.update_pull_request(input).await
    }

    async fn set_pull_request_reviewer_required(
        &self,
        input: SetPullRequestReviewerRequiredInput,
    ) -> Result<()> {
        self.pr_review.set_reviewer_required(input).await
    }

    async fn add_pull_request_label(&self, input: AddPullRequestLabelInput) -> Result<PrLabel> {
        self.pr_review.add_label(input).await
    }

    async fn remove_pull_request_label(&self, input: RemovePullRequestLabelInput) -> Result<()> {
        self.pr_review.remove_label(input).await
    }

    async fn add_pull_request_reviewer(&self, input: AddPullRequestReviewerInput) -> Result<()> {
        self.pr_review.add_reviewer(input).await
    }

    async fn remove_pull_request_reviewer(
        &self,
        input: RemovePullRequestReviewerInput,
    ) -> Result<()> {
        self.pr_review.remove_reviewer(input).await
    }

    async fn update_pull_request_details(
        &self,
        input: UpdatePullRequestDetailsInput,
    ) -> Result<PrDetailsResult> {
        self.pr_review.update_pull_request_details(input).await
    }

    async fn search_pull_request_mentions(
        &self,
        input: SearchPullRequestMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        self.pr_review.search_mentions(input).await
    }

    async fn edit_pull_request_comment(
        &self,
        input: EditPullRequestCommentInput,
    ) -> Result<PrThread> {
        self.pr_review.edit_comment(input).await
    }

    async fn delete_pull_request_comment(
        &self,
        input: DeletePullRequestCommentInput,
    ) -> Result<()> {
        self.pr_review.delete_comment(input).await
    }

    async fn list_project_teams(&self, input: ProjectInfoInput) -> Result<ProjectTeams> {
        self.project_info.list_teams(input).await
    }

    async fn list_service_connections(
        &self,
        input: ProjectInfoInput,
    ) -> Result<Vec<ServiceConnectionInfo>> {
        self.project_info.list_service_connections(input).await
    }

    async fn list_service_hooks(&self, input: ProjectInfoInput) -> Result<Vec<ServiceHookInfo>> {
        self.project_info.list_service_hooks(input).await
    }

    async fn search_wiki(&self, input: SearchWikiInput) -> Result<WikiSearchResults> {
        self.wiki.search(input).await
    }

    async fn get_wiki_page(&self, input: GetWikiPageInput) -> Result<WikiPageContent> {
        self.wiki.get_page(input).await
    }

    async fn list_repositories(
        &self,
        input: ListRepositoriesInput,
    ) -> Result<Vec<RepositoryOption>> {
        self.repos.list_repositories(input).await
    }

    async fn list_repo_branches(&self, input: ListBranchesInput) -> Result<Vec<RepoBranch>> {
        self.repos.list_branches(input).await
    }

    async fn list_pipeline_projects(
        &self,
        input: ListPipelineProjectsInput,
    ) -> Result<Vec<PipelineProjectOption>> {
        self.pipelines.list_projects(input).await
    }

    async fn list_pipeline_runs(
        &self,
        input: ListPipelineRunsInput,
    ) -> Result<Vec<PipelineRunSummary>> {
        self.pipelines.list_runs(input).await
    }

    async fn list_pipeline_definitions(
        &self,
        input: ListPipelineDefinitionsInput,
    ) -> Result<Vec<PipelineDefinitionOption>> {
        self.pipelines.list_definitions(input).await
    }

    async fn get_pipeline_run(&self, input: GetPipelineRunInput) -> Result<PipelineRunDetail> {
        self.pipelines.get_run(input).await
    }

    async fn list_pipeline_artifacts(
        &self,
        input: ListPipelineArtifactsInput,
    ) -> Result<Vec<PipelineArtifact>> {
        self.pipelines.list_artifacts(input).await
    }

    async fn list_pipeline_test_results(
        &self,
        input: ListPipelineTestResultsInput,
    ) -> Result<PipelineTestResults> {
        self.pipelines.list_test_results(input).await
    }

    async fn get_pipeline_definition(
        &self,
        input: GetPipelineDefinitionInput,
    ) -> Result<PipelineDefinitionDetail> {
        self.pipelines.get_definition(input).await
    }

    async fn update_pipeline_definition(
        &self,
        input: UpdatePipelineDefinitionInput,
    ) -> Result<PipelineDefinitionDetail> {
        self.pipelines.update_definition(input).await
    }

    async fn get_pipeline_run_log_tail(
        &self,
        input: GetPipelineRunLogTailInput,
    ) -> Result<PipelineLogTail> {
        self.pipelines.get_run_log_tail(input).await
    }

    async fn rerun_pipeline_run(&self, input: RerunPipelineRunInput) -> Result<PipelineRunSummary> {
        self.pipelines.rerun_run(input).await
    }

    async fn queue_pipeline_run(&self, input: QueuePipelineRunInput) -> Result<PipelineRunSummary> {
        self.pipelines.queue_run(input).await
    }

    async fn retry_pipeline_stage(&self, input: RetryPipelineStageInput) -> Result<()> {
        self.pipelines.retry_stage(input).await
    }

    async fn cancel_pipeline_run(
        &self,
        input: CancelPipelineRunInput,
    ) -> Result<PipelineRunSummary> {
        self.pipelines.cancel_run(input).await
    }

    async fn list_pipeline_approvals(
        &self,
        input: ListPipelineApprovalsInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        self.pipelines.list_approvals(input).await
    }

    async fn update_pipeline_approval(
        &self,
        input: UpdatePipelineApprovalInput,
    ) -> Result<Vec<PipelineApprovalSummary>> {
        self.pipelines.update_approval(input).await
    }

    async fn search_all(&self, input: SearchAllInput) -> Result<SearchAllResult> {
        search::search_all(&self.db, &self.work_items, &self.pull_requests, input).await
    }
}
