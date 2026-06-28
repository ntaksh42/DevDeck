use crate::client::GitHubClient;
use crate::error::Result;
use crate::models::{AuthenticatedUser, IssueSearchItem, IssueSearchResponse};

/// GitHub's search API caps `per_page` at 100.
const MAX_PER_PAGE: u32 = 100;

impl GitHubClient {
    /// The authenticated user (`GET /user`). Used to validate a token when a
    /// connection is added and to record the connection owner.
    pub async fn current_user(&self) -> Result<AuthenticatedUser> {
        self.get_json("user", &[]).await
    }

    /// Open pull requests authored by the authenticated user, most recently
    /// updated first.
    pub async fn list_authored_pull_requests(&self, limit: u32) -> Result<Vec<IssueSearchItem>> {
        self.search_pull_requests("is:pr is:open author:@me sort:updated-desc", limit)
            .await
    }

    /// Open pull requests where the authenticated user is a requested reviewer.
    pub async fn list_review_requested_pull_requests(
        &self,
        limit: u32,
    ) -> Result<Vec<IssueSearchItem>> {
        self.search_pull_requests(
            "is:pr is:open review-requested:@me sort:updated-desc",
            limit,
        )
        .await
    }

    /// Runs an arbitrary pull-request search. Callers compose the GitHub search
    /// qualifiers (`is:pr`, `involves:@me`, `is:open`, free text, etc.).
    pub async fn search_prs(&self, query: &str, limit: u32) -> Result<Vec<IssueSearchItem>> {
        self.search_pull_requests(query, limit).await
    }

    /// Runs a `GET /search/issues` query and returns the pull-request items.
    /// Non-PR issues are filtered out defensively even though the queries pin
    /// `is:pr`.
    async fn search_pull_requests(&self, query: &str, limit: u32) -> Result<Vec<IssueSearchItem>> {
        let per_page = limit.clamp(1, MAX_PER_PAGE).to_string();
        let response: IssueSearchResponse = self
            .get_json("search/issues", &[("q", query), ("per_page", &per_page)])
            .await?;
        Ok(response
            .items
            .into_iter()
            .filter(|item| item.pull_request.is_some())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::RetryPolicy;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client(server: &MockServer) -> GitHubClient {
        GitHubClient::with_base_url("test-token", &format!("{}/", server.uri()))
            .unwrap()
            .with_retry_policy(RetryPolicy::no_retries())
    }

    #[tokio::test]
    async fn current_user_sends_bearer_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .and(header("authorization", "Bearer test-token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"login":"octocat","id":1})),
            )
            .mount(&server)
            .await;

        let user = client(&server).current_user().await.unwrap();
        assert_eq!(user.login, "octocat");
        assert_eq!(user.id, 1);
    }

    #[tokio::test]
    async fn authored_pull_requests_filters_to_prs() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/search/issues"))
            .and(query_param(
                "q",
                "is:pr is:open author:@me sort:updated-desc",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "total_count": 2,
                "incomplete_results": false,
                "items": [
                    {
                        "number": 7,
                        "title": "Add feature",
                        "state": "open",
                        "html_url": "https://github.com/octo/hello/pull/7",
                        "repository_url": "https://api.github.com/repos/octo/hello",
                        "user": {"login": "octocat", "id": 1},
                        "draft": false,
                        "created_at": "2026-06-01T00:00:00Z",
                        "updated_at": "2026-06-02T00:00:00Z",
                        "pull_request": {"html_url": "https://github.com/octo/hello/pull/7"}
                    },
                    {
                        "number": 8,
                        "title": "An issue, not a PR",
                        "state": "open",
                        "html_url": "https://github.com/octo/hello/issues/8",
                        "repository_url": "https://api.github.com/repos/octo/hello",
                        "user": {"login": "octocat", "id": 1},
                        "draft": false,
                        "created_at": "2026-06-01T00:00:00Z",
                        "updated_at": "2026-06-02T00:00:00Z"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let prs = client(&server)
            .list_authored_pull_requests(50)
            .await
            .unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].number, 7);
        assert_eq!(prs[0].owner_repo(), Some(("octo", "hello")));
    }

    #[tokio::test]
    async fn unauthorized_maps_to_unauthorized_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_json(serde_json::json!({"message":"Bad credentials"})),
            )
            .mount(&server)
            .await;

        let err = client(&server).current_user().await.unwrap_err();
        assert!(matches!(err, crate::error::GitHubError::Unauthorized));
    }
}
