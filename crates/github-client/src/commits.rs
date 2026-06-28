use crate::client::GitHubClient;
use crate::error::Result;
use crate::models::{CommitSearchItem, CommitSearchResponse, CommitWithFiles, PullRequestDetail};

impl GitHubClient {
    /// `GET /repos/{owner}/{repo}/commits/{sha}` — a commit with its changed
    /// files and parent shas.
    pub async fn get_commit_detail(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
    ) -> Result<CommitWithFiles> {
        self.get_json(&format!("repos/{owner}/{repo}/commits/{sha}"), &[])
            .await
    }

    /// `GET /repos/{owner}/{repo}/commits/{sha}/pulls` — pull requests that
    /// contain the given commit.
    pub async fn list_commit_pulls(
        &self,
        owner: &str,
        repo: &str,
        sha: &str,
    ) -> Result<Vec<PullRequestDetail>> {
        self.get_json(
            &format!("repos/{owner}/{repo}/commits/{sha}/pulls"),
            &[("per_page", "100")],
        )
        .await
    }

    /// Runs `GET /search/commits`. Callers compose the qualifiers (e.g.
    /// `author:@me`, `repo:owner/name`, free text). Commit search is GA and
    /// works with the default `application/vnd.github+json` Accept header.
    pub async fn search_commits(&self, query: &str, limit: u32) -> Result<Vec<CommitSearchItem>> {
        let per_page = limit.clamp(1, 100).to_string();
        let response: CommitSearchResponse = self
            .get_json("search/commits", &[("q", query), ("per_page", &per_page)])
            .await?;
        Ok(response.items)
    }
}
