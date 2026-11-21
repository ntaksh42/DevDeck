//! A single, resumable PR search page. The caller owns traversal and its budget.
use super::{GitPullRequest, ListResponse, PullRequestStatus};
use crate::{client::AdoClient, error::Result};

#[derive(Debug)]
pub struct PullRequestPageCriteria<'a> {
    pub project: Option<&'a str>,
    pub repository: Option<&'a str>,
    pub status: PullRequestStatus,
    pub author: Option<&'a str>,
    pub reviewer: Option<&'a str>,
    pub target: Option<&'a str>,
    pub min_time: Option<&'a str>,
    pub max_time: Option<&'a str>,
    pub date_basis: &'a str,
    pub skip: u32,
    pub top: u32,
}

impl AdoClient {
    pub async fn search_pull_request_page(
        &self,
        criteria: &PullRequestPageCriteria<'_>,
    ) -> Result<Vec<GitPullRequest>> {
        let prefix = criteria
            .project
            .map(|p| format!("{p}/"))
            .unwrap_or_default();
        let path = match criteria.repository {
            Some(repo) => format!("{prefix}_apis/git/repositories/{repo}/pullrequests"),
            None => format!("{prefix}_apis/git/pullrequests"),
        };
        let skip = criteria.skip.to_string();
        let top = criteria.top.to_string();
        let mut params = vec![
            ("api-version", "7.1"),
            ("searchCriteria.status", criteria.status.as_query_value()),
            ("$skip", skip.as_str()),
            ("$top", top.as_str()),
        ];
        for (key, value) in [
            ("searchCriteria.creatorId", criteria.author),
            ("searchCriteria.reviewerId", criteria.reviewer),
            ("searchCriteria.targetRefName", criteria.target),
            ("searchCriteria.minTime", criteria.min_time),
            ("searchCriteria.maxTime", criteria.max_time),
        ] {
            if let Some(value) = value {
                params.push((key, value));
            }
        }
        if criteria.min_time.is_some() || criteria.max_time.is_some() {
            params.push(("searchCriteria.queryTimeRangeType", criteria.date_basis));
        }
        let response: ListResponse<GitPullRequest> = self.get_json(&path, &params).await?;
        Ok(response.value)
    }
}
