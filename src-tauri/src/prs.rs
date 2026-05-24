use azdo_client::{GitPullRequest, PullRequestStatus};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
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

    pub async fn list_my_reviews(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let user_id = organization.authenticated_user_id.clone().ok_or_else(|| {
            AppError::InvalidInput(
                "authenticated user ID not available; re-add the organization".to_string(),
            )
        })?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            let prs = client
                .list_pull_requests_by_reviewer(&project.id, &user_id, 200)
                .await?;
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
                    .find(|r| r.id.as_deref() == Some(&user_id));
                let (my_vote, my_is_required) = reviewer
                    .map(|r| (r.vote, r.is_required))
                    .unwrap_or((0, false));

                let web_url = format!(
                    "{}/{}/_git/{}/pullrequest/{}",
                    organization.base_url, proj_name, repo_name, pr.pull_request_id,
                );
                results.push(ReviewPullRequestSummary {
                    organization_id: organization.id.clone(),
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

        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            "my review pull requests fetched"
        );
        Ok(results)
    }

    pub async fn search(&self, input: SearchPullRequestsInput) -> Result<Vec<PullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let status = parse_status(input.status.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let client = client_for_organization(&organization, &self.secrets)?;

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            let repositories = client.list_repositories(&project.id).await?;
            for repository in repositories {
                let pull_requests = client
                    .list_pull_requests(&project.id, &repository.id, status)
                    .await?;
                for pull_request in pull_requests {
                    let summary = summarize_pull_request(
                        &organization,
                        &project.id,
                        &project.name,
                        &repository.id,
                        &repository.name,
                        pull_request,
                    );
                    if matches_query(&summary, &query) {
                        results.push(summary);
                    }
                }
            }
        }

        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        results.truncate(100);
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            "pull request search completed"
        );
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

fn parse_status(value: Option<&str>) -> Result<PullRequestStatus> {
    match value
        .unwrap_or("active")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "active" => Ok(PullRequestStatus::Active),
        "completed" => Ok(PullRequestStatus::Completed),
        "abandoned" => Ok(PullRequestStatus::Abandoned),
        "all" => Ok(PullRequestStatus::All),
        other => Err(AppError::InvalidInput(format!(
            "unsupported pull request status: {other}"
        ))),
    }
}

fn summarize_pull_request(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    repository_id: &str,
    repository_name: &str,
    pull_request: GitPullRequest,
) -> PullRequestSummary {
    PullRequestSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        repository_id: repository_id.to_string(),
        repository_name: repository_name.to_string(),
        pull_request_id: pull_request.pull_request_id,
        title: pull_request.title,
        status: pull_request.status,
        created_by: pull_request
            .created_by
            .and_then(|identity| identity.display_name.or(identity.unique_name)),
        creation_date: pull_request.creation_date.to_rfc3339(),
        source_ref_name: short_ref(&pull_request.source_ref_name),
        target_ref_name: short_ref(&pull_request.target_ref_name),
        web_url: pull_request
            .links
            .and_then(|links| links.web.map(|web| web.href))
            .or(pull_request.url),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_defaults_to_active() {
        assert_eq!(parse_status(None).unwrap(), PullRequestStatus::Active);
        assert_eq!(
            parse_status(Some("completed")).unwrap(),
            PullRequestStatus::Completed
        );
        assert!(parse_status(Some("merged")).is_err());
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
}
