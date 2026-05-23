pub mod auth;
pub mod client;
pub mod error;
pub mod git;
pub mod identity;
pub mod work_items;

pub use auth::{AdoCredentialProvider, PatProvider};
pub use client::AdoClient;
pub use error::{AdoError, Result};
pub use git::{GitPullRequest, GitRepository, IdentityRef, PullRequestStatus, TeamProject};
pub use identity::{AuthenticatedUser, ConnectionData};
pub use work_items::{WorkItem, WorkItemReference};
