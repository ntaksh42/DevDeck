use std::collections::HashSet;
use std::time::Duration;

use azdo_client::{AdoClient, GitPullRequest, PullRequestStatus, TeamProject};

use super::*;
use crate::db::{CachedPr, CachedReviewPr, Organization};
use crate::error::Result;
use crate::repos::encode_path_segment;
use crate::shared_cache::{self, SharedPullRequest, SharedReviewer};

/// How stale the shared cache (`shared_cache` module) may be before this app
/// falls back to fetching from Azure DevOps itself. Chosen well under
/// DevDeck's own ~5 minute sync interval so this app's own cadence is
/// essentially unaffected; it only skips a fetch on the rare occasion the
/// other app (waypoint) refreshed this scope moments earlier.
const SHARED_CACHE_FRESHNESS: Duration = Duration::from_secs(120);

// One project-level query replaces a request per repository; repositories
// with zero active PRs simply contribute nothing.
//
// `force_refresh` (an explicit user refresh) skips the shared-cache shortcut so
// a manual update never shows a list up to `SHARED_CACHE_FRESHNESS` old; the
// fetched result is still written back to the shared cache.
pub(crate) async fn fetch_active_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    force_refresh: bool,
) -> PrProjectFetch {
    let project_id = project.id.clone();
    let label = project.name.clone();

    if !force_refresh {
        if let Some((cached, reviewers)) = read_active_prs_from_shared_cache(&org, &project) {
            // A shared snapshot can be the previous capped API response too.
            let capped = cached.len() >= PROJECT_PR_SYNC_TOP as usize;
            return PrProjectFetch {
                project_id,
                label,
                result: Ok(cached),
                capped,
                reviewers,
            };
        }
    }

    let prs = match client
        .list_project_pull_requests(&project.id, PullRequestStatus::Active, PROJECT_PR_SYNC_TOP)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "pull request list returned 404, skipping project"
            );
            // 404 means the project is gone; treat as synced-empty so its
            // stale cached rows are cleaned up.
            return PrProjectFetch {
                project_id,
                label,
                result: Ok(Vec::new()),
                capped: false,
                reviewers: Vec::new(),
            };
        }
        Err(e) => {
            return PrProjectFetch {
                project_id,
                label,
                result: Err(e.into()),
                capped: false,
                reviewers: Vec::new(),
            }
        }
    };

    let capped = prs.len() >= PROJECT_PR_SYNC_TOP as usize;

    // Reviewers are read from `prs` by reference before the by-value pass
    // below consumes each `pr` to build `CachedPr`; both passes read the same
    // API response, just for different destinations (DevDeck's own cache vs
    // the shared cache's generic reviewer facts).
    let shared_reviewers: Vec<SharedReviewer> = prs
        .iter()
        .filter_map(|pr| {
            let repo = pr.repository.as_ref()?;
            Some(pr.reviewers.iter().flatten().filter_map(move |reviewer| {
                Some(SharedReviewer {
                    repository_id: repo.id.clone(),
                    pull_request_id: pr.pull_request_id,
                    reviewer_id: reviewer.id.clone()?,
                    vote: reviewer.vote,
                    is_required: reviewer.is_required,
                })
            }))
        })
        .flatten()
        .collect();

    let cached: Vec<CachedPr> = prs
        .into_iter()
        .filter_map(|pr| {
            let Some(repo) = pr.repository else {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    pull_request_id = pr.pull_request_id,
                    "pull request response carried no repository; skipping"
                );
                return None;
            };
            let project_name = repo
                .project
                .as_ref()
                .map(|p| p.name.clone())
                .unwrap_or_else(|| project.name.clone());
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                org.base_url,
                encode_path_segment(&project_name),
                encode_path_segment(&repo.name),
                pr.pull_request_id
            );
            let created_by_id = pr.created_by.as_ref().and_then(|u| u.id.clone());
            Some(CachedPr {
                org_id: org.id.clone(),
                project_id: project.id.clone(),
                project_name,
                repository_id: repo.id,
                repository_name: repo.name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                status: pr.status,
                created_by: pr.created_by.and_then(|u| u.display_name.or(u.unique_name)),
                created_by_id,
                creation_date: pr.creation_date.to_rfc3339(),
                source_ref_name: short_ref(&pr.source_ref_name),
                target_ref_name: short_ref(&pr.target_ref_name),
                web_url: Some(web_url),
                is_draft: pr.is_draft.unwrap_or(false),
            })
        })
        .collect();

    write_active_prs_to_shared_cache(&org, &project, &cached, &shared_reviewers);

    PrProjectFetch {
        project_id,
        label,
        result: Ok(cached),
        capped,
        reviewers: shared_reviewers,
    }
}

/// `None` when the shared cache is missing, unreadable, or not fresh enough
/// (including when no one has ever synced this scope) — the caller falls
/// back to fetching from Azure DevOps itself in every such case.
fn read_active_prs_from_shared_cache(
    org: &Organization,
    project: &TeamProject,
) -> Option<(Vec<CachedPr>, Vec<SharedReviewer>)> {
    let conn = shared_cache::open().ok()?;
    if !shared_cache::is_fresh(
        &conn,
        &org.name,
        &project.name,
        shared_cache::KIND_PULL_REQUESTS,
        SHARED_CACHE_FRESHNESS,
    ) {
        return None;
    }
    let rows = shared_cache::read_pull_requests(&conn, &org.name, &project.name).ok()?;
    let reviewers = shared_cache::read_reviewers(&conn, &org.name, &project.name).ok()?;
    let cached = rows
        .into_iter()
        .map(|row| {
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                org.base_url,
                encode_path_segment(&project.name),
                encode_path_segment(&row.repository_name),
                row.pull_request_id
            );
            CachedPr {
                org_id: org.id.clone(),
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                repository_id: row.repository_id,
                repository_name: row.repository_name,
                pull_request_id: row.pull_request_id,
                title: row.title,
                status: row.status,
                created_by: row.created_by,
                created_by_id: row.created_by_id,
                creation_date: row.creation_date,
                source_ref_name: short_ref(&row.source_ref_name),
                target_ref_name: short_ref(&row.target_ref_name),
                web_url: Some(web_url),
                is_draft: row.is_draft,
            }
        })
        .collect();
    Some((cached, reviewers))
}

/// Best-effort: a failure to reach the shared cache never fails DevDeck's own
/// sync, since the data is already safely in DevDeck's own cache by the time
/// this runs.
fn write_active_prs_to_shared_cache(
    org: &Organization,
    project: &TeamProject,
    cached: &[CachedPr],
    reviewers: &[SharedReviewer],
) {
    let rows: Vec<SharedPullRequest> = cached
        .iter()
        .map(|pr| SharedPullRequest {
            repository_id: pr.repository_id.clone(),
            repository_name: pr.repository_name.clone(),
            pull_request_id: pr.pull_request_id,
            title: pr.title.clone(),
            status: pr.status.clone(),
            created_by: pr.created_by.clone(),
            created_by_id: pr.created_by_id.clone(),
            creation_date: pr.creation_date.clone(),
            source_ref_name: pr.source_ref_name.clone(),
            target_ref_name: pr.target_ref_name.clone(),
            is_draft: pr.is_draft,
            web_url: pr.web_url.clone(),
        })
        .collect();
    let outcome = (|| -> Result<()> {
        let mut conn = shared_cache::open()?;
        shared_cache::write_pull_requests(&mut conn, &org.name, &project.name, &rows, reviewers)?;
        shared_cache::mark_synced(
            &conn,
            &org.name,
            &project.name,
            shared_cache::KIND_PULL_REQUESTS,
            shared_cache::SYNCED_BY,
        )
    })();
    if let Err(e) = outcome {
        tracing::warn!(
            org = %org.name,
            project = %project.name,
            error = %e,
            "failed to write active PRs to the shared cache"
        );
    }
}

pub(crate) async fn fetch_review_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    user_id: String,
) -> (String, Result<Vec<CachedReviewPr>>) {
    let project_name = project.name.clone();
    match list_reviews_of(&client, &org, &project, &user_id, 200).await {
        Ok(prs) => (
            project_name,
            Ok(review_prs_to_cached(prs, &org, &project, &user_id, None)),
        ),
        Err(e) => (project_name, Err(e)),
    }
}

/// Active PRs of `project` that name `reviewer_id` as a reviewer. A 404 means the
/// project is gone and counts as an empty result.
pub(crate) async fn list_reviews_of(
    client: &AdoClient,
    org: &Organization,
    project: &TeamProject,
    reviewer_id: &str,
    page_size: u32,
) -> Result<Vec<GitPullRequest>> {
    match client
        .list_pull_requests_by_reviewer(&project.id, reviewer_id, page_size)
        .await
    {
        Ok(prs) => Ok(prs),
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "review pull request list returned 404, skipping project"
            );
            Ok(Vec::new())
        }
        Err(e) => Err(e.into()),
    }
}

/// Maps reviewer-filtered PRs to My Reviews rows. With `group_ids` the PRs were
/// found through a group the user belongs to: the user's own PRs are dropped and
/// `my_is_required` also follows the matching group reviewers.
pub(crate) fn review_prs_to_cached(
    prs: Vec<GitPullRequest>,
    org: &Organization,
    project: &TeamProject,
    user_id: &str,
    group_ids: Option<&HashSet<String>>,
) -> Vec<CachedReviewPr> {
    let mut cached_reviews = Vec::new();
    for pr in prs {
        let Some(repo) = &pr.repository else {
            continue;
        };
        if group_ids.is_some()
            && pr.created_by.as_ref().and_then(|u| u.id.as_deref()) == Some(user_id)
        {
            continue;
        }
        let repo_id = repo.id.clone();
        let repo_name = repo.name.clone();
        let (proj_id, proj_name) = repo
            .project
            .as_ref()
            .map(|p| (p.id.clone(), p.name.clone()))
            .unwrap_or_else(|| (project.id.clone(), project.name.clone()));

        let reviewers = pr.reviewers.as_deref().unwrap_or(&[]);
        let (my_vote, mut my_is_required) = resolve_reviewer_vote(reviewers, user_id);
        if let Some(group_ids) = group_ids {
            my_is_required |= reviewers
                .iter()
                .any(|r| r.is_required && r.id.as_ref().is_some_and(|id| group_ids.contains(id)));
        }

        let web_url = format!(
            "{}/{}/_git/{}/pullrequest/{}",
            org.base_url,
            encode_path_segment(&proj_name),
            encode_path_segment(&repo_name),
            pr.pull_request_id
        );
        cached_reviews.push(CachedReviewPr {
            org_id: org.id.clone(),
            project_id: proj_id,
            project_name: proj_name,
            repository_id: repo_id,
            repository_name: repo_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title.clone(),
            created_by: pr
                .created_by
                .as_ref()
                .and_then(|u| u.display_name.clone().or(u.unique_name.clone())),
            creation_date: pr.creation_date.to_rfc3339(),
            target_ref_name: short_ref(&pr.target_ref_name),
            web_url: Some(web_url),
            my_vote,
            my_vote_label: vote_label(my_vote).to_string(),
            my_is_required,
            is_draft: pr.is_draft.unwrap_or(false),
            merge_status: pr.merge_status.clone(),
            ci_status: None,
            ci_context: None,
            ci_check_count: 0,
        });
    }
    cached_reviews
}
