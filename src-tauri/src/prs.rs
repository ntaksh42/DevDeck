use azdo_client::{AdoClient, AdoError, PullRequestStatus};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyReviewPullRequestsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub my_is_required: bool,
    pub is_draft: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub status: Option<String>,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PullRequestService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl PullRequestService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn list_my_reviews(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let cached = self.db.list_review_pull_requests(&organization.id)?;
        let mut results: Vec<ReviewPullRequestSummary> = cached
            .into_iter()
            .map(|pr| ReviewPullRequestSummary {
                organization_id: pr.org_id,
                project_id: pr.project_id,
                project_name: pr.project_name,
                repository_id: pr.repository_id,
                repository_name: pr.repository_name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                created_by: pr.created_by,
                creation_date: pr.creation_date,
                target_ref_name: pr.target_ref_name,
                web_url: pr.web_url,
                my_vote: pr.my_vote,
                my_vote_label: pr.my_vote_label,
                my_is_required: pr.my_is_required,
                is_draft: pr.is_draft,
            })
            .collect();
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        Ok(results)
    }

    // Note: cache contains only Active PRs (synced with PullRequestStatus::Active).
    // status filters other than "active" will return 0 results until sync scope is widened.
    pub fn search(&self, input: SearchPullRequestsInput) -> Result<Vec<PullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let project_filter = normalize_optional(input.project_id);
        let repository_filter = normalize_optional(input.repository_id);
        let status_filter = normalize_optional(input.status);
        let cached = self.db.search_pull_requests(
            &organization.id,
            project_filter.as_deref(),
            repository_filter.as_deref(),
            status_filter.as_deref(),
        )?;
        let mut results: Vec<PullRequestSummary> = cached
            .into_iter()
            .map(|pr| PullRequestSummary {
                organization_id: pr.org_id,
                project_id: pr.project_id,
                project_name: pr.project_name,
                repository_id: pr.repository_id,
                repository_name: pr.repository_name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                status: pr.status,
                created_by: pr.created_by,
                creation_date: pr.creation_date,
                source_ref_name: pr.source_ref_name,
                target_ref_name: pr.target_ref_name,
                web_url: pr.web_url,
            })
            .filter(|summary| matches_query(summary, &query))
            .collect();
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        results.truncate(100);
        Ok(results)
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .db
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }

        self.db
            .list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }
}

fn short_ref(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .to_string()
}

fn vote_label(vote: i32) -> &'static str {
    match vote {
        10 => "Approved",
        5 => "Approved w/ Suggestions",
        0 => "No Vote",
        -5 => "Waiting for Author",
        -10 => "Rejected",
        _ => "No Vote",
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

fn matches_query(summary: &PullRequestSummary, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }

    [
        summary.title.as_str(),
        summary.project_name.as_str(),
        summary.repository_name.as_str(),
        summary.created_by.as_deref().unwrap_or_default(),
        summary.source_ref_name.as_str(),
        summary.target_ref_name.as_str(),
    ]
    .iter()
    .any(|value| value.to_ascii_lowercase().contains(query))
}

fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}

// ── Cache sync ────────────────────────────────────────────────────────────────

pub async fn sync_prs_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("prs:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_prs(db, client, org).await {
        Ok(()) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(&scope, &org.id, Some(&now), 0, None)?;
            tracing::info!(org = %org.name, "PR sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) =
                db.update_sync_state(&scope, &org.id, None, error_count + 1, Some(&e.to_string()))
            {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            Err(e)
        }
    }
}

async fn do_sync_prs(db: &AppDatabase, client: &AdoClient, org: &Organization) -> Result<()> {
    let projects = client.list_projects().await?;
    let mut cached_prs: Vec<CachedPr> = Vec::new();

    for project in &projects {
        let repos = match client.list_repositories(&project.id).await {
            Ok(repos) => repos,
            Err(e) if is_ado_not_found(&e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "repository list returned 404, skipping project"
                );
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        for repo in repos {
            let prs = match client
                .list_pull_requests(&project.id, &repo.id, PullRequestStatus::Active)
                .await
            {
                Ok(prs) => prs,
                Err(e) if is_ado_not_found(&e) => {
                    tracing::warn!(
                        org = %org.name,
                        project = %project.name,
                        repository = %repo.name,
                        error = %e,
                        "pull request list returned 404, skipping repository"
                    );
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            for pr in prs {
                let web_url = format!(
                    "{}/{}/_git/{}/pullrequest/{}",
                    org.base_url, project.name, repo.name, pr.pull_request_id
                );
                cached_prs.push(CachedPr {
                    org_id: org.id.clone(),
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    repository_id: repo.id.clone(),
                    repository_name: repo.name.clone(),
                    pull_request_id: pr.pull_request_id,
                    title: pr.title,
                    status: pr.status,
                    created_by: pr.created_by.and_then(|u| u.display_name.or(u.unique_name)),
                    creation_date: pr.creation_date.to_rfc3339(),
                    source_ref_name: short_ref(&pr.source_ref_name),
                    target_ref_name: short_ref(&pr.target_ref_name),
                    web_url: Some(web_url),
                });
            }
        }
    }

    db.clear_pull_requests(&org.id)?;
    db.upsert_pull_requests(&cached_prs)?;

    if let Some(user_id) = &org.authenticated_user_id {
        let mut cached_reviews: Vec<CachedReviewPr> = Vec::new();

        for project in &projects {
            let prs = match client
                .list_pull_requests_by_reviewer(&project.id, user_id, 200)
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
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            for pr in prs {
                let Some(repo) = &pr.repository else { continue };
                let repo_id = repo.id.clone();
                let repo_name = repo.name.clone();
                let (proj_id, proj_name) = repo
                    .project
                    .as_ref()
                    .map(|p| (p.id.clone(), p.name.clone()))
                    .unwrap_or_else(|| (project.id.clone(), project.name.clone()));

                let reviewer = pr
                    .reviewers
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .find(|r| r.id.as_deref() == Some(user_id));
                let (my_vote, my_is_required) = reviewer
                    .map(|r| (r.vote, r.is_required))
                    .unwrap_or((0, false));

                let web_url = format!(
                    "{}/{}/_git/{}/pullrequest/{}",
                    org.base_url, proj_name, repo_name, pr.pull_request_id
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
                });
            }
        }

        db.clear_review_pull_requests(&org.id)?;
        db.upsert_review_pull_requests(&cached_reviews)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_optional_trims_and_rejects_blank() {
        assert_eq!(
            normalize_optional(Some(" project-1 ".to_string())),
            Some("project-1".to_string())
        );
        assert_eq!(normalize_optional(Some("all".to_string())), None);
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
        assert_eq!(normalize_optional(None), None);
    }

    #[test]
    fn short_ref_removes_heads_prefix() {
        assert_eq!(short_ref("refs/heads/feature/prs"), "feature/prs");
        assert_eq!(short_ref("refs/tags/v1"), "refs/tags/v1");
    }

    #[test]
    fn matches_query_checks_title_repo_author_and_branches() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 42,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
        };

        assert!(matches_query(&summary, "dashboard"));
        assert!(matches_query(&summary, "test user"));
        assert!(matches_query(&summary, "pr-search"));
        assert!(!matches_query(&summary, "work item"));
    }

    #[test]
    fn is_ado_not_found_only_matches_404_api_errors() {
        assert!(is_ado_not_found(&AdoError::Api {
            status: 404,
            body: "not found".to_string(),
        }));
        assert!(!is_ado_not_found(&AdoError::Api {
            status: 500,
            body: "server error".to_string(),
        }));
        assert!(!is_ado_not_found(&AdoError::Unauthorized));
    }
}
