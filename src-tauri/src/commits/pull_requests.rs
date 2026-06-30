use azdo_client::GitPullRequest;
use chrono::Utc;

use crate::auth::client_for_organization;
use crate::db::{CachedCommitPr, Organization};
use crate::error::Result;
use crate::prs::vote_label;

use super::helpers::encode_path_segment;
use super::{
    CommitPullRequest, CommitPullRequestsBatchEntry, CommitService,
    GetCommitPullRequestsBatchInput, GetCommitPullRequestsInput,
};

/// How long a commit's related-PR lookup stays cached before being refreshed.
const COMMIT_PR_CACHE_TTL_MINUTES: i64 = 30;

impl CommitService {
    /// Returns the pull requests that contain a commit, served from an
    /// on-demand cache. Returns an empty list (not an error) when the commit is
    /// not part of any pull request.
    pub async fn get_commit_pull_requests(
        &self,
        input: GetCommitPullRequestsInput,
    ) -> Result<Vec<CommitPullRequest>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let fresh_after =
            (Utc::now() - chrono::Duration::minutes(COMMIT_PR_CACHE_TTL_MINUTES)).to_rfc3339();

        if let Some(cached) = self.db.get_cached_commit_prs(
            &organization.id,
            &input.repository_id,
            &input.commit_id,
            &fresh_after,
        )? {
            return Ok(cached
                .into_iter()
                .map(cached_commit_pr_to_summary)
                .collect());
        }

        let client = client_for_organization(&organization, &self.secrets)?;
        let prs = client
            .list_commit_pull_requests(&input.repository_id, &input.commit_id)
            .await?;

        let cached = build_cached_commit_prs(&organization, prs);
        self.db.replace_commit_prs(
            &organization.id,
            &input.repository_id,
            &input.commit_id,
            &cached,
        )?;

        Ok(cached
            .into_iter()
            .map(cached_commit_pr_to_summary)
            .collect())
    }

    /// Batched form of [`get_commit_pull_requests`]: looks up related PRs for
    /// several commits at once, reusing the same per-commit cache so the
    /// result also warms the cache `get_commit_pull_requests` reads from.
    /// Used to populate PR counts for a visible window of grid rows without
    /// issuing one request per row.
    ///
    /// [`get_commit_pull_requests`]: CommitService::get_commit_pull_requests
    pub async fn get_commit_pull_requests_batch(
        &self,
        input: GetCommitPullRequestsBatchInput,
    ) -> Result<Vec<CommitPullRequestsBatchEntry>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let fresh_after =
            (Utc::now() - chrono::Duration::minutes(COMMIT_PR_CACHE_TTL_MINUTES)).to_rfc3339();

        let mut entries = Vec::with_capacity(input.commit_ids.len());
        let mut missing = Vec::new();
        for commit_id in &input.commit_ids {
            if let Some(cached) = self.db.get_cached_commit_prs(
                &organization.id,
                &input.repository_id,
                commit_id,
                &fresh_after,
            )? {
                entries.push(CommitPullRequestsBatchEntry {
                    commit_id: commit_id.clone(),
                    pull_requests: cached
                        .into_iter()
                        .map(cached_commit_pr_to_summary)
                        .collect(),
                });
            } else {
                missing.push(commit_id.clone());
            }
        }

        if !missing.is_empty() {
            let client = client_for_organization(&organization, &self.secrets)?;
            let mut by_commit = client
                .list_pull_requests_for_commits(&input.repository_id, &missing)
                .await?;
            for commit_id in &missing {
                let prs = by_commit.remove(commit_id).unwrap_or_default();
                let cached = build_cached_commit_prs(&organization, prs);
                self.db.replace_commit_prs(
                    &organization.id,
                    &input.repository_id,
                    commit_id,
                    &cached,
                )?;
                entries.push(CommitPullRequestsBatchEntry {
                    commit_id: commit_id.clone(),
                    pull_requests: cached
                        .into_iter()
                        .map(cached_commit_pr_to_summary)
                        .collect(),
                });
            }
        }

        Ok(entries)
    }
}

/// Converts pull requests from the Azure DevOps Pull Request Query API into
/// the cache row shape, resolving each PR's web URL and the current user's
/// vote. Shared by the single-commit and batched lookups.
fn build_cached_commit_prs(
    organization: &Organization,
    prs: Vec<GitPullRequest>,
) -> Vec<CachedCommitPr> {
    let me = organization.authenticated_user_id.as_deref();
    prs.into_iter()
        .filter_map(|pr| {
            let repo = pr.repository.as_ref()?;
            let project_name = repo
                .project
                .as_ref()
                .map(|p| p.name.as_str())
                .unwrap_or(repo.name.as_str());
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                organization.base_url.trim_end_matches('/'),
                encode_path_segment(project_name),
                encode_path_segment(&repo.name),
                pr.pull_request_id
            );
            let my_vote = me
                .and_then(|me| {
                    pr.reviewers
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
                        .find(|r| r.id.as_deref() == Some(me))
                        .map(|r| r.vote)
                })
                .unwrap_or(0);
            Some(CachedCommitPr {
                pull_request_id: pr.pull_request_id,
                pr_repository_id: repo.id.clone(),
                title: pr.title,
                status: pr.status,
                my_vote,
                my_vote_label: vote_label(my_vote).to_string(),
                web_url: Some(web_url),
            })
        })
        .collect()
}

fn cached_commit_pr_to_summary(pr: CachedCommitPr) -> CommitPullRequest {
    CommitPullRequest {
        pull_request_id: pr.pull_request_id,
        repository_id: pr.pr_repository_id,
        title: pr.title,
        status: pr.status,
        my_vote: pr.my_vote,
        my_vote_label: pr.my_vote_label,
        web_url: pr.web_url,
    }
}
