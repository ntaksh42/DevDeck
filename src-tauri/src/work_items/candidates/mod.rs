//! Conversion and de-duplication helpers for @mention and assignee candidates.
//!
//! These translate the various identity shapes Azure DevOps returns (identity
//! picker results, work item update history, comment authors, stored mention
//! history) into the `MentionCandidate` / `WorkItemAssigneeCandidate` DTOs, and
//! enforce the rules around which identities are real, mentionable users.

mod assignee;
mod identity;
mod mention;
mod service;

pub(crate) use assignee::*;
pub(crate) use identity::*;
pub(crate) use mention::*;
