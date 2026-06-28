use crate::client::GitHubClient;
use crate::error::Result;
use crate::models::{IssueDetail, IssueSearchItem, IssueSearchResponse};

impl GitHubClient {
    /// `GET /repos/{owner}/{repo}/issues/{number}` — full issue detail.
    pub async fn get_issue(&self, owner: &str, repo: &str, number: i64) -> Result<IssueDetail> {
        self.get_json(&format!("repos/{owner}/{repo}/issues/{number}"), &[])
            .await
    }

    /// `PATCH /repos/{owner}/{repo}/issues/{number}` — updates state, assignees,
    /// labels, title, or body.
    pub async fn update_issue(
        &self,
        owner: &str,
        repo: &str,
        number: i64,
        patch: serde_json::Value,
    ) -> Result<IssueDetail> {
        self.patch_json(&format!("repos/{owner}/{repo}/issues/{number}"), &patch)
            .await
    }

    /// Open issues assigned to the authenticated user, most recently updated
    /// first. Pull requests are filtered out (GitHub's issue search returns both
    /// unless `is:issue` is honored, so the filter is belt-and-suspenders).
    pub async fn list_assigned_issues(&self, limit: u32) -> Result<Vec<IssueSearchItem>> {
        self.search_issues_only("is:issue is:open assignee:@me sort:updated-desc", limit)
            .await
    }

    /// Runs an arbitrary issue search. Callers compose the qualifiers.
    pub async fn search_issues(&self, query: &str, limit: u32) -> Result<Vec<IssueSearchItem>> {
        self.search_issues_only(query, limit).await
    }

    async fn search_issues_only(&self, query: &str, limit: u32) -> Result<Vec<IssueSearchItem>> {
        let per_page = limit.clamp(1, 100).to_string();
        let response: IssueSearchResponse = self
            .get_json("search/issues", &[("q", query), ("per_page", &per_page)])
            .await?;
        Ok(response
            .items
            .into_iter()
            .filter(|item| item.pull_request.is_none())
            .collect())
    }
}
