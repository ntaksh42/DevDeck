use serde::Deserialize;

/// The authenticated user, from `GET /user`.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthenticatedUser {
    pub login: String,
    pub id: u64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

/// A user reference embedded in other payloads (PR author, etc.).
#[derive(Debug, Clone, Deserialize)]
pub struct UserRef {
    pub login: String,
    #[serde(default)]
    pub id: Option<u64>,
}

/// Marker object present on search-issue items that are pull requests.
#[derive(Debug, Clone, Deserialize)]
pub struct PullRequestMarker {
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub merged_at: Option<String>,
}

/// A single item from `GET /search/issues`. When `pull_request` is present the
/// item is a pull request rather than a plain issue.
#[derive(Debug, Clone, Deserialize)]
pub struct IssueSearchItem {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    /// API URL of the repository, e.g.
    /// `https://api.github.com/repos/{owner}/{repo}`. Used to recover the
    /// owner/repo pair since search items do not embed a repository object.
    pub repository_url: String,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub draft: bool,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub pull_request: Option<PullRequestMarker>,
}

impl IssueSearchItem {
    /// Splits `repository_url` into `(owner, repo)`. Returns `None` when the URL
    /// does not have the expected `.../repos/{owner}/{repo}` shape.
    pub fn owner_repo(&self) -> Option<(&str, &str)> {
        let tail = self.repository_url.split("/repos/").nth(1)?;
        let mut parts = tail.split('/');
        let owner = parts.next().filter(|s| !s.is_empty())?;
        let repo = parts.next().filter(|s| !s.is_empty())?;
        Some((owner, repo))
    }
}

/// Response shape for `GET /search/issues`.
#[derive(Debug, Clone, Deserialize)]
pub struct IssueSearchResponse {
    pub total_count: u64,
    #[serde(default)]
    pub incomplete_results: bool,
    #[serde(default)]
    pub items: Vec<IssueSearchItem>,
}

/// A label on an issue.
#[derive(Debug, Clone, Deserialize)]
pub struct Label {
    pub name: String,
}

/// `GET /repos/{o}/{r}/issues/{n}` — full issue detail.
#[derive(Debug, Clone, Deserialize)]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub state: String,
    pub html_url: String,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub assignee: Option<UserRef>,
    #[serde(default)]
    pub assignees: Vec<UserRef>,
    #[serde(default)]
    pub labels: Vec<Label>,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// A repository reference embedded in commit-search items.
#[derive(Debug, Clone, Deserialize)]
pub struct RepoRef {
    pub name: String,
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub owner: Option<UserRef>,
    #[serde(default)]
    pub html_url: Option<String>,
}

/// Git author/committer identity inside a commit object.
#[derive(Debug, Clone, Deserialize)]
pub struct GitActor {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
}

/// The `commit` sub-object of a commit-search item.
#[derive(Debug, Clone, Deserialize)]
pub struct CommitDetail {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub author: Option<GitActor>,
}

/// A single item from `GET /search/commits`.
#[derive(Debug, Clone, Deserialize)]
pub struct CommitSearchItem {
    pub sha: String,
    pub html_url: String,
    pub commit: CommitDetail,
    #[serde(default)]
    pub repository: Option<RepoRef>,
}

/// Response shape for `GET /search/commits`.
#[derive(Debug, Clone, Deserialize)]
pub struct CommitSearchResponse {
    pub total_count: u64,
    #[serde(default)]
    pub incomplete_results: bool,
    #[serde(default)]
    pub items: Vec<CommitSearchItem>,
}

/// A single item from `GET /search/code`.
#[derive(Debug, Clone, Deserialize)]
pub struct CodeSearchItem {
    pub name: String,
    pub path: String,
    pub html_url: String,
    #[serde(default)]
    pub repository: Option<RepoRef>,
}

/// Response shape for `GET /search/code`.
#[derive(Debug, Clone, Deserialize)]
pub struct CodeSearchResponse {
    pub total_count: u64,
    #[serde(default)]
    pub incomplete_results: bool,
    #[serde(default)]
    pub items: Vec<CodeSearchItem>,
}

/// A git ref (branch) reference inside a pull request (`head` / `base`).
#[derive(Debug, Clone, Deserialize)]
pub struct GitRef {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
}

/// `GET /repos/{o}/{r}/pulls/{n}` — full pull request detail.
#[derive(Debug, Clone, Deserialize)]
pub struct PullRequestDetail {
    pub number: u64,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub state: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub merged: bool,
    pub html_url: String,
    pub created_at: String,
    #[serde(default)]
    pub user: Option<UserRef>,
    pub head: GitRef,
    pub base: GitRef,
    #[serde(default)]
    pub requested_reviewers: Vec<UserRef>,
}

/// An item from `GET /repos/{o}/{r}/pulls/{n}/reviews`.
#[derive(Debug, Clone, Deserialize)]
pub struct ReviewItem {
    pub id: u64,
    #[serde(default)]
    pub user: Option<UserRef>,
    /// APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
    pub state: String,
    #[serde(default)]
    pub submitted_at: Option<String>,
}

/// A conversation comment from `GET /repos/{o}/{r}/issues/{n}/comments`.
#[derive(Debug, Clone, Deserialize)]
pub struct IssueComment {
    pub id: u64,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub body: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub html_url: Option<String>,
}

/// An inline review comment from `GET /repos/{o}/{r}/pulls/{n}/comments`.
#[derive(Debug, Clone, Deserialize)]
pub struct ReviewComment {
    pub id: u64,
    #[serde(default)]
    pub user: Option<UserRef>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub line: Option<i64>,
    #[serde(default)]
    pub original_line: Option<i64>,
    #[serde(default)]
    pub side: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub in_reply_to_id: Option<u64>,
}

/// A changed file from `GET /repos/{o}/{r}/pulls/{n}/files`.
#[derive(Debug, Clone, Deserialize)]
pub struct PrFileItem {
    pub filename: String,
    pub status: String,
    #[serde(default)]
    pub previous_filename: Option<String>,
    #[serde(default)]
    pub patch: Option<String>,
}

/// A commit from `GET /repos/{o}/{r}/pulls/{n}/commits`.
#[derive(Debug, Clone, Deserialize)]
pub struct PrCommitItem {
    pub sha: String,
    pub html_url: String,
    pub commit: CommitDetail,
}

/// A parent reference inside a commit object.
#[derive(Debug, Clone, Deserialize)]
pub struct ParentRef {
    pub sha: String,
}

/// `GET /repos/{o}/{r}/commits/{sha}` — commit with its changed files.
#[derive(Debug, Clone, Deserialize)]
pub struct CommitWithFiles {
    pub sha: String,
    #[serde(default)]
    pub parents: Vec<ParentRef>,
    #[serde(default)]
    pub files: Vec<PrFileItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_repo_splits_api_url() {
        let item = IssueSearchItem {
            number: 1,
            title: "t".into(),
            state: "open".into(),
            html_url: "https://github.com/octo/hello/pull/1".into(),
            repository_url: "https://api.github.com/repos/octo/hello".into(),
            user: None,
            draft: false,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: None,
            pull_request: None,
        };
        assert_eq!(item.owner_repo(), Some(("octo", "hello")));
    }
}
