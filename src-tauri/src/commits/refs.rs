//! Which branches and tags contain a commit (Azure DevOps Web's "Branches /
//! Tags" on the commit page).
//!
//! Azure DevOps has no "refs containing this commit" endpoint, so each candidate
//! ref is checked with the Diffs API: a ref contains the commit exactly when the
//! merge base of the ref and the commit is the commit itself.

use std::sync::Arc;

use azdo_client::{AdoClient, GitVersionType};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::CommitService;
use crate::auth::client_for_organization;
use crate::error::Result;

/// Refs checked per commit. Beyond this the result reports how many of the
/// repository's refs were actually checked.
const MAX_BRANCHES_CHECKED: usize = 30;
const MAX_TAGS_CHECKED: usize = 20;
/// Concurrent merge-base requests for one commit.
const CHECK_CONCURRENCY: usize = 6;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitContainingRefsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub commit_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitContainingRefs {
    pub branches: Vec<String>,
    pub tags: Vec<String>,
    /// Refs whose ancestry was checked.
    pub checked: usize,
    /// Refs the repository has; `checked < total` means the list may be partial.
    pub total: usize,
}

fn short_name<'a>(full: &'a str, prefix: &str) -> &'a str {
    full.strip_prefix(prefix).unwrap_or(full)
}

/// Whether the merge base reported by the Diffs API shows `commit_id` is
/// reachable from the ref.
fn contains_commit(common_commit: Option<&str>, commit_id: &str) -> bool {
    common_commit.is_some_and(|common| common.eq_ignore_ascii_case(commit_id))
}

async fn ref_contains(
    client: AdoClient,
    project_id: String,
    repository_id: String,
    kind: GitVersionType,
    name: String,
    commit_id: String,
) -> Option<(GitVersionType, String)> {
    match client
        .compare_revisions(
            &project_id,
            &repository_id,
            (kind, &name),
            (GitVersionType::Commit, &commit_id),
            1,
        )
        .await
    {
        Ok(diffs) if contains_commit(diffs.common_commit.as_deref(), &commit_id) => {
            Some((kind, name))
        }
        Ok(_) => None,
        Err(error) => {
            tracing::warn!(%error, ref_name = %name, "failed to check whether a ref contains the commit");
            None
        }
    }
}

impl CommitService {
    pub async fn get_commit_containing_refs(
        &self,
        input: GetCommitContainingRefsInput,
    ) -> Result<CommitContainingRefs> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        find_containing_refs(
            &client,
            &input.project_id,
            &input.repository_id,
            &input.commit_id,
        )
        .await
    }
}

/// Checks the repository's branches and tags (up to the caps above) for ones
/// that contain `commit_id`.
pub(super) async fn find_containing_refs(
    client: &AdoClient,
    project_id: &str,
    repository_id: &str,
    commit_id: &str,
) -> Result<CommitContainingRefs> {
    let mut branches: Vec<String> = client
        .list_branches(project_id, repository_id)
        .await?
        .into_iter()
        .map(|r| short_name(&r.name, "refs/heads/").to_string())
        .collect();
    let mut tags: Vec<String> = client
        .list_tags(project_id, repository_id)
        .await?
        .into_iter()
        .map(|r| short_name(&r.name, "refs/tags/").to_string())
        .collect();
    branches.sort();
    tags.sort_by(|a, b| b.cmp(a));
    let total = branches.len() + tags.len();

    let candidates: Vec<(GitVersionType, String)> = branches
        .into_iter()
        .take(MAX_BRANCHES_CHECKED)
        .map(|name| (GitVersionType::Branch, name))
        .chain(
            tags.into_iter()
                .take(MAX_TAGS_CHECKED)
                .map(|name| (GitVersionType::Tag, name)),
        )
        .collect();
    let checked = candidates.len();

    let limit = Arc::new(Semaphore::new(CHECK_CONCURRENCY));
    let mut tasks = JoinSet::new();
    for (kind, name) in candidates {
        let client = client.clone();
        let limit = limit.clone();
        let (project_id, repository_id, commit_id) = (
            project_id.to_string(),
            repository_id.to_string(),
            commit_id.to_string(),
        );
        tasks.spawn(async move {
            let _permit = limit.acquire_owned().await.ok()?;
            ref_contains(client, project_id, repository_id, kind, name, commit_id).await
        });
    }

    let mut containing_branches = Vec::new();
    let mut containing_tags = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        if let Ok(Some((kind, name))) = joined {
            match kind {
                GitVersionType::Tag => containing_tags.push(name),
                _ => containing_branches.push(name),
            }
        }
    }
    containing_branches.sort();
    containing_tags.sort_by(|a, b| b.cmp(a));
    Ok(CommitContainingRefs {
        branches: containing_branches,
        tags: containing_tags,
        checked,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_name_strips_only_the_expected_prefix() {
        assert_eq!(
            short_name("refs/heads/feature/x", "refs/heads/"),
            "feature/x"
        );
        assert_eq!(short_name("refs/tags/v1", "refs/tags/"), "v1");
        assert_eq!(short_name("other", "refs/heads/"), "other");
    }

    #[test]
    fn a_ref_contains_the_commit_only_when_the_merge_base_is_the_commit() {
        assert!(contains_commit(Some("ABC123"), "abc123"));
        assert!(!contains_commit(Some("def456"), "abc123"));
        assert!(!contains_commit(None, "abc123"));
    }

    #[tokio::test]
    async fn finds_the_branches_and_tags_whose_merge_base_is_the_commit() {
        use std::sync::Arc;

        use azdo_client::PatProvider;
        use serde_json::json;
        use url::Url;
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let refs_path = "/p1/_apis/git/repositories/r1/refs";
        Mock::given(method("GET"))
            .and(path(refs_path))
            .and(query_param("filter", "heads/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 2,
                "value": [
                    { "name": "refs/heads/main", "objectId": "a" },
                    { "name": "refs/heads/old", "objectId": "b" }
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(refs_path))
            .and(query_param("filter", "tags/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "name": "refs/tags/v1", "objectId": "c" }]
            })))
            .mount(&server)
            .await;
        let diffs = "/p1/_apis/git/repositories/r1/diffs/commits";
        for (version, kind, merge_base) in [
            ("main", "branch", "abc123"),
            ("old", "branch", "ffffff"),
            ("v1", "tag", "ABC123"),
        ] {
            Mock::given(method("GET"))
                .and(path(diffs))
                .and(query_param("baseVersion", version))
                .and(query_param("baseVersionType", kind))
                .and(query_param("targetVersion", "abc123"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "changes": [],
                    "allChangesIncluded": true,
                    "commonCommit": merge_base
                })))
                .mount(&server)
                .await;
        }
        let client = AdoClient::new("org", Arc::new(PatProvider::new("pat")))
            .unwrap()
            .with_base_url(Url::parse(&format!("{}/", server.uri())).unwrap());

        let result = find_containing_refs(&client, "p1", "r1", "abc123")
            .await
            .unwrap();

        assert_eq!(result.branches, vec!["main".to_string()]);
        assert_eq!(result.tags, vec!["v1".to_string()]);
        assert_eq!((result.checked, result.total), (3, 3));
    }
}
