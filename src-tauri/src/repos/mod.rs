//! Repository and branch listings used by the PR search repository picker and
//! the pipeline run form.

mod cache;

use std::collections::HashSet;

use azdo_client::{AdoClient, GitRepository, TeamProject};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::auth::client_for_organization;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::secrets::SecretStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRepositoriesInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryOption {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBranchesInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranch {
    /// Short branch name, e.g. `main` (the `refs/heads/` prefix is stripped).
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub struct RepoService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl RepoService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    /// Lists every repository across the organization's projects, sorted by
    /// project then repository name. A project whose listing fails is skipped
    /// so one inaccessible project does not empty the picker.
    pub async fn list_repositories(
        &self,
        input: ListRepositoriesInput,
    ) -> Result<Vec<RepositoryOption>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let projects = client.list_projects().await?;

        let mut tasks: JoinSet<(TeamProject, Result<Vec<GitRepository>>)> = JoinSet::new();
        for project in projects {
            let client = client.clone();
            let db_key = self.db.cache_key();
            let org_id = organization.id.clone();
            tasks.spawn(async move {
                let repos = project_repositories(&client, &db_key, &org_id, &project.id).await;
                (project, repos)
            });
        }

        let mut options = Vec::new();
        while let Some(joined) = tasks.join_next().await {
            let Ok((project, repos)) = joined else {
                continue;
            };
            match repos {
                Ok(repos) => options.extend(repos.into_iter().map(|repo| RepositoryOption {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    repository_id: repo.id,
                    repository_name: repo.name,
                })),
                Err(e) => tracing::warn!(
                    project = %project.name,
                    error = %e,
                    "failed to list repositories, skipping project"
                ),
            }
        }
        options.sort_by(|a, b| {
            a.project_name
                .cmp(&b.project_name)
                .then_with(|| a.repository_name.cmp(&b.repository_name))
        });
        Ok(options)
    }

    /// Lists a repository's branches, default branch first.
    pub async fn list_branches(&self, input: ListBranchesInput) -> Result<Vec<RepoBranch>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        // The refs API does not report which branch is the default, so resolve
        // the repository's `defaultBranch` (a `refs/heads/...` ref) separately.
        let default_ref = project_repositories(
            &client,
            &self.db.cache_key(),
            &organization.id,
            &input.project,
        )
        .await?
        .into_iter()
        .find(|repo| repo.id == input.repository || repo.name == input.repository)
        .and_then(|repo| repo.default_branch);

        let mut branches: Vec<RepoBranch> = client
            .list_branches(&input.project, &input.repository)
            .await?
            .into_iter()
            .map(|git_ref| {
                let is_default = default_ref.as_deref() == Some(git_ref.name.as_str());
                RepoBranch {
                    name: strip_heads_prefix(&git_ref.name).to_string(),
                    is_default,
                }
            })
            .collect();
        // Default branch first, then alphabetical for stable, scannable order.
        branches.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));
        Ok(branches)
    }
}

async fn project_repositories(
    client: &AdoClient,
    db_key: &str,
    org_id: &str,
    project: &str,
) -> Result<Vec<GitRepository>> {
    if let Some(repos) = cache::get(db_key, org_id, project) {
        return Ok(repos);
    }
    let repos = client.list_repositories(project).await?;
    cache::put(db_key, org_id, project, &repos);
    Ok(repos)
}

/// Projects owning the given repositories, as far as the repository cache
/// knows. Empty when none of them have been listed recently.
pub(crate) fn cached_owning_project_ids(
    db: &AppDatabase,
    org_id: &str,
    repository_ids: &HashSet<String>,
) -> HashSet<String> {
    cache::owning_project_ids(&db.cache_key(), org_id, repository_ids)
}

fn strip_heads_prefix(ref_name: &str) -> &str {
    ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name)
}

/// Percent-encodes one URL path segment (project or repository name) for
/// Azure DevOps web links.
pub(crate) fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_heads_prefix_shortens_branch() {
        assert_eq!(strip_heads_prefix("refs/heads/main"), "main");
        assert_eq!(strip_heads_prefix("refs/heads/feature/x"), "feature/x");
        assert_eq!(strip_heads_prefix("main"), "main");
    }

    #[test]
    fn encode_path_segment_escapes_reserved_bytes() {
        assert_eq!(encode_path_segment("My Project"), "My%20Project");
        assert_eq!(encode_path_segment("a/b#c"), "a%2Fb%23c");
        assert_eq!(encode_path_segment("repo-1.x_~"), "repo-1.x_~");
    }
}
