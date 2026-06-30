use azdo_client::{AdoClient, PullRequestStatus, TeamProject};

use super::*;
use crate::commits::encode_path_segment;
use crate::db::{CachedPr, CachedReviewPr, Organization};
use crate::error::Result;

// One project-level query replaces a request per repository; repositories
// with zero active PRs simply contribute nothing.
pub(crate) async fn fetch_active_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
) -> PrProjectFetch {
    let project_id = project.id.clone();
    let label = project.name.clone();
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
                queried_count: 0,
                result: Ok(Vec::new()),
            };
        }
        Err(e) => {
            return PrProjectFetch {
                project_id,
                label,
                queried_count: 0,
                result: Err(e.into()),
            }
        }
    };

    let queried_count = prs.len();
    let cached = prs
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
                creation_date: pr.creation_date.to_rfc3339(),
                source_ref_name: short_ref(&pr.source_ref_name),
                target_ref_name: short_ref(&pr.target_ref_name),
                web_url: Some(web_url),
                is_draft: pr.is_draft.unwrap_or(false),
            })
        })
        .collect();
    PrProjectFetch {
        project_id,
        label,
        queried_count,
        result: Ok(cached),
    }
}

pub(crate) async fn fetch_review_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    user_id: String,
) -> ReviewPrFetchResult {
    let project_name = project.name.clone();
    let prs = match client
        .list_pull_requests_by_reviewer(&project.id, &user_id, REVIEW_PR_SYNC_TOP)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "review pull request list returned 404, skipping project"
            );
            return (project_name, Ok((Vec::new(), 0)));
        }
        Err(e) => return (project_name, Err(e.into())),
    };

    let queried_count = prs.len();
    let mut cached_reviews = Vec::new();
    for pr in prs {
        let Some(repo) = &pr.repository else {
            continue;
        };
        let repo_id = repo.id.clone();
        let repo_name = repo.name.clone();
        let (proj_id, proj_name) = repo
            .project
            .as_ref()
            .map(|p| (p.id.clone(), p.name.clone()))
            .unwrap_or_else(|| (project.id.clone(), project.name.clone()));

        let (my_vote, my_is_required) =
            resolve_reviewer_vote(pr.reviewers.as_deref().unwrap_or(&[]), &user_id);

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
    (project_name, Ok((cached_reviews, queried_count)))
}

pub(crate) async fn fetch_created_prs_for_project(
    client: &AdoClient,
    org: &Organization,
    project_id: &str,
    user_id: &str,
) -> Result<Vec<MyCreatedPullRequestSummary>> {
    let prs = match client
        .list_pull_requests_by_creator(project_id, user_id, 200)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_id,
                error = %e,
                "created pull request list returned 404, skipping project"
            );
            return Ok(Vec::new());
        }
        Err(e) => return Err(e.into()),
    };

    let mut summaries = Vec::new();
    for pr in prs {
        let Some(repo) = &pr.repository else {
            continue;
        };
        let repo_name = repo.name.clone();
        let (proj_id, proj_name) = repo
            .project
            .as_ref()
            .map(|p| (p.id.clone(), p.name.clone()))
            .unwrap_or_else(|| (project_id.to_string(), project_id.to_string()));

        let reviewers = pr.reviewers.as_deref().unwrap_or(&[]);
        let approvals = reviewers.iter().filter(|r| r.vote == 10).count() as i64;

        let web_url = format!(
            "{}/{}/_git/{}/pullrequest/{}",
            org.base_url,
            encode_path_segment(&proj_name),
            encode_path_segment(&repo_name),
            pr.pull_request_id
        );
        summaries.push(MyCreatedPullRequestSummary {
            organization_id: org.id.clone(),
            project_id: proj_id,
            project_name: proj_name,
            repository_id: repo.id.clone(),
            repository_name: repo_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title.clone(),
            creation_date: pr.creation_date.to_rfc3339(),
            source_ref_name: short_ref(&pr.source_ref_name),
            target_ref_name: short_ref(&pr.target_ref_name),
            web_url: Some(web_url),
            is_draft: pr.is_draft.unwrap_or(false),
            approvals,
            reviewer_count: reviewers.len() as i64,
        });
    }
    Ok(summaries)
}
