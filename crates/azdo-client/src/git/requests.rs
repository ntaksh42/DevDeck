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

/// Response from the Pull Request Query API. Each entry in `results` maps the
/// queried commit id to the pull requests that contain it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestQueryResponse {
    #[serde(default)]
    results: Vec<HashMap<String, Vec<GitPullRequest>>>,
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

    /// Lists the branch refs (`refs/heads/*`) of a repository.
    pub async fn list_branches(
        &self,
        project_id: &str,
        repository_id: &str,
    ) -> Result<Vec<GitRef>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/refs");
        let response: ListResponse<GitRef> = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("filter", "heads/")],
            )
            .await?;
        Ok(response.value)
    }

    /// Lists the direct children (one level) of a folder at the tip of a branch.
    /// `scope_path` is the folder to list, e.g. `/` or `/src`. When
    /// `include_latest_commit` is set, each item carries its last commit via
    /// `latestProcessedChange` (one extra server-side join, no per-item calls).
    pub async fn list_items(
        &self,
        project_id: &str,
        repository_id: &str,
        branch: &str,
        scope_path: &str,
        include_latest_commit: bool,
    ) -> Result<Vec<GitItem>> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/items");
        let mut params: Vec<(&str, &str)> = vec![
            ("api-version", "7.1-preview"),
            ("scopePath", scope_path),
            ("recursionLevel", "OneLevel"),
            ("versionDescriptor.versionType", "branch"),
            ("versionDescriptor.version", branch),
        ];
        if include_latest_commit {
            params.push(("latestProcessedChange", "true"));
        }
        let response: ListResponse<GitItem> = self.get_json(&path, &params).await?;
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

    /// Lists pull requests across a project with optional server-side filtering
    /// by target branch and a creation/close date window. `time_range_type`
    /// selects which date `min_time`/`max_time` bound (`"created"` or
    /// `"closed"`). Used by on-demand PR search; sync keeps using the simpler
    /// [`list_project_pull_requests`].
    #[allow(clippy::too_many_arguments)]
    pub async fn search_project_pull_requests(
        &self,
        project_id: &str,
        status: PullRequestStatus,
        target_ref_name: Option<&str>,
        min_time: Option<&str>,
        max_time: Option<&str>,
        time_range_type: Option<&str>,
        top: u32,
    ) -> Result<Vec<GitPullRequest>> {
        let path = format!("{project_id}/_apis/git/pullrequests");
        let top_str = top.to_string();
        let mut params: Vec<(&str, &str)> = vec![
            ("api-version", "7.1-preview"),
            ("searchCriteria.status", status.as_query_value()),
            ("$top", top_str.as_str()),
        ];
        if let Some(target) = target_ref_name {
            params.push(("searchCriteria.targetRefName", target));
        }
        // queryTimeRangeType must accompany a bound for the window to apply.
        if min_time.is_some() || max_time.is_some() {
            params.push((
                "searchCriteria.queryTimeRangeType",
                time_range_type.unwrap_or("created"),
            ));
        }
        if let Some(min) = min_time {
            params.push(("searchCriteria.minTime", min));
        }
        if let Some(max) = max_time {
            params.push(("searchCriteria.maxTime", max));
        }
        let response: ListResponse<GitPullRequest> = self.get_json(&path, &params).await?;
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

    /// Lists every active PR where `creator_id` is the author, paging through the
    /// result set with `$skip`/`$top` so projects with more authored PRs than a
    /// single page (`page_size`) are returned in full rather than being silently
    /// truncated. Mirrors [`list_pull_requests_by_reviewer`] but filters on
    /// `searchCriteria.creatorId` instead of the reviewer id.
    pub async fn list_pull_requests_by_creator(
        &self,
        project_id: &str,
        creator_id: &str,
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
                        ("searchCriteria.creatorId", creator_id),
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
        let path = format!("_apis/git/repositories/{repository_id}/pullrequestquery");
        let body = PullRequestQuery {
            queries: vec![PullRequestQueryInput {
                items: vec![commit_id],
                query_type: "commit",
            }],
        };
        let response: PullRequestQueryResponse = self
            .post_json(&path, &[("api-version", "7.1-preview")], &body)
            .await?;
        let prs = response
            .results
            .into_iter()
            .flat_map(|mut result| result.remove(commit_id).unwrap_or_default())
            .collect();
        Ok(prs)
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
