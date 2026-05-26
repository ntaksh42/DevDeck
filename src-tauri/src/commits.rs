use azdo_client::{CommitSearchCriteria, GitCommitRef};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
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
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCommitRepositoriesInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitRepositoryOption {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
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
        let client = client_for_organization(&organization, &self.secrets)?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let author = normalize_optional(input.author);
        let branch = normalize_branch(input.branch);
        let from_date = normalize_date(input.from_date.as_deref(), false)?;
        let to_date = normalize_date(input.to_date.as_deref(), true)?;
        if let (Some(from_date), Some(to_date)) = (&from_date, &to_date) {
            if from_date > to_date {
                return Err(AppError::InvalidInput(
                    "from date must be before or equal to to date".to_string(),
                ));
            }
        }
        let project_filter = normalize_optional(input.project_id);
        let repository_filter = normalize_optional(input.repository_id);

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            if !matches_optional_filter(&project.id, project_filter.as_deref()) {
                continue;
            }
            let repositories = client.list_repositories(&project.id).await?;
            for repository in repositories {
                if !matches_optional_filter(&repository.id, repository_filter.as_deref()) {
                    continue;
                }
                let commits = client
                    .list_commits(
                        &project.id,
                        &repository.id,
                        CommitSearchCriteria {
                            author: author.clone(),
                            branch: branch.clone(),
                            from_date: from_date.as_ref().map(DateTime::to_rfc3339),
                            to_date: to_date.as_ref().map(DateTime::to_rfc3339),
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

        results.sort_by(|a, b| {
            b.author_date
                .cmp(&a.author_date)
                .then_with(|| a.repository_name.cmp(&b.repository_name))
                .then_with(|| a.commit_id.cmp(&b.commit_id))
        });
        results.truncate(100);
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            "commit search completed"
        );
        Ok(results)
    }

    pub async fn list_repositories(
        &self,
        input: ListCommitRepositoriesInput,
    ) -> Result<Vec<CommitRepositoryOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let mut results = Vec::new();
        for project in client.list_projects().await? {
            let repositories = client.list_repositories(&project.id).await?;
            for repository in repositories {
                results.push(CommitRepositoryOption {
                    project_id: project.id.clone(),
                    project_name: project.name.clone(),
                    repository_id: repository.id,
                    repository_name: repository.name,
                });
            }
        }
        results.sort_by(|a, b| {
            a.project_name
                .cmp(&b.project_name)
                .then_with(|| a.repository_name.cmp(&b.repository_name))
        });
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

fn normalize_branch(value: Option<String>) -> Option<String> {
    normalize_optional(value).map(|value| {
        value
            .strip_prefix("refs/heads/")
            .unwrap_or(&value)
            .to_string()
    })
}

fn normalize_date(value: Option<&str>, end_of_day: bool) -> Result<Option<DateTime<Utc>>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let time = if end_of_day {
            date.and_hms_opt(23, 59, 59)
        } else {
            date.and_hms_opt(0, 0, 0)
        }
        .expect("valid date time");
        return Ok(Some(DateTime::<Utc>::from_naive_utc_and_offset(time, Utc)));
    }

    DateTime::parse_from_rfc3339(value)
        .map(|date| Some(date.with_timezone(&Utc)))
        .map_err(|_| AppError::InvalidInput(format!("invalid commit date: {value}")))
}

fn matches_optional_filter(value: &str, filter: Option<&str>) -> bool {
    filter.is_none_or(|filter| filter == value)
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

    let commit_id = commit.commit_id;
    let web_url = commit.remote_url.or(commit.url).or_else(|| {
        Some(commit_web_url(
            organization,
            project_name,
            repository_name,
            &commit_id,
        ))
    });

    CommitSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        repository_id: repository_id.to_string(),
        repository_name: repository_name.to_string(),
        short_commit_id: commit_id.chars().take(8).collect(),
        commit_id,
        comment: commit.comment.unwrap_or_else(|| "(no comment)".to_string()),
        author_name,
        author_email,
        author_date,
        web_url,
    }
}

fn commit_web_url(
    organization: &Organization,
    project_name: &str,
    repository_name: &str,
    commit_id: &str,
) -> String {
    format!(
        "{}/{}/_git/{}/commit/{}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        encode_path_segment(repository_name),
        commit_id
    )
}

fn encode_path_segment(value: &str) -> String {
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
    fn normalize_branch_strips_heads_prefix() {
        assert_eq!(
            normalize_branch(Some(" refs/heads/main ".to_string())),
            Some("main".to_string())
        );
        assert_eq!(
            normalize_branch(Some("release/1.0".to_string())),
            Some("release/1.0".to_string())
        );
    }

    #[test]
    fn normalize_date_expands_date_only_values() {
        assert_eq!(
            normalize_date(Some("2026-05-24"), false)
                .unwrap()
                .unwrap()
                .to_rfc3339(),
            "2026-05-24T00:00:00+00:00"
        );
        assert_eq!(
            normalize_date(Some("2026-05-24"), true)
                .unwrap()
                .unwrap()
                .to_rfc3339(),
            "2026-05-24T23:59:59+00:00"
        );
        assert!(normalize_date(Some("24/05/2026"), false).is_err());
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

    #[test]
    fn summarize_commit_generates_web_url_when_api_url_is_missing() {
        let organization = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: Some("contoso".to_string()),
            base_url: "https://dev.azure.com/contoso/".to_string(),
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
            "Platform Team",
            "repo-1",
            "azdo dashboard",
            GitCommitRef {
                commit_id: "abcdef123456".to_string(),
                comment: None,
                author: None,
                committer: None,
                remote_url: None,
                url: None,
            },
        );

        assert_eq!(
            summary.web_url.as_deref(),
            Some("https://dev.azure.com/contoso/Platform%20Team/_git/azdo%20dashboard/commit/abcdef123456")
        );
    }
}
