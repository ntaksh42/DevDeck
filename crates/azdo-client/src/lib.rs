pub mod auth;
pub mod client;
pub mod code_search;
pub mod error;
pub mod git;
pub mod identity;
pub mod pipelines;
pub mod policy;
pub mod pr_review;
pub mod pr_status;
pub mod project_info;
pub mod wiki;
pub mod work_items;

pub use auth::{AdoCredentialProvider, AzureCliProvider, PatProvider};
pub use client::{AdoClient, RetryPolicy};
pub use code_search::{CodeSearchRequest, CodeSearchResponse, CodeSearchResult};
pub use error::{AdoError, Result};
pub use git::{
    CommitSearchCriteria, GitBranchStats, GitCommitDiffs, GitCommitRef, GitDiffChange, GitDiffItem,
    GitItem, GitPullRequest, GitRef, GitRefUpdateResult, GitRepository, GitUserDate,
    GitVersionType, IdentityRef, IdentityRefWithVote, PullRequestStatus, TeamProject,
    ZERO_OBJECT_ID,
};
pub use identity::{AuthenticatedUser, ConnectionData, Identity, IdentityPickerIdentity};
pub use pipelines::{
    Approval, ApprovalStep, Build, BuildDefinitionDetail, BuildDefinitionRef,
    BuildDefinitionRepository, BuildIdentityRef, BuildListCriteria, BuildLogTail,
    DefinitionTrigger, DefinitionVariable, TestCaseResult, TestRun, TestRunStatistic, Timeline,
    TimelineLogRef, TimelineRecord,
};
pub use policy::{PolicyConfiguration, PolicyType};
pub use pr_review::{
    GitChangeEntry, GitChangeItem, GitCommitRefId, GitContentMetadata, GitFilePosition,
    GitItemContent, GitIteration, GitPullRequestDetail, GitThread, GitThreadComment,
    GitThreadContext, NewThreadContext,
};
pub use pr_status::{summarize_pr_ci, PrCiState, PrCiSummary, PrStatusCheck, PrStatusContext};
pub use project_info::{
    ProjectTeam, ServiceEndpoint, ServiceHookSubscription, TeamMember, TeamMemberIdentity,
};
pub use wiki::{WikiPage, WikiSearchRequest, WikiSearchResponse, WikiSearchResult};
pub use work_items::{
    has_asof_clause, with_asof, ClassificationNode, ClassificationNodeAttributes, CommentReaction,
    QueryHierarchyItem, WorkItem, WorkItemComment, WorkItemFieldDefinition, WorkItemLink,
    WorkItemReference, WorkItemRelation, WorkItemRelationAttributes, WorkItemUpdate,
};
