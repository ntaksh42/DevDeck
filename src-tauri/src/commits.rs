use azdo_client::{AdoClient, CommitSearchCriteria, GitCommitRef, GitRepository, TeamProject};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::db::{AppDatabase, CachedCommit, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const COMMIT_SYNC_CONCURRENCY: usize = 4;
type CommitSyncTaskResult = Result<Option<(String, Vec<CachedCommit>)>>;

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
    #[allow(dead_code)]
    secrets: SecretStore,
}

impl CommitService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn search(&self, input: SearchCommitsInput) -> Result<Vec<CommitSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let author = normalize_optional(input.author);
        // branch はキャッシュに未対応(sync はデフォルトブランチのみ取得)。
        let _ = input.branch;
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

        let from_rfc = from_date.as_ref().map(DateTime::to_rfc3339);
        let to_rfc = to_date.as_ref().map(DateTime::to_rfc3339);

        let cached = if query.is_empty() {
            // SQL 側で日付・リポジトリ絞り込み済み
            self.db.search_commits(
                &organization.id,
                repository_filter.as_deref(),
                None,
                from_rfc.as_deref(),
                to_rfc.as_deref(),
            )?
        } else {
            // FTS は日付絞り込み非対応なので in-memory でフィルタする
            let mut rows = self.db.search_commits_fts(
                &organization.id,
                &query,
                repository_filter.as_deref(),
            )?;
            rows.retain(|c| {
                from_rfc
                    .as_deref()
                    .is_none_or(|f| c.author_date.as_deref().is_some_and(|d| d >= f))
                    && to_rfc
                        .as_deref()
                        .is_none_or(|t| c.author_date.as_deref().is_some_and(|d| d <= t))
            });
            rows
        };

        let mut results: Vec<CommitSummary> = cached
            .into_iter()
            .filter(|c| {
                project_filter.as_deref().is_none_or(|p| c.project_id == p)
                    && author.as_deref().is_none_or(|a| {
                        let al = a.to_ascii_lowercase();
                        c.author_name
                            .as_deref()
                            .is_some_and(|n| n.to_ascii_lowercase().contains(&al))
                            || c.author_email
                                .as_deref()
                                .is_some_and(|e| e.to_ascii_lowercase().contains(&al))
                    })
            })
            .map(cached_commit_to_summary)
            .collect();

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

    pub fn list_repositories(
        &self,
        input: ListCommitRepositoriesInput,
    ) -> Result<Vec<CommitRepositoryOption>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let mut results: Vec<CommitRepositoryOption> = self
            .db
            .list_commit_repositories(&organization.id)?
            .into_iter()
            .map(|r| CommitRepositoryOption {
                project_id: r.project_id,
                project_name: r.project_name,
                repository_id: r.repository_id,
                repository_name: r.repository_name,
            })
            .collect();
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

fn cached_commit_to_summary(c: CachedCommit) -> CommitSummary {
    let short_commit_id = c.commit_id.chars().take(8).collect();
    CommitSummary {
        organization_id: c.org_id,
        project_id: c.project_id,
        project_name: c.project_name,
        repository_id: c.repository_id,
        repository_name: c.repository_name,
        short_commit_id,
        commit_id: c.commit_id,
        comment: c.comment,
        author_name: c.author_name,
        author_email: c.author_email,
        author_date: c.author_date,
        web_url: c.web_url,
    }
}

fn commit_to_cached(
    org: &Organization,
    project_id: &str,
    project_name: &str,
    repository_id: &str,
    repository_name: &str,
    commit: GitCommitRef,
) -> CachedCommit {
    let author_name = commit.author.as_ref().and_then(|a| a.name.clone());
    let author_email = commit.author.as_ref().and_then(|a| a.email.clone());
    let author_date = commit
        .author
        .as_ref()
        .and_then(|a| a.date.map(|d| d.to_rfc3339()));
    let commit_id = commit.commit_id;
    let web_url = commit.remote_url.or(commit.url).or_else(|| {
        Some(commit_web_url(
            org,
            project_name,
            repository_name,
            &commit_id,
        ))
    });
    CachedCommit {
        org_id: org.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        repository_id: repository_id.to_string(),
        repository_name: repository_name.to_string(),
        commit_id,
        comment: commit.comment.unwrap_or_else(|| "(no comment)".to_string()),
        author_name,
        author_email,
        author_date,
        web_url,
    }
}

pub async fn sync_commits_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("commits:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_commits(db, client, org).await {
        Ok(()) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(&scope, &org.id, Some(&now), 0, None)?;
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) =
                db.update_sync_state(&scope, &org.id, None, error_count + 1, Some(&e.to_string()))
            {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            tracing::error!(org = %org.name, error = %e, "commit sync failed");
            Err(e)
        }
    }
}

async fn do_sync_commits(db: &AppDatabase, client: &AdoClient, org: &Organization) -> Result<()> {
    let from_date = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let projects = client.list_projects().await?;
    let mut tasks = JoinSet::new();
    for project in &projects {
        let repositories = match client.list_repositories(&project.id).await {
            Ok(repos) => repos,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "failed to list repositories, skipping project"
                );
                continue;
            }
        };
        for repository in repositories {
            while tasks.len() >= COMMIT_SYNC_CONCURRENCY {
                if let Some((repository_id, cached)) = join_commit_task(&mut tasks).await? {
                    db.replace_commits_for_repo(&org.id, &repository_id, &cached)?;
                }
            }
            tasks.spawn(fetch_commits_for_repo(
                client.clone(),
                org.clone(),
                project.clone(),
                repository,
                from_date.clone(),
            ));
        }
    }
    while !tasks.is_empty() {
        if let Some((repository_id, cached)) = join_commit_task(&mut tasks).await? {
            db.replace_commits_for_repo(&org.id, &repository_id, &cached)?;
        }
    }
    db.purge_old_commits(&org.id, &from_date)?;
    tracing::info!(org = %org.name, "commit sync completed");
    Ok(())
}

async fn join_commit_task(tasks: &mut JoinSet<CommitSyncTaskResult>) -> CommitSyncTaskResult {
    tasks
        .join_next()
        .await
        .expect("commit sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("commit sync task failed: {e}")))?
}

async fn fetch_commits_for_repo(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    repository: GitRepository,
    from_date: String,
) -> Result<Option<(String, Vec<CachedCommit>)>> {
    let repository_id = repository.id.clone();
    let commits = match client
        .list_commits(
            &project.id,
            &repository.id,
            CommitSearchCriteria {
                author: None,
                branch: None,
                from_date: Some(from_date),
                to_date: None,
                top: Some(100),
            },
        )
        .await
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                repository = %repository.name,
                error = %e,
                "failed to list commits, skipping repository"
            );
            return Ok(None);
        }
    };
    let cached: Vec<CachedCommit> = commits
        .into_iter()
        .map(|c| {
            commit_to_cached(
                &org,
                &project.id,
                &project.name,
                &repository.id,
                &repository.name,
                c,
            )
        })
        .collect();
    Ok(Some((repository_id, cached)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_optional_trims_empty_values() {
        assert_eq!(
            normalize_optional(Some(" main ".to_string())),
            Some("main".to_string())
        );
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
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
    fn commit_web_url_encodes_spaces_and_trims_trailing_slash() {
        let org = Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso/".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        assert_eq!(
            commit_web_url(&org, "Platform Team", "azdo dashboard", "abcdef123456"),
            "https://dev.azure.com/contoso/Platform%20Team/_git/azdo%20dashboard/commit/abcdef123456"
        );
    }
}
