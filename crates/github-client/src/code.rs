use crate::client::GitHubClient;
use crate::error::Result;
use crate::models::{CodeSearchItem, CodeSearchResponse};

impl GitHubClient {
    /// Runs `GET /search/code`. GitHub code search requires the query to include
    /// a scope qualifier (e.g. `user:`, `org:`, or `repo:`); callers compose it.
    /// Returns `(items, total_count)`.
    pub async fn search_code(&self, query: &str, limit: u32) -> Result<(Vec<CodeSearchItem>, u64)> {
        let per_page = limit.clamp(1, 100).to_string();
        let response: CodeSearchResponse = self
            .get_json("search/code", &[("q", query), ("per_page", &per_page)])
            .await?;
        Ok((response.items, response.total_count))
    }
}
