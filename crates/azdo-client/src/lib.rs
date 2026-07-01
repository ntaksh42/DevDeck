pub mod auth;
pub mod client;
pub mod code_search;
pub mod error;
pub mod git;
pub mod identity;
pub mod pipelines;
pub mod pr_review;
pub mod pr_status;
pub mod work_items;

pub use auth::{AdoCredentialProvider, AzureCliProvider, PatProvider};
pub use client::{AdoClient, RetryPolicy};
pub use code_search::{CodeSearchRequest, CodeSearchResponse, CodeSearchResult};
pub use error::{AdoError, Result};
pub use git::{
    CommitSearchCriteria, GitCommitRef, GitItem, GitPullRequest, GitRef, GitRepository,
    GitUserDate, GitVersionType, IdentityRef, IdentityRefWithVote, PullRequestStatus, TeamProject,
};
pub use identity::{AuthenticatedUser, ConnectionData, Identity, IdentityPickerIdentity};
pub use pipelines::{
    Approval, ApprovalStep, Build, BuildDefinitionDetail, BuildDefinitionRef, BuildIdentityRef,
    BuildListCriteria, BuildLogTail, DefinitionTrigger, DefinitionVariable, Timeline,
    TimelineLogRef, TimelineRecord,
};
pub use pr_review::{
    GitChangeEntry, GitChangeItem, GitCommitRefId, GitContentMetadata, GitFilePosition,
    GitItemContent, GitIteration, GitPullRequestDetail, GitThread, GitThreadComment,
    GitThreadContext, NewThreadContext,
};
pub use pr_status::{summarize_pr_ci, PrCiState, PrCiSummary, PrStatusCheck, PrStatusContext};
pub use work_items::{
    ClassificationNode, ClassificationNodeAttributes, CommentReaction, WorkItem, WorkItemComment,
    WorkItemFieldDefinition, WorkItemLink, WorkItemReference, WorkItemRelation,
    WorkItemRelationAttributes, WorkItemUpdate,
};
