//! Commit requests (list, PR / work item links, changes, diffs), split from
//! `requests.rs` to keep files under 500 lines.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::client::AdoClient;
use crate::error::Result;
use crate::pr_review::GitChangeEntry;

use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitChangesResponse {
    #[serde(default)]
    changes: Vec<GitChangeEntry>,
}

/// Response from the Diffs API (`GitCommitDiffs`). Only `changes` is used; the
/// rest (`aheadCount`, `changeCounts`, ...) is not needed here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitDiffsResponse {
    #[serde(default)]
    changes: Vec<GitChangeEntry>,
}

/// Request body for the Pull Request Query API. Looks up pull requests by the
/// commits they contain (`type: "commit"`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestQuery<'a> {
    queries: Vec<PullRequestQueryInput<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestQueryInput<'a> {
    items: Vec<&'a str>,
    #[serde(rename = "type")]
    query_type: &'a str,
}

/// Body of `commitsbatch` asking for one commit together with its linked work
/// items.
#[derive(Debug, Serialize)]
struct CommitsBatchQuery<'a> {
    ids: Vec<&'a str>,
    #[serde(rename = "includeWorkItems")]
    include_work_items: bool,
    #[serde(rename = "$top")]
    top: u32,
}

#[derive(Debug, Deserialize)]
struct CommitWithWorkItems {
    #[serde(rename = "workItems", default)]
    work_items: Vec<WorkItemResourceRef>,
}

#[derive(Debug, Deserialize)]
struct WorkItemResourceRef {
    /// Work item ids arrive as strings in resource refs.
    id: Option<String>,
}

/// Response from the Pull Request Query API. Each entry in `results` maps the
/// queried commit id to the pull requests that contain it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestQueryResponse {
    #[serde(default)]
    results: Vec<HashMap<String, Vec<GitPullRequest>>>,
}

impl AdoClient {
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
        if let Some(item_path) = criteria.item_path.filter(|value| !value.trim().is_empty()) {
            query.push(("searchCriteria.itemPath", item_path));
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
    /// Repository-scoped (no project segment). Azure DevOps has no
    /// `commits/{commitId}/pullRequests` route, so this uses the Pull Request
    /// Query API: `POST /_apis/git/repositories/{repoId}/pullrequestquery`.
    pub async fn list_commit_pull_requests(
        &self,
        repository_id: &str,
        commit_id: &str,
    ) -> Result<Vec<GitPullRequest>> {
        let mut by_commit = self
            .list_pull_requests_for_commits(repository_id, &[commit_id])
            .await?;
        Ok(by_commit.remove(commit_id).unwrap_or_default())
    }

    /// The pull requests containing each of `commit_ids`, in one Pull Request
    /// Query call. Commits in no PR are absent from the map.
    pub async fn list_pull_requests_for_commits(
        &self,
        repository_id: &str,
        commit_ids: &[&str],
    ) -> Result<HashMap<String, Vec<GitPullRequest>>> {
        let path = format!("_apis/git/repositories/{repository_id}/pullrequestquery");
        let body = PullRequestQuery {
            queries: vec![PullRequestQueryInput {
                items: commit_ids.to_vec(),
                query_type: "commit",
            }],
        };
        let response: PullRequestQueryResponse = self
            .post_json_read(&path, &[("api-version", "7.1-preview")], &body)
            .await?;
        let mut merged: HashMap<String, Vec<GitPullRequest>> = HashMap::new();
        for result in response.results {
            for (commit_id, prs) in result {
                merged.entry(commit_id).or_default().extend(prs);
            }
        }
        Ok(merged)
    }

    /// The ids of the work items linked to a commit (Commits - Get Commits Batch
    /// with `includeWorkItems`).
    pub async fn list_commit_work_item_ids(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
    ) -> Result<Vec<i64>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/commitsbatch");
        let body = CommitsBatchQuery {
            ids: vec![commit_id],
            include_work_items: true,
            top: 1,
        };
        let response: ListResponse<CommitWithWorkItems> = self
            .post_json_read(&path, &[("api-version", "7.1-preview")], &body)
            .await?;
        let mut ids: Vec<i64> = response
            .value
            .into_iter()
            .flat_map(|commit| commit.work_items)
            .filter_map(|reference| reference.id?.parse().ok())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        Ok(ids)
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

    /// Diffs an arbitrary base/target commit pair via the Diffs API. The
    /// `commits/{id}/changes` endpoint above always compares against the
    /// commit's default parent, so a merge commit needs this instead to show
    /// changes relative to a non-default parent.
    pub async fn get_commit_diffs(
        &self,
        project_id: &str,
        repository_id: &str,
        base_commit_id: &str,
        target_commit_id: &str,
    ) -> Result<Vec<GitChangeEntry>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/diffs/commits");
        let response: GitCommitDiffsResponse = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1-preview"),
                    ("baseVersion", base_commit_id),
                    ("baseVersionType", "commit"),
                    ("targetVersion", target_commit_id),
                    ("targetVersionType", "commit"),
                ],
            )
            .await?;
        Ok(response.changes)
    }
}
