use std::sync::Arc;

use azdo_client::{AdoClient, CommitSearchCriteria, GitCommitRef, PatProvider};
use serde::{Deserialize, Serialize};

use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCommitsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub author: Option<String>,
    pub branch: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub author_date: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CommitService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl CommitService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn search(&self, input: SearchCommitsInput) -> Result<Vec<CommitSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        if organization.auth_provider != "pat" {
            return Err(AppError::InvalidInput(format!(
                "unsupported auth provider: {}",
                organization.auth_provider
            )));
        }

        let pat = self.secrets.get_pat(&organization.credential_key)?;
        let client = AdoClient::new(&organization.name, Arc::new(PatProvider::new(pat)))?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            let repositories = client.list_repositories(&project.id).await?;
            for repository in repositories {
                let commits = client
                    .list_commits(
                        &project.id,
                        &repository.id,
                        CommitSearchCriteria {
                            author: normalize_optional(input.author.clone()),
                            branch: normalize_optional(input.branch.clone()),
                            from_date: normalize_optional(input.from_date.clone()),
                            to_date: normalize_optional(input.to_date.clone()),
                            top: Some(50),
                        },
                    )
                    .await?;
                for commit in commits {
                    let summary = summarize_commit(
                        &organization,
                        &project.id,
                        &project.name,
                        &repository.id,
                        &repository.name,
                        commit,
                    );
                    if matches_query(&summary, &query) {
                        results.push(summary);
                    }
                }
            }
        }

        results.sort_by(|a, b| b.author_date.cmp(&a.author_date));
        results.truncate(100);
        Ok(results)
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        if let Some(id) = id {
            return self
                .db
                .get_organization(id)?
                .ok_or_else(|| AppError::InvalidInput(format!("organization not found: {id}")));
        }

        self.db
            .list_organizations()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::InvalidInput("no organization is configured".to_string()))
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn summarize_commit(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    repository_id: &str,
    repository_name: &str,
    commit: GitCommitRef,
) -> CommitSummary {
    let author_name = commit
        .author
        .as_ref()
        .and_then(|author| author.name.clone());
    let author_email = commit
        .author
        .as_ref()
        .and_then(|author| author.email.clone());
    let author_date = commit
        .author
        .as_ref()
        .and_then(|author| author.date.map(|date| date.to_rfc3339()));

    CommitSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        repository_id: repository_id.to_string(),
        repository_name: repository_name.to_string(),
        short_commit_id: commit.commit_id.chars().take(8).collect(),
        commit_id: commit.commit_id,
        comment: commit.comment.unwrap_or_else(|| "(no comment)".to_string()),
        author_name,
        author_email,
        author_date,
        web_url: commit.remote_url.or(commit.url),
    }
}

fn matches_query(summary: &CommitSummary, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }

    [
        summary.comment.as_str(),
        summary.project_name.as_str(),
        summary.repository_name.as_str(),
        summary.author_name.as_deref().unwrap_or_default(),
        summary.author_email.as_deref().unwrap_or_default(),
        summary.commit_id.as_str(),
    ]
    .iter()
    .any(|value| value.to_ascii_lowercase().contains(query))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use azdo_client::GitUserDate;

    #[test]
    fn normalize_optional_trims_empty_values() {
        assert_eq!(
            normalize_optional(Some(" main ".to_string())),
            Some("main".to_string())
        );
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
    }

    #[test]
    fn summarize_commit_maps_author_and_short_id() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };

        let summary = summarize_commit(
            &organization,
            "project-1",
            "Platform",
            "repo-1",
            "azdo-dashboard",
            GitCommitRef {
                commit_id: "abcdef123456".to_string(),
                comment: Some("Add commits".to_string()),
                author: Some(GitUserDate {
                    name: Some("Test User".to_string()),
                    email: Some("test@example.com".to_string()),
                    date: Some(Utc.with_ymd_and_hms(2026, 5, 24, 0, 0, 0).unwrap()),
                }),
                committer: None,
                remote_url: Some("https://example.test/commit".to_string()),
                url: None,
            },
        );

        assert_eq!(summary.short_commit_id, "abcdef12");
        assert_eq!(summary.author_name.as_deref(), Some("Test User"));
        assert!(matches_query(&summary, "commits"));
    }
}
