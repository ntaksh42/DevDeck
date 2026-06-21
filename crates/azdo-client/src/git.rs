use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;
use crate::pr_review::GitChangeEntry;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitChangesResponse {
    #[serde(default)]
    changes: Vec<GitChangeEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse<T> {
    pub value: Vec<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepository {
    pub id: String,
    pub name: String,
    pub project: Option<TeamProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequest {
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub creation_date: DateTime<Utc>,
    /// Set when the PR is completed/abandoned; used to filter release notes by
    /// the date a PR actually merged.
    #[serde(default)]
    pub closed_date: Option<DateTime<Utc>>,
    pub created_by: Option<IdentityRef>,
    pub repository: Option<GitRepository>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub url: Option<String>,
    #[serde(rename = "_links")]
    pub links: Option<PullRequestLinks>,
    pub reviewers: Option<Vec<IdentityRefWithVote>>,
    pub is_draft: Option<bool>,
    pub merge_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    pub commit_id: String,
    pub comment: Option<String>,
    pub author: Option<GitUserDate>,
    pub committer: Option<GitUserDate>,
    pub remote_url: Option<String>,
    pub url: Option<String>,
    /// Parent commit ids; present on the single-commit endpoint, absent on the
    /// commit list endpoint.
    #[serde(default)]
    pub parents: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUserDate {
    pub name: Option<String>,
    pub email: Option<String>,
    pub date: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRef {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRefWithVote {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
    pub vote: i32,
    #[serde(default)]
    pub is_required: bool,
}

#[derive(Debug, Deserialize)]
pub struct PullRequestLinks {
    pub web: Option<LinkRef>,
}

#[derive(Debug, Deserialize)]
pub struct LinkRef {
    pub href: String,
}

impl AdoClient {
    pub async fn list_projects(&self) -> Result<Vec<TeamProject>> {
        let response: ListResponse<TeamProject> = self
            .get_json("_apis/projects", &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    pub async fn list_repositories(&self, project_id: &str) -> Result<Vec<GitRepository>> {
        let path = format!("{project_id}/_apis/git/repositories");
        let response: ListResponse<GitRepository> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    pub async fn list_pull_requests(
        &self,
        project_id: &str,
        repository_id: &str,
        status: PullRequestStatus,
    ) -> Result<Vec<GitPullRequest>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/pullrequests");
        let response: ListResponse<GitPullRequest> = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview"),
                    ("searchCriteria.status", status.as_query_value()),
                    // Without $top the server applies a small default page size,
                    // silently truncating busy repositories.
                    ("$top", "1000"),
                ],
            )
            .await?;
        Ok(response.value)
    }

    /// Lists pull requests across every repository of a project in one call.
    pub async fn list_project_pull_requests(
        &self,
        project_id: &str,
        status: PullRequestStatus,
        top: u32,
    ) -> Result<Vec<GitPullRequest>> {
        let path = format!("{project_id}/_apis/git/pullrequests");
        let top_str = top.to_string();
        let response: ListResponse<GitPullRequest> = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview"),
                    ("searchCriteria.status", status.as_query_value()),
                    ("$top", &top_str),
                ],
            )
            .await?;
        Ok(response.value)
    }

    /// Lists every active PR where `reviewer_id` is a reviewer, paging through
    /// the result set with `$skip`/`$top` so projects with more reviewer PRs
    /// than a single page (`page_size`) are returned in full rather than being
    /// silently truncated.
    pub async fn list_pull_requests_by_reviewer(
        &self,
        project_id: &str,
        reviewer_id: &str,
        page_size: u32,
    ) -> Result<Vec<GitPullRequest>> {
        let path = format!("{project_id}/_apis/git/pullrequests");
        let page_size = page_size.max(1);
        let top_str = page_size.to_string();
        let mut all = Vec::new();
        let mut skip: u32 = 0;
        loop {
            let skip_str = skip.to_string();
            let response: ListResponse<GitPullRequest> = self
                .get_json(
                    &path,
                    &[
                        ("api-version", "7.1-preview"),
                        ("searchCriteria.reviewerId", reviewer_id),
                        ("searchCriteria.status", "active"),
                        ("$top", &top_str),
                        ("$skip", &skip_str),
                    ],
                )
                .await?;
            let page_len = response.value.len() as u32;
            all.extend(response.value);
            // A short page means the server has no more results to return.
            if page_len < page_size {
                break;
            }
            skip += page_size;
        }
        Ok(all)
    }

    /// Lists pull requests across a project filtered server-side by their CLOSED
    /// date within the optional `[min_time, max_time]` window (RFC3339), paging
    /// through all results with `$skip`/`$top`. Unlike [`list_project_pull_requests`]
    /// this returns the set in full rather than a single `$top` page, so callers
    /// such as release notes do not silently drop PRs once a project has more
    /// completed PRs than one page. The time window uses `queryTimeRangeType=closed`
    /// so the bound is the merge/close date, not creation.
    pub async fn list_pull_requests_closed_in_range(
        &self,
        project_id: &str,
        status: PullRequestStatus,
        min_time: Option<&str>,
        max_time: Option<&str>,
        page_size: u32,
    ) -> Result<Vec<GitPullRequest>> {
        let path = format!("{project_id}/_apis/git/pullrequests");
        let page_size = page_size.max(1);
        let top_str = page_size.to_string();
        let mut all = Vec::new();
        let mut skip: u32 = 0;
        loop {
            let skip_str = skip.to_string();
            let mut params: Vec<(&str, &str)> = vec![
                ("api-version", "7.1-preview"),
                ("searchCriteria.status", status.as_query_value()),
                ("searchCriteria.queryTimeRangeType", "closed"),
                ("$top", &top_str),
                ("$skip", &skip_str),
            ];
            if let Some(min) = min_time {
                params.push(("searchCriteria.minTime", min));
            }
            if let Some(max) = max_time {
                params.push(("searchCriteria.maxTime", max));
            }
            let response: ListResponse<GitPullRequest> = self.get_json(&path, &params).await?;
            let page_len = response.value.len() as u32;
            all.extend(response.value);
            // A short page means the server has no more results to return.
            if page_len < page_size {
                break;
            }
            skip += page_size;
        }
        Ok(all)
    }

    pub async fn list_commits(
        &self,
        project_id: &str,
        repository_id: &str,
        criteria: CommitSearchCriteria,
    ) -> Result<Vec<GitCommitRef>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/commits");
        let mut query = vec![
            ("api-version", "7.1-preview".to_string()),
            ("$top", criteria.top.unwrap_or(50).to_string()),
        ];
        if let Some(skip) = criteria.skip.filter(|value| *value > 0) {
            query.push(("$skip", skip.to_string()));
        }
        if let Some(author) = criteria.author.filter(|value| !value.trim().is_empty()) {
            query.push(("searchCriteria.author", author));
        }
        if let Some(branch) = criteria.branch.filter(|value| !value.trim().is_empty()) {
            let branch = branch
                .trim()
                .strip_prefix("refs/heads/")
                .unwrap_or(branch.trim())
                .to_string();
            query.push((
                "searchCriteria.itemVersion.versionType",
                "branch".to_string(),
            ));
            query.push(("searchCriteria.itemVersion.version", branch));
        }
        if let Some(from_date) = criteria.from_date.filter(|value| !value.trim().is_empty()) {
            query.push(("searchCriteria.fromDate", from_date));
        }
        if let Some(to_date) = criteria.to_date.filter(|value| !value.trim().is_empty()) {
            query.push(("searchCriteria.toDate", to_date));
        }

        let query_refs: Vec<(&str, &str)> = query
            .iter()
            .map(|(key, value)| (*key, value.as_str()))
            .collect();
        let response: ListResponse<GitCommitRef> = self.get_json(&path, &query_refs).await?;
        Ok(response.value)
    }

    /// Lists the pull requests that contain the given commit.
    ///
    /// Repository-scoped (no project segment), matching
    /// `GET /_apis/git/repositories/{repoId}/commits/{commitId}/pullRequests`.
    pub async fn list_commit_pull_requests(
        &self,
        repository_id: &str,
        commit_id: &str,
    ) -> Result<Vec<GitPullRequest>> {
        let path =
            format!("_apis/git/repositories/{repository_id}/commits/{commit_id}/pullRequests");
        let response: ListResponse<GitPullRequest> = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.value)
    }

    pub async fn get_commit(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
    ) -> Result<GitCommitRef> {
        let path =
            format!("{project_id}/_apis/git/repositories/{repository_id}/commits/{commit_id}");
        self.get_json(&path, &[("api-version", "7.1-preview")])
            .await
    }

    pub async fn get_commit_changes(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
    ) -> Result<Vec<GitChangeEntry>> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/commits/{commit_id}/changes"
        );
        let response: CommitChangesResponse = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response.changes)
    }
}

#[derive(Debug, Clone, Default)]
pub struct CommitSearchCriteria {
    pub author: Option<String>,
    pub branch: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub top: Option<u32>,
    pub skip: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullRequestStatus {
    Active,
    Completed,
    Abandoned,
    All,
}

impl PullRequestStatus {
    pub fn as_query_value(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Abandoned => "abandoned",
            Self::All => "all",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param, query_param_is_missing};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn list_projects_maps_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{ "id": "project-1", "name": "Platform" }]
            })))
            .mount(&server)
            .await;

        let projects = test_client(&server).await.list_projects().await.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Platform");
    }

    #[tokio::test]
    async fn list_pull_requests_uses_status_query() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/pullrequests",
            ))
            .and(query_param("api-version", "7.1-preview"))
            .and(query_param("searchCriteria.status", "active"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 42,
                    "title": "Add dashboard",
                    "status": "active",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "createdBy": { "displayName": "Test User", "uniqueName": "test@example.com" },
                    "repository": {
                        "id": "repo-1",
                        "name": "azdo-dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/feature/dashboard",
                    "targetRefName": "refs/heads/main",
                    "_links": {
                        "web": { "href": "https://dev.azure.com/testorg/project/_git/repo/pullrequest/42" }
                    }
                }]
            })))
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_pull_requests("project-1", "repo-1", PullRequestStatus::Active)
            .await
            .unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].pull_request_id, 42);
        assert_eq!(
            prs[0].links.as_ref().unwrap().web.as_ref().unwrap().href,
            "https://dev.azure.com/testorg/project/_git/repo/pullrequest/42"
        );
    }

    #[tokio::test]
    async fn list_project_pull_requests_spans_repositories() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("api-version", "7.1-preview"))
            .and(query_param("searchCriteria.status", "active"))
            .and(query_param("$top", "500"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 2,
                "value": [
                    {
                        "pullRequestId": 42,
                        "title": "Add dashboard",
                        "status": "active",
                        "creationDate": "2026-05-24T00:00:00Z",
                        "repository": {
                            "id": "repo-1",
                            "name": "dashboard",
                            "project": { "id": "project-1", "name": "Platform" }
                        },
                        "sourceRefName": "refs/heads/feature/dashboard",
                        "targetRefName": "refs/heads/main"
                    },
                    {
                        "pullRequestId": 43,
                        "title": "Fix tooling",
                        "status": "active",
                        "creationDate": "2026-05-25T00:00:00Z",
                        "repository": {
                            "id": "repo-2",
                            "name": "tools",
                            "project": { "id": "project-1", "name": "Platform" }
                        },
                        "sourceRefName": "refs/heads/fix/tooling",
                        "targetRefName": "refs/heads/main"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_project_pull_requests("project-1", PullRequestStatus::Active, 500)
            .await
            .unwrap();
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].repository.as_ref().unwrap().id, "repo-1");
        assert_eq!(prs[1].repository.as_ref().unwrap().id, "repo-2");
    }

    #[tokio::test]
    async fn list_pull_requests_closed_in_range_pages_and_filters_by_close_time() {
        let server = MockServer::start().await;
        // First page (skip=0) is full, so a second page must be requested.
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.status", "completed"))
            .and(query_param("searchCriteria.queryTimeRangeType", "closed"))
            .and(query_param("searchCriteria.minTime", "2026-06-01T00:00:00+00:00"))
            .and(query_param("$skip", "0"))
            .and(query_param("$top", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 2,
                "value": [
                    { "pullRequestId": 50, "title": "A", "status": "completed",
                      "creationDate": "2026-06-02T00:00:00Z", "closedDate": "2026-06-05T00:00:00Z",
                      "sourceRefName": "refs/heads/a", "targetRefName": "refs/heads/main",
                      "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } },
                    { "pullRequestId": 51, "title": "B", "status": "completed",
                      "creationDate": "2026-06-03T00:00:00Z", "closedDate": "2026-06-06T00:00:00Z",
                      "sourceRefName": "refs/heads/b", "targetRefName": "refs/heads/main",
                      "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } }
                ]
            })))
            .mount(&server)
            .await;
        // Second page (skip=2) is short, so paging stops here.
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("$skip", "2"))
            .and(query_param("$top", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [
                    { "pullRequestId": 52, "title": "C", "status": "completed",
                      "creationDate": "2026-06-04T00:00:00Z", "closedDate": "2026-06-07T00:00:00Z",
                      "sourceRefName": "refs/heads/c", "targetRefName": "refs/heads/main",
                      "repository": { "id": "r1", "name": "repo", "project": { "id": "project-1", "name": "Platform" } } }
                ]
            })))
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_pull_requests_closed_in_range(
                "project-1",
                PullRequestStatus::Completed,
                Some("2026-06-01T00:00:00+00:00"),
                None,
                2,
            )
            .await
            .unwrap();
        // All three completed PRs across both pages are returned (no truncation).
        assert_eq!(prs.len(), 3);
        assert_eq!(prs[0].pull_request_id, 50);
        assert_eq!(prs[2].pull_request_id, 52);
    }

    #[tokio::test]
    async fn list_pull_requests_by_reviewer_filters_by_reviewer_id() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("api-version", "7.1-preview"))
            .and(query_param("searchCriteria.reviewerId", "user-42"))
            .and(query_param("searchCriteria.status", "active"))
            .and(query_param("$top", "200"))
            .and(query_param("$skip", "0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 7,
                    "title": "Fix bug",
                    "status": "active",
                    "creationDate": "2026-05-20T00:00:00Z",
                    "createdBy": { "id": "author-1", "displayName": "Author" },
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/fix/bug",
                    "targetRefName": "refs/heads/main",
                    "isDraft": false,
                    "reviewers": [
                        { "id": "user-42", "displayName": "Me", "vote": 0, "isRequired": true }
                    ]
                }]
            })))
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_pull_requests_by_reviewer("project-1", "user-42", 200)
            .await
            .unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].pull_request_id, 7);
        let reviewers = prs[0].reviewers.as_ref().unwrap();
        assert_eq!(reviewers[0].vote, 0);
        assert!(reviewers[0].is_required);
    }

    #[tokio::test]
    async fn list_pull_requests_by_reviewer_pages_through_all_results() {
        fn reviewer_pr(id: i64) -> serde_json::Value {
            serde_json::json!({
                "pullRequestId": id,
                "title": format!("PR {id}"),
                "status": "active",
                "creationDate": "2026-05-20T00:00:00Z",
                "createdBy": { "id": "author-1", "displayName": "Author" },
                "repository": {
                    "id": "repo-1",
                    "name": "dashboard",
                    "project": { "id": "project-1", "name": "Platform" }
                },
                "sourceRefName": "refs/heads/fix/bug",
                "targetRefName": "refs/heads/main",
                "isDraft": false,
                "reviewers": [
                    { "id": "user-42", "displayName": "Me", "vote": 0, "isRequired": true }
                ]
            })
        }

        let server = MockServer::start().await;

        // Page 1: a full page (page_size = 2) means the client must keep paging.
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.reviewerId", "user-42"))
            .and(query_param("$top", "2"))
            .and(query_param("$skip", "0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 2,
                "value": [reviewer_pr(1), reviewer_pr(2)]
            })))
            .expect(1)
            .mount(&server)
            .await;

        // Page 2: a short page (1 < page_size) ends the pagination loop.
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.reviewerId", "user-42"))
            .and(query_param("$top", "2"))
            .and(query_param("$skip", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [reviewer_pr(3)]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_pull_requests_by_reviewer("project-1", "user-42", 2)
            .await
            .unwrap();

        let ids: Vec<i64> = prs.iter().map(|pr| pr.pull_request_id).collect();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn get_commit_parses_parents() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/commits/abc123",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "commitId": "abc123",
                "comment": "Fix bug",
                "parents": ["parent1", "parent0"]
            })))
            .mount(&server)
            .await;

        let commit = test_client(&server)
            .await
            .get_commit("project-1", "repo-1", "abc123")
            .await
            .unwrap();
        assert_eq!(commit.commit_id, "abc123");
        assert_eq!(
            commit.parents.as_deref(),
            Some(["parent1".to_string(), "parent0".to_string()].as_slice())
        );
    }

    #[tokio::test]
    async fn list_commit_pull_requests_maps_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/_apis/git/repositories/repo-1/commits/abc123/pullRequests",
            ))
            .and(query_param("api-version", "7.1-preview"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 99,
                    "title": "Land the fix",
                    "status": "completed",
                    "creationDate": "2026-05-24T00:00:00Z",
                    "repository": {
                        "id": "repo-1",
                        "name": "dashboard",
                        "project": { "id": "project-1", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/fix",
                    "targetRefName": "refs/heads/main"
                }]
            })))
            .mount(&server)
            .await;

        let prs = test_client(&server)
            .await
            .list_commit_pull_requests("repo-1", "abc123")
            .await
            .unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].pull_request_id, 99);
        assert_eq!(prs[0].status, "completed");
    }

    #[tokio::test]
    async fn get_commit_changes_maps_entries() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/_apis/git/repositories/repo-1/commits/abc123/changes",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "changeCounts": { "Edit": 1 },
                "changes": [
                    {
                        "item": { "path": "/src/main.rs", "isFolder": false },
                        "changeType": "edit"
                    },
                    {
                        "item": { "path": "/src", "isFolder": true },
                        "changeType": "edit"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let changes = test_client(&server)
            .await
            .get_commit_changes("project-1", "repo-1", "abc123")
            .await
            .unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!(
            changes[0].item.as_ref().unwrap().path.as_deref(),
            Some("/src/main.rs")
        );
    }

    #[tokio::test]
    async fn list_commits_uses_search_criteria() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
            .and(query_param("api-version", "7.1-preview"))
            .and(query_param("$top", "25"))
            .and(query_param("searchCriteria.author", "test@example.com"))
            .and(query_param(
                "searchCriteria.itemVersion.versionType",
                "branch",
            ))
            .and(query_param("searchCriteria.itemVersion.version", "main"))
            .and(query_param(
                "searchCriteria.fromDate",
                "2026-05-01T00:00:00Z",
            ))
            .and(query_param("searchCriteria.toDate", "2026-05-24T23:59:59Z"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "commitId": "abc123",
                    "comment": "Add commit search",
                    "author": {
                        "name": "Test User",
                        "email": "test@example.com",
                        "date": "2026-05-24T00:00:00Z"
                    },
                    "remoteUrl": "https://dev.azure.com/testorg/project/_git/repo/commit/abc123"
                }]
            })))
            .mount(&server)
            .await;

        let commits = test_client(&server)
            .await
            .list_commits(
                "project-1",
                "repo-1",
                CommitSearchCriteria {
                    author: Some("test@example.com".to_string()),
                    branch: Some("refs/heads/main".to_string()),
                    from_date: Some("2026-05-01T00:00:00Z".to_string()),
                    to_date: Some("2026-05-24T23:59:59Z".to_string()),
                    top: Some(25),
                    skip: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].commit_id, "abc123");
        assert_eq!(
            commits[0].author.as_ref().unwrap().name.as_deref(),
            Some("Test User")
        );
    }

    #[tokio::test]
    async fn list_commits_sends_skip_when_set() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
            .and(query_param("$top", "100"))
            .and(query_param("$skip", "100"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{ "commitId": "page2", "comment": "second page" }]
            })))
            .mount(&server)
            .await;

        let commits = test_client(&server)
            .await
            .list_commits(
                "project-1",
                "repo-1",
                CommitSearchCriteria {
                    top: Some(100),
                    skip: Some(100),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].commit_id, "page2");
    }

    #[tokio::test]
    async fn list_commits_omits_skip_when_zero() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
            .and(query_param_is_missing("$skip"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 0,
                "value": []
            })))
            .mount(&server)
            .await;

        test_client(&server)
            .await
            .list_commits(
                "project-1",
                "repo-1",
                CommitSearchCriteria {
                    skip: Some(0),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
    }
}
