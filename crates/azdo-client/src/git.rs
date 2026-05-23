use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse<T> {
    pub value: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
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
    pub created_by: Option<IdentityRef>,
    pub repository: Option<GitRepository>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub url: Option<String>,
    #[serde(rename = "_links")]
    pub links: Option<PullRequestLinks>,
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
    pub display_name: Option<String>,
    pub unique_name: Option<String>,
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
            .get_json("_apis/projects", &[("api-version", "7.1")])
            .await?;
        Ok(response.value)
    }

    pub async fn list_repositories(&self, project_id: &str) -> Result<Vec<GitRepository>> {
        let path = format!("{project_id}/_apis/git/repositories");
        let response: ListResponse<GitRepository> =
            self.get_json(&path, &[("api-version", "7.1")]).await?;
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
                    ("api-version", "7.1"),
                    ("searchCriteria.status", status.as_query_value()),
                ],
            )
            .await?;
        Ok(response.value)
    }

    pub async fn list_commits(
        &self,
        project_id: &str,
        repository_id: &str,
        criteria: CommitSearchCriteria,
    ) -> Result<Vec<GitCommitRef>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/commits");
        let mut query = vec![
            ("api-version", "7.1".to_string()),
            ("$top", criteria.top.unwrap_or(50).to_string()),
        ];
        if let Some(author) = criteria.author.filter(|value| !value.trim().is_empty()) {
            query.push(("searchCriteria.author", author));
        }
        if let Some(branch) = criteria.branch.filter(|value| !value.trim().is_empty()) {
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
}

#[derive(Debug, Clone, Default)]
pub struct CommitSearchCriteria {
    pub author: Option<String>,
    pub branch: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub top: Option<u32>,
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
    use wiremock::matchers::{method, path, query_param};
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
            .and(query_param("api-version", "7.1"))
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
            .and(query_param("api-version", "7.1"))
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
    async fn list_commits_uses_search_criteria() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/git/repositories/repo-1/commits"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("$top", "25"))
            .and(query_param("searchCriteria.author", "test@example.com"))
            .and(query_param("searchCriteria.itemVersion.version", "main"))
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
                    branch: Some("main".to_string()),
                    from_date: None,
                    to_date: None,
                    top: Some(25),
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
}
