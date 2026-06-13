pub mod auth;
pub mod client;
pub mod error;
pub mod git;
pub mod identity;
pub mod pr_review;
pub mod work_items;

pub use auth::{AdoCredentialProvider, AzureCliProvider, PatProvider};
pub use client::{AdoClient, RetryPolicy};
pub use error::{AdoError, Result};
pub use git::{
    CommitSearchCriteria, GitCommitRef, GitPullRequest, GitRepository, GitUserDate, IdentityRef,
    IdentityRefWithVote, PullRequestStatus, TeamProject,
};
pub use identity::{AuthenticatedUser, ConnectionData, Identity, IdentityPickerIdentity};
pub use pr_review::{
    GitFilePosition, GitPullRequestDetail, GitThread, GitThreadComment, GitThreadContext,
    NewThreadContext,
};
pub use work_items::{
    WorkItem, WorkItemComment, WorkItemFieldDefinition, WorkItemLink, WorkItemReference,
    WorkItemRelation, WorkItemUpdate,
};
