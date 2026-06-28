//! GitHub-kind connection services. Each function mirrors the shape of the
//! Azure DevOps service it parallels and returns the same provider-neutral DTOs
//! the frontend already consumes, so "GitHub Mode" reuses the existing views.

pub mod code;
pub mod commits;
pub mod pr_review;
pub mod prs;
pub mod work_items;
