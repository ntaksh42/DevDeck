//! Stable REST endpoints used by the command palette's live search.
use super::{GitPullRequest, ListResponse};
use crate::{
    client::AdoClient,
    error::{AdoError, Result},
};

impl AdoClient {
    /// PR numbers are organization-wide, so neither project nor repository is needed.
    pub async fn get_pull_request_by_id(&self, id: i64) -> Result<Option<GitPullRequest>> {
        match self
            .get_json(
                &format!("_apis/git/pullrequests/{id}"),
                &[("api-version", "7.1")],
            )
            .await
        {
            Ok(pr) => Ok(Some(pr)),
            Err(AdoError::Api { status: 404, .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Page until empty: Azure DevOps can return fewer rows than the requested page size.
    pub async fn list_palette_active_pull_requests(
        &self,
        project_id: &str,
    ) -> Result<Vec<GitPullRequest>> {
        let mut all = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut skip = 0;
        for _ in 0..200 {
            let response: ListResponse<GitPullRequest> = self
                .get_json(
                    &format!("{project_id}/_apis/git/pullrequests"),
                    &[
                        ("api-version", "7.1"),
                        ("searchCriteria.status", "active"),
                        ("$top", "200"),
                        ("$skip", &skip.to_string()),
                    ],
                )
                .await?;
            if response.value.is_empty() {
                return Ok(all);
            }
            skip += response.value.len();
            for pr in response.value {
                if seen.insert(pr.pull_request_id) {
                    all.push(pr);
                }
            }
        }
        Err(AdoError::api(
            502,
            "Active PR paging limit reached; search is incomplete".into(),
        ))
    }
}

#[cfg(test)]
mod tests;
