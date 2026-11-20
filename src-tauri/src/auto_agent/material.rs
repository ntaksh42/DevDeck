//! Review material for one pull request outside the automatic queue (the Home
//! Orchestrator's workers): the same diff, description and threads an
//! automatic review gets, plus the shallow clone in the agent workspace.

use std::path::Path;

use super::{clone, context, diffs};
use crate::db::{AppDatabase, CachedReviewPr};
use crate::error::{AppError, Result};
use crate::pr_review::{PrLocator, PrReviewService};
use crate::secrets::SecretStore;

/// The pull request's material as Markdown. Also clones (or refreshes
/// DevDeck's own clone of) its repository into `workspace` at the PR head, so
/// the agent can read the code around the diff; a failed clone is logged and
/// leaves the agent with the material only.
pub(crate) async fn pull_request_document(
    db: &AppDatabase,
    workspace: Option<&Path>,
    pr: &CachedReviewPr,
) -> Result<String> {
    let org = db
        .get_organization(&pr.org_id)?
        .ok_or_else(|| AppError::InvalidInput(format!("unknown organization {}", pr.org_id)))?;
    let locator = || PrLocator {
        organization_id: Some(pr.org_id.clone()),
        project_id: pr.project_id.clone(),
        repository_id: pr.repository_id.clone(),
        pull_request_id: pr.pull_request_id,
    };
    let service = PrReviewService::new(db.clone(), SecretStore);
    let changes = service.list_changes_since(locator(), None).await?;
    let diff = diffs::section(&service, locator, &changes).await?;
    let review = service.get_review(locator()).await?;
    if let Some(workspace) = workspace {
        if let Err(error) = clone::prepare(workspace, &org, pr, changes.target_commit_id.as_deref())
        {
            tracing::warn!(id = pr.pull_request_id, %error, "home worker: shallow clone failed");
        }
    }
    Ok(context::pull_request(
        pr,
        &review,
        Some(&changes),
        &diff.document,
    ))
}
