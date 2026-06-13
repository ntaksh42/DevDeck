use azdo_client::{AdoClient, AdoError, GitRepository, PullRequestStatus, TeamProject};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const PR_SYNC_CONCURRENCY: usize = 4;

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
    pub merge_status: Option<String>,
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
    #[allow(dead_code)]
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
                merge_status: pr.merge_status,
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
        self.db.resolve_organization(id)
    }
}

pub(crate) fn short_ref(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .to_string()
}

pub(crate) fn vote_label(vote: i32) -> &'static str {
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

    // Numeric queries also match the PR number by prefix.
    if query.bytes().all(|b| b.is_ascii_digit())
        && summary.pull_request_id.to_string().starts_with(query)
    {
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

struct SyncPrsResult {
    warning: Option<String>,
}

struct PrRepoFetch {
    repository_id: String,
    label: String,
    result: Result<Vec<CachedPr>>,
}

pub async fn sync_prs_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("prs:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_prs(db, client, org).await {
        Ok(result) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(
                &scope,
                &org.id,
                Some(&now),
                0,
                None,
                result.warning.as_deref(),
            )?;
            tracing::info!(org = %org.name, "PR sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) = db.update_sync_state(
                &scope,
                &org.id,
                None,
                error_count + 1,
                Some(&e.to_string()),
                None,
            ) {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            Err(e)
        }
    }
}

async fn do_sync_prs(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<SyncPrsResult> {
    let projects = client.list_projects().await?;
    let mut cached_prs: Vec<CachedPr> = Vec::new();
    let mut synced_repo_ids: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut last_skip_error: Option<AppError> = None;
    let mut pr_tasks = JoinSet::new();

    let collect = |fetch: PrRepoFetch,
                   cached_prs: &mut Vec<CachedPr>,
                   synced_repo_ids: &mut Vec<String>,
                   skipped: &mut Vec<String>,
                   last_skip_error: &mut Option<AppError>| {
        match fetch.result {
            Ok(prs) => {
                synced_repo_ids.push(fetch.repository_id);
                cached_prs.extend(prs);
            }
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    repository = %fetch.label,
                    error = %e,
                    "PR sync failed for repository, preserving cached data"
                );
                skipped.push(fetch.label);
                *last_skip_error = Some(e);
            }
        }
    };

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
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "failed to list repositories, skipping project and preserving cached data"
                );
                skipped.push(project.name.clone());
                last_skip_error = Some(e.into());
                continue;
            }
        };
        for repo in repos {
            while pr_tasks.len() >= PR_SYNC_CONCURRENCY {
                let fetch = join_pr_task(&mut pr_tasks).await?;
                collect(
                    fetch,
                    &mut cached_prs,
                    &mut synced_repo_ids,
                    &mut skipped,
                    &mut last_skip_error,
                );
            }
            pr_tasks.spawn(fetch_active_prs_for_repo(
                client.clone(),
                org.clone(),
                project.clone(),
                repo,
            ));
        }
    }
    while !pr_tasks.is_empty() {
        let fetch = join_pr_task(&mut pr_tasks).await?;
        collect(
            fetch,
            &mut cached_prs,
            &mut synced_repo_ids,
            &mut skipped,
            &mut last_skip_error,
        );
    }

    // If nothing synced and we have a real error, surface it instead of
    // recording a spurious success.
    if synced_repo_ids.is_empty() {
        if let Some(e) = last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = synced_repo_ids.iter().map(String::as_str).collect();
    db.replace_pull_requests(&org.id, &synced_ids, &cached_prs)?;

    let mut warning_parts: Vec<String> = Vec::new();
    if !skipped.is_empty() {
        warning_parts.push(format!(
            "{} repository/project(s) skipped due to PR sync errors: {}.",
            skipped.len(),
            skipped.join(", ")
        ));
    }

    if let Some(user_id) = &org.authenticated_user_id {
        let mut cached_reviews: Vec<CachedReviewPr> = Vec::new();
        let mut review_tasks = JoinSet::new();
        let mut review_failed_projects: Vec<String> = Vec::new();

        for project in &projects {
            while review_tasks.len() >= PR_SYNC_CONCURRENCY {
                let (project_name, result) = join_review_task(&mut review_tasks).await?;
                collect_review_fetch(
                    org,
                    project_name,
                    result,
                    &mut cached_reviews,
                    &mut review_failed_projects,
                );
            }
            review_tasks.spawn(fetch_review_prs_for_project(
                client.clone(),
                org.clone(),
                project.clone(),
                user_id.clone(),
            ));
        }
        while !review_tasks.is_empty() {
            let (project_name, result) = join_review_task(&mut review_tasks).await?;
            collect_review_fetch(
                org,
                project_name,
                result,
                &mut cached_reviews,
                &mut review_failed_projects,
            );
        }

        if review_failed_projects.is_empty() {
            db.replace_review_pull_requests(&org.id, &cached_reviews)?;
        } else {
            // A partial review list would silently drop PRs from the failed
            // projects, so keep the previous cache instead.
            warning_parts.push(format!(
                "Review PR cache was not refreshed; query failed for project(s): {}.",
                review_failed_projects.join(", ")
            ));
        }
    }

    let warning = if warning_parts.is_empty() {
        None
    } else {
        Some(warning_parts.join(" "))
    };
    Ok(SyncPrsResult { warning })
}

fn collect_review_fetch(
    org: &Organization,
    project_name: String,
    result: Result<Vec<CachedReviewPr>>,
    cached_reviews: &mut Vec<CachedReviewPr>,
    review_failed_projects: &mut Vec<String>,
) {
    match result {
        Ok(reviews) => cached_reviews.extend(reviews),
        Err(e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "review PR sync failed for project, preserving cached data"
            );
            review_failed_projects.push(project_name);
        }
    }
}

async fn join_pr_task(tasks: &mut JoinSet<PrRepoFetch>) -> Result<PrRepoFetch> {
    tasks
        .join_next()
        .await
        .expect("PR sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("PR sync task failed: {e}")))
}

async fn join_review_task(
    tasks: &mut JoinSet<(String, Result<Vec<CachedReviewPr>>)>,
) -> Result<(String, Result<Vec<CachedReviewPr>>)> {
    tasks
        .join_next()
        .await
        .expect("review PR sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("review PR sync task failed: {e}")))
}

async fn fetch_active_prs_for_repo(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    repo: GitRepository,
) -> PrRepoFetch {
    let repository_id = repo.id.clone();
    let label = format!("{}/{}", project.name, repo.name);
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
            // 404 means the repository is gone; treat as synced-empty so its
            // stale cached rows are cleaned up.
            return PrRepoFetch {
                repository_id,
                label,
                result: Ok(Vec::new()),
            };
        }
        Err(e) => {
            return PrRepoFetch {
                repository_id,
                label,
                result: Err(e.into()),
            }
        }
    };

    let cached = prs
        .into_iter()
        .map(|pr| {
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                org.base_url,
                encode_path_segment(&project.name),
                encode_path_segment(&repo.name),
                pr.pull_request_id
            );
            CachedPr {
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
            }
        })
        .collect();
    PrRepoFetch {
        repository_id,
        label,
        result: Ok(cached),
    }
}

async fn fetch_review_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    user_id: String,
) -> (String, Result<Vec<CachedReviewPr>>) {
    let project_name = project.name.clone();
    let prs = match client
        .list_pull_requests_by_reviewer(&project.id, &user_id, 200)
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
            return (project_name, Ok(Vec::new()));
        }
        Err(e) => return (project_name, Err(e.into())),
    };

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

        let reviewer = pr
            .reviewers
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .find(|r| r.id.as_deref() == Some(user_id.as_str()));
        let (my_vote, my_is_required) = reviewer
            .map(|r| (r.vote, r.is_required))
            .unwrap_or((0, false));

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
        });
    }
    (project_name, Ok(cached_reviews))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::db::OrganizationDraft;

    #[tokio::test]
    async fn pr_sync_skips_failing_repo_and_preserves_its_cache() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "id": "project-1", "name": "Platform" }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/repositories"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 2,
                "value": [
                    { "id": "repo-ok", "name": "Good Repo" },
                    { "id": "repo-bad", "name": "Bad Repo" }
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-ok/pullrequests",
            ))
            .and(query_param("searchCriteria.status", "active"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 1,
                    "title": "Fresh PR",
                    "status": "active",
                    "creationDate": "2026-06-09T00:00:00Z",
                    "sourceRefName": "refs/heads/feature",
                    "targetRefName": "refs/heads/main"
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-bad/pullrequests",
            ))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db
            .upsert_organization(OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: None,
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: None,
                authenticated_user_display_name: None,
                authenticated_user_unique_name: None,
            })
            .unwrap();
        // Pre-existing cached PR in the repo that is about to fail.
        db.replace_pull_requests(
            &org.id,
            &["repo-bad"],
            &[CachedPr {
                org_id: org.id.clone(),
                project_id: "project-1".to_string(),
                project_name: "Platform".to_string(),
                repository_id: "repo-bad".to_string(),
                repository_name: "Bad Repo".to_string(),
                pull_request_id: 99,
                title: "Stale but preserved".to_string(),
                status: "active".to_string(),
                created_by: None,
                creation_date: "2026-06-01T00:00:00Z".to_string(),
                source_ref_name: "feature".to_string(),
                target_ref_name: "main".to_string(),
                web_url: None,
            }],
        )
        .unwrap();

        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let result = do_sync_prs(&db, &client, &org).await.unwrap();

        let cached = db.search_pull_requests(&org.id, None, None, None).unwrap();
        let titles: Vec<&str> = cached.iter().map(|pr| pr.title.as_str()).collect();
        assert!(titles.contains(&"Fresh PR"));
        assert!(titles.contains(&"Stale but preserved"));
        assert!(result
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("Platform/Bad Repo")));
    }

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
    fn matches_query_matches_pr_number_by_prefix() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 421,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
        };

        assert!(matches_query(&summary, "421"));
        assert!(matches_query(&summary, "42"));
        assert!(!matches_query(&summary, "21"));
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
