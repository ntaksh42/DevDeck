use crate::client::GitHubClient;
use crate::error::Result;
use crate::models::{
    CommitSearchItem, CommitSearchResponse, CommitWithFiles, CompareCommitsResponse, PrFileItem,
    PullRequestDetail,
};

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

    /// `GET /repos/{owner}/{repo}/compare/{base}...{head}` — changed files
    /// between two arbitrary commits (not necessarily parent/child), used by
    /// the two-commit compare view.
    pub async fn compare_commits(
        &self,
        owner: &str,
        repo: &str,
        base: &str,
        head: &str,
    ) -> Result<Vec<PrFileItem>> {
        let response: CompareCommitsResponse = self
            .get_json(
                &format!("repos/{owner}/{repo}/compare/{base}...{head}"),
                &[],
            )
            .await?;
        Ok(response.files)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::RetryPolicy;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client(server: &MockServer) -> GitHubClient {
        GitHubClient::with_base_url("test-token", &format!("{}/", server.uri()))
            .unwrap()
            .with_retry_policy(RetryPolicy::no_retries())
    }

    #[tokio::test]
    async fn compare_commits_requests_base_triple_dot_head_and_keeps_orientation() {
        let server = MockServer::start().await;
        // The `...` between base and head is a single path segment, not a
        // dot-segment reference, so it must reach the server verbatim rather
        // than being normalized away by URL joining.
        Mock::given(method("GET"))
            .and(path("/repos/octo/hello/compare/base-sha...head-sha"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "files": [
                    { "filename": "src/new_file.rs", "status": "added" },
                    { "filename": "src/old_file.rs", "status": "removed" }
                ]
            })))
            .mount(&server)
            .await;

        let files = client(&server)
            .compare_commits("octo", "hello", "base-sha", "head-sha")
            .await
            .unwrap();

        // Base/target orientation must not be swapped: the added file exists
        // only on the head (target) side, the removed file only on the base
        // side. Callers reuse `base`/`head` as `parentCommitId`/`commitId` in
        // a later per-file diff call and rely on this ordering.
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].filename, "src/new_file.rs");
        assert_eq!(files[0].status, "added");
        assert_eq!(files[1].filename, "src/old_file.rs");
        assert_eq!(files[1].status, "removed");
    }
}
