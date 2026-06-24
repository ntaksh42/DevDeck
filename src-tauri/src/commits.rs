use azdo_client::{
    AdoClient, AdoError, CommitSearchCriteria, GitCommitRef, GitRepository, TeamProject,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, CachedCommit, CachedCommitPr, Organization};
use crate::error::{AppError, Result};
use crate::prs::vote_label;
use crate::secrets::SecretStore;
use crate::sync::SyncBudget;

/// How long a commit's related-PR lookup stays cached before being refreshed.
const COMMIT_PR_CACHE_TTL_MINUTES: i64 = 30;
const MAX_DIFF_CONTENT_BYTES: usize = 256 * 1024;
/// Upper bound on commit search rows returned to the UI. When more matches
/// exist the result is flagged `truncated` so the count is shown honestly.
const COMMIT_SEARCH_RESULT_LIMIT: usize = 100;
/// Sync window in days. Must cover the largest date preset offered by the
/// commit search UI (`src/features/commits/CommitSearch.tsx`, 90d) so that
/// preset does not silently return near-empty results.
const COMMIT_SYNC_WINDOW_DAYS: i64 = 90;
/// Between full commit syncs, only commits newer than the last sync are
/// fetched and merged. Force-pushes and deletions are reconciled by the next
/// full sync (which replaces each repository's window).
const FULL_COMMIT_SYNC_INTERVAL_HOURS: i64 = 24;
/// Overlap subtracted from the last sync time when computing a delta window, so
/// commits landing right around the previous boundary are not missed.
const COMMIT_DELTA_OVERLAP_HOURS: i64 = 1;
/// Page size for the paginated commit sync. The REST API caps `$top`, so the
/// sync walks pages with `$skip` until a short page signals the end.
const COMMIT_SYNC_PAGE_SIZE: u32 = 100;
type CommitSyncTaskResult = Result<Option<(String, Vec<CachedCommit>)>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCommitsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub author: Option<String>,
    pub branch: Option<String>,
    pub item_path: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityInput {
    pub organization_id: Option<String>,
    pub author: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityDay {
    pub date: String,
    pub count: i64,
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

/// Result of a commit search. `total` is the match count before the display
/// cap; `truncated` is true when more matches existed than were returned, so
/// the UI can show "Showing N of total" instead of silently dropping rows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSearchResult {
    pub commits: Vec<CommitSummary>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitChangesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub commit_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitFileDiffInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub file_path: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub commit_id: String,
    pub parent_commit_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangedFile {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitChangeSet {
    pub commit_id: String,
    pub parent_commit_id: Option<String>,
    pub files: Vec<CommitChangedFile>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDiff {
    pub file_path: String,
    pub base_content: Option<String>,
    pub target_content: Option<String>,
    pub base_unavailable_reason: Option<String>,
    pub target_unavailable_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCommitPullRequestsInput {
    pub organization_id: Option<String>,
    pub repository_id: String,
    pub commit_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPullRequest {
    pub pull_request_id: i64,
    pub repository_id: String,
    pub title: String,
    pub status: String,
    pub my_vote: i32,
    pub my_vote_label: String,
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

    pub async fn search(&self, input: SearchCommitsInput) -> Result<CommitSearchResult> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let author = normalize_optional(input.author);
        let branch = normalize_optional(input.branch);
        let item_path = normalize_optional(input.item_path).map(|p| normalize_item_path(&p));
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

        // Branch- or path-scoped search bypasses the cache: sync only fetches
        // each repository's default branch and never records per-commit changed
        // paths, so neither can be answered from SQLite. Query Azure DevOps live
        // for the requested branch/path instead.
        let is_live_search = branch.is_some() || item_path.is_some();
        let cached = if is_live_search {
            let Some(repository_id) = repository_filter.as_deref() else {
                return Err(AppError::InvalidInput(
                    "select a repository to search a specific branch or path".to_string(),
                ));
            };
            self.fetch_live_commits(
                &organization,
                repository_id,
                branch.as_deref(),
                item_path.as_deref(),
                from_rfc.as_deref(),
                to_rfc.as_deref(),
            )
            .await?
        } else if query.is_empty() {
            // SQL 側で日付・リポジトリ・author を絞り込む。author を SQL に渡さず
            // メモリ内で絞ると、LIMIT 500 の外にある一致コミットを取りこぼすため。
            self.db.search_commits(
                &organization.id,
                repository_filter.as_deref(),
                author.as_deref(),
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
                    .is_none_or(|f| c.author_date.as_deref().is_none_or(|d| d >= f))
                    && to_rfc
                        .as_deref()
                        .is_none_or(|t| c.author_date.as_deref().is_none_or(|d| d <= t))
            });
            rows
        };

        let mut results: Vec<CommitSummary> = cached
            .into_iter()
            .filter(|c| {
                // FTS already applied the text query for the cached path; the
                // live branch/path route returns unfiltered commits, so match
                // the query against the comment here.
                (!is_live_search
                    || query.is_empty()
                    || c.comment.to_ascii_lowercase().contains(&query))
                    && project_filter.as_deref().is_none_or(|p| c.project_id == p)
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
        let total = results.len();
        let truncated = total > COMMIT_SEARCH_RESULT_LIMIT;
        results.truncate(COMMIT_SEARCH_RESULT_LIMIT);
        tracing::info!(
            organization = %organization.name,
            count = results.len(),
            total,
            truncated,
            "commit search completed"
        );
        Ok(CommitSearchResult {
            commits: results,
            total,
            truncated,
        })
    }

    /// Fetches commits for a specific branch and/or changed path directly from
    /// Azure DevOps, converting them into the same cache shape the offline path
    /// produces so downstream filtering and ranking stay identical. Used when
    /// the cache cannot answer the query (non-default branch, path filter).
    async fn fetch_live_commits(
        &self,
        organization: &Organization,
        repository_id: &str,
        branch: Option<&str>,
        item_path: Option<&str>,
        from_date: Option<&str>,
        to_date: Option<&str>,
    ) -> Result<Vec<CachedCommit>> {
        let repository = self
            .db
            .list_commit_repositories(&organization.id)?
            .into_iter()
            .find(|r| r.repository_id == repository_id)
            .ok_or_else(|| {
                AppError::InvalidInput("unknown repository for this organization".to_string())
            })?;

        let client = client_for_organization(organization, &self.secrets)?;
        let commits = client
            .list_commits(
                &repository.project_id,
                &repository.repository_id,
                CommitSearchCriteria {
                    author: None,
                    branch: branch.map(str::to_string),
                    item_path: item_path.map(str::to_string),
                    from_date: from_date.map(str::to_string),
                    to_date: to_date.map(str::to_string),
                    top: Some(100),
                    skip: None,
                },
            )
            .await?;

        Ok(commits
            .into_iter()
            .map(|c| {
                commit_to_cached(
                    organization,
                    &repository.project_id,
                    &repository.project_name,
                    &repository.repository_id,
                    &repository.repository_name,
                    c,
                )
            })
            .collect())
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

    pub fn commit_activity(&self, input: CommitActivityInput) -> Result<Vec<CommitActivityDay>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let author = normalize_optional(input.author);
        let project_filter = normalize_optional(input.project_id);
        let repository_filter = normalize_optional(input.repository_id);
        let from_date = normalize_date(input.from_date.as_deref(), false)?;
        let to_date = normalize_date(input.to_date.as_deref(), true)?;
        if let (Some(from_date), Some(to_date)) = (&from_date, &to_date) {
            if from_date > to_date {
                return Err(AppError::InvalidInput(
                    "from date must be before or equal to to date".to_string(),
                ));
            }
        }
        let from_rfc = from_date.as_ref().map(DateTime::to_rfc3339);
        let to_rfc = to_date.as_ref().map(DateTime::to_rfc3339);

        let rows = self.db.commit_activity(
            &organization.id,
            project_filter.as_deref(),
            repository_filter.as_deref(),
            author.as_deref(),
            from_rfc.as_deref(),
            to_rfc.as_deref(),
        )?;
        Ok(rows
            .into_iter()
            .map(|(date, count)| CommitActivityDay { date, count })
            .collect())
    }

    pub async fn get_commit_changes(
        &self,
        input: GetCommitChangesInput,
    ) -> Result<CommitChangeSet> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let commit = client
            .get_commit(&input.project_id, &input.repository_id, &input.commit_id)
            .await?;
        let parent_commit_id = commit
            .parents
            .and_then(|parents| parents.into_iter().next());
        let entries = client
            .get_commit_changes(&input.project_id, &input.repository_id, &input.commit_id)
            .await?;
        let files = entries
            .into_iter()
            .filter_map(|entry| {
                let item = entry.item?;
                if item.is_folder.unwrap_or(false) {
                    return None;
                }
                Some(CommitChangedFile {
                    path: item.path?,
                    change_type: entry.change_type.unwrap_or_else(|| "edit".to_string()),
                    original_path: entry.source_server_item,
                })
            })
            .collect();
        Ok(CommitChangeSet {
            commit_id: input.commit_id,
            parent_commit_id,
            files,
        })
    }

    pub async fn get_commit_file_diff(
        &self,
        input: GetCommitFileDiffInput,
    ) -> Result<CommitFileDiff> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let flags = ChangeFlags::parse(&input.change_type);
        let base_path = input
            .original_path
            .clone()
            .unwrap_or_else(|| input.file_path.clone());

        let base_future = async {
            if flags.is_add {
                Ok((None, None))
            } else if let Some(parent) = input.parent_commit_id.as_deref() {
                fetch_commit_side(
                    &client,
                    &input.project_id,
                    &input.repository_id,
                    &base_path,
                    parent,
                )
                .await
            } else {
                Ok((None, Some("missing".to_string())))
            }
        };
        let target_future = async {
            if flags.is_delete {
                Ok((None, None))
            } else {
                fetch_commit_side(
                    &client,
                    &input.project_id,
                    &input.repository_id,
                    &input.file_path,
                    &input.commit_id,
                )
                .await
            }
        };
        let ((base_content, base_unavailable_reason), (target_content, target_unavailable_reason)) =
            tokio::try_join!(base_future, target_future)?;

        Ok(CommitFileDiff {
            file_path: input.file_path,
            base_content,
            target_content,
            base_unavailable_reason,
            target_unavailable_reason,
        })
    }

    /// Returns the pull requests that contain a commit, served from an
    /// on-demand cache. Returns an empty list (not an error) when the commit is
    /// not part of any pull request.
    pub async fn get_commit_pull_requests(
        &self,
        input: GetCommitPullRequestsInput,
    ) -> Result<Vec<CommitPullRequest>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let fresh_after =
            (Utc::now() - chrono::Duration::minutes(COMMIT_PR_CACHE_TTL_MINUTES)).to_rfc3339();

        if let Some(cached) = self.db.get_cached_commit_prs(
            &organization.id,
            &input.repository_id,
            &input.commit_id,
            &fresh_after,
        )? {
            return Ok(cached
                .into_iter()
                .map(cached_commit_pr_to_summary)
                .collect());
        }

        let client = client_for_organization(&organization, &self.secrets)?;
        let prs = client
            .list_commit_pull_requests(&input.repository_id, &input.commit_id)
            .await?;

        let me = organization.authenticated_user_id.as_deref();
        let cached: Vec<CachedCommitPr> = prs
            .into_iter()
            .filter_map(|pr| {
                let repo = pr.repository.as_ref()?;
                let project_name = repo
                    .project
                    .as_ref()
                    .map(|p| p.name.as_str())
                    .unwrap_or(repo.name.as_str());
                let web_url = format!(
                    "{}/{}/_git/{}/pullrequest/{}",
                    organization.base_url.trim_end_matches('/'),
                    encode_path_segment(project_name),
                    encode_path_segment(&repo.name),
                    pr.pull_request_id
                );
                let my_vote = me
                    .and_then(|me| {
                        pr.reviewers
                            .as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .find(|r| r.id.as_deref() == Some(me))
                            .map(|r| r.vote)
                    })
                    .unwrap_or(0);
                Some(CachedCommitPr {
                    pull_request_id: pr.pull_request_id,
                    pr_repository_id: repo.id.clone(),
                    title: pr.title,
                    status: pr.status,
                    my_vote,
                    my_vote_label: vote_label(my_vote).to_string(),
                    web_url: Some(web_url),
                })
            })
            .collect();

        self.db.replace_commit_prs(
            &organization.id,
            &input.repository_id,
            &input.commit_id,
            &cached,
        )?;

        Ok(cached
            .into_iter()
            .map(cached_commit_pr_to_summary)
            .collect())
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }
}

fn cached_commit_pr_to_summary(pr: CachedCommitPr) -> CommitPullRequest {
    CommitPullRequest {
        pull_request_id: pr.pull_request_id,
        repository_id: pr.pr_repository_id,
        title: pr.title,
        status: pr.status,
        my_vote: pr.my_vote,
        my_vote_label: pr.my_vote_label,
        web_url: pr.web_url,
    }
}

struct ChangeFlags {
    is_add: bool,
    is_delete: bool,
}

impl ChangeFlags {
    fn parse(change_type: &str) -> Self {
        let tokens: Vec<&str> = change_type.split(',').map(|token| token.trim()).collect();
        Self {
            is_add: tokens.contains(&"add") || tokens.contains(&"undelete"),
            is_delete: tokens.contains(&"delete"),
        }
    }
}

async fn fetch_commit_side(
    client: &AdoClient,
    project_id: &str,
    repository_id: &str,
    path: &str,
    commit_id: &str,
) -> Result<(Option<String>, Option<String>)> {
    match client
        .get_item_content(project_id, repository_id, path, commit_id)
        .await
    {
        Ok(item) => {
            if item
                .content_metadata
                .as_ref()
                .and_then(|metadata| metadata.is_binary)
                .unwrap_or(false)
            {
                return Ok((None, Some("binary".to_string())));
            }
            match item.content {
                Some(content) if content.len() > MAX_DIFF_CONTENT_BYTES => {
                    Ok((None, Some("tooLarge".to_string())))
                }
                Some(content) => Ok((Some(content), None)),
                None => Ok((None, Some("binary".to_string()))),
            }
        }
        Err(AdoError::Api { status: 404, .. }) => Ok((None, Some("missing".to_string()))),
        Err(error) => Err(error.into()),
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Azure DevOps `searchCriteria.itemPath` expects a server-relative path with a
/// leading slash (e.g. `/src/auth`). Accept user input with or without it.
fn normalize_item_path(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
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
    // commit.url is a REST endpoint, never a browser URL; only remoteUrl or a
    // constructed _git link may be shown to the user.
    let web_url = commit.remote_url.or_else(|| {
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

pub(crate) fn commit_full_sync_scope(org_id: &str) -> String {
    format!("internal:commit_full_sync:{org_id}")
}

/// Returns the RFC3339 `fromDate` for an incremental commit sync, or `None` when
/// a full sync is due (no prior full sync, parse failure, or the periodic
/// interval has elapsed). Mirrors the work item delta cadence.
fn commit_delta_since(db: &AppDatabase, org: &Organization) -> Option<String> {
    let full_at = db
        .get_sync_state(&commit_full_sync_scope(&org.id))
        .ok()??
        .last_synced_at?;
    let last_at = db
        .get_sync_state(&format!("commits:{}", org.id))
        .ok()??
        .last_synced_at?;
    let full_time = DateTime::parse_from_rfc3339(&full_at)
        .ok()?
        .with_timezone(&Utc);
    let last_time = DateTime::parse_from_rfc3339(&last_at)
        .ok()?
        .with_timezone(&Utc);
    if Utc::now() - full_time >= chrono::Duration::hours(FULL_COMMIT_SYNC_INTERVAL_HOURS) {
        return None;
    }
    Some((last_time - chrono::Duration::hours(COMMIT_DELTA_OVERLAP_HOURS)).to_rfc3339())
}

pub async fn sync_commits_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<()> {
    let scope = format!("commits:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_commits(db, client, org, projects, budget).await {
        Ok(was_full_sync) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(&scope, &org.id, Some(&now), 0, None, None)?;
            if was_full_sync {
                db.update_sync_state(
                    &commit_full_sync_scope(&org.id),
                    &org.id,
                    Some(&now),
                    0,
                    None,
                    None,
                )?;
            }
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) = db.update_sync_state(
                &scope,
                &org.id,
                None,
                error_count + 1,
                Some(&e.to_string()),
                None,
            ) {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            tracing::error!(org = %org.name, error = %e, "commit sync failed");
            Err(e)
        }
    }
}

/// Runs a commit sync pass. Returns whether it was a full sync (so the caller
/// can advance the full-sync marker). A full sync replaces each repository's
/// 90-day window; a delta sync only fetches and merges commits newer than the
/// last sync.
async fn do_sync_commits(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<bool> {
    let purge_before = (Utc::now() - chrono::Duration::days(COMMIT_SYNC_WINDOW_DAYS)).to_rfc3339();
    let delta_since = commit_delta_since(db, org);
    let is_full_sync = delta_since.is_none();
    let from_date = delta_since.unwrap_or_else(|| purge_before.clone());

    // List every repository across all projects concurrently, then fan out the
    // per-repository commit fetches. Both phases are bounded by the shared
    // budget, so listing no longer serializes project-by-project.
    let repositories = list_all_repositories(client, org, projects, budget).await;

    let mut tasks = JoinSet::new();
    for (project, repository) in repositories {
        tasks.spawn(fetch_commits_for_repo(
            client.clone(),
            org.clone(),
            project,
            repository,
            from_date.clone(),
            budget.clone(),
        ));
    }
    while !tasks.is_empty() {
        if let Some((repository_id, cached)) = join_commit_task(&mut tasks).await? {
            if is_full_sync {
                db.replace_commits_for_repo(&org.id, &repository_id, &cached)?;
            } else {
                db.merge_commits(&cached)?;
            }
        }
    }
    db.purge_old_commits(&org.id, &purge_before)?;
    tracing::info!(org = %org.name, full = is_full_sync, "commit sync completed");
    Ok(is_full_sync)
}

/// Lists repositories for every project concurrently, pairing each with its
/// project. A project whose repository listing fails is logged and skipped so
/// the rest still sync.
async fn list_all_repositories(
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Vec<(TeamProject, GitRepository)> {
    let mut tasks: JoinSet<Vec<(TeamProject, GitRepository)>> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            match client.list_repositories(&project.id).await {
                Ok(repos) => repos
                    .into_iter()
                    .map(|repo| (project.clone(), repo))
                    .collect(),
                Err(e) => {
                    tracing::warn!(
                        org = %org.name,
                        project = %project.name,
                        error = %e,
                        "failed to list repositories, skipping project"
                    );
                    Vec::new()
                }
            }
        });
    }
    let mut repositories = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(pairs) => repositories.extend(pairs),
            Err(e) => tracing::warn!(error = %e, "repository listing task failed"),
        }
    }
    repositories
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
    budget: SyncBudget,
) -> Result<Option<(String, Vec<CachedCommit>)>> {
    let _permit = budget.acquire_owned().await;
    let repository_id = repository.id.clone();
    let mut cached: Vec<CachedCommit> = Vec::new();
    let mut skip = 0u32;
    loop {
        let page = match client
            .list_commits(
                &project.id,
                &repository.id,
                CommitSearchCriteria {
                    author: None,
                    branch: None,
                    item_path: None,
                    from_date: Some(from_date.clone()),
                    to_date: None,
                    top: Some(COMMIT_SYNC_PAGE_SIZE),
                    skip: Some(skip),
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
        let page_len = page.len() as u32;
        cached.extend(page.into_iter().map(|c| {
            commit_to_cached(
                &org,
                &project.id,
                &project.name,
                &repository.id,
                &repository.name,
                c,
            )
        }));
        // A short page (fewer than requested) means the API has no more rows.
        if page_len < COMMIT_SYNC_PAGE_SIZE {
            break;
        }
        skip += page_len;
    }
    Ok(Some((repository_id, cached)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_flags_parse_detects_add_and_delete() {
        let add = ChangeFlags::parse("add");
        assert!(add.is_add && !add.is_delete);
        let delete = ChangeFlags::parse("delete");
        assert!(delete.is_delete && !delete.is_add);
        let edit = ChangeFlags::parse("edit");
        assert!(!edit.is_add && !edit.is_delete);
        let rename_edit = ChangeFlags::parse("edit, rename");
        assert!(!rename_edit.is_add && !rename_edit.is_delete);
    }

    #[test]
    fn normalize_optional_trims_empty_values() {
        assert_eq!(
            normalize_optional(Some(" main ".to_string())),
            Some("main".to_string())
        );
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
    }

    #[test]
    fn normalize_item_path_adds_leading_slash_and_trims() {
        assert_eq!(normalize_item_path("src/auth"), "/src/auth");
        assert_eq!(normalize_item_path("/src/auth/"), "/src/auth");
        assert_eq!(normalize_item_path("  src/auth  "), "/src/auth");
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
            authenticated_user_unique_name: None,
            created_at: "2026-05-24T00:00:00Z".to_string(),
            updated_at: "2026-05-24T00:00:00Z".to_string(),
        };
        assert_eq!(
            commit_web_url(&org, "Platform Team", "azdo dashboard", "abcdef123456"),
            "https://dev.azure.com/contoso/Platform%20Team/_git/azdo%20dashboard/commit/abcdef123456"
        );
    }

    #[tokio::test]
    async fn delta_commit_sync_merges_without_dropping_existing_commits() {
        use std::sync::Arc;

        use azdo_client::PatProvider;
        use serde_json::json;
        use tokio::sync::Semaphore;
        use url::Url;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        use crate::db::OrganizationDraft;

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "id": "proj-1", "name": "Platform" }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/proj-1/_apis/git/repositories"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{ "id": "repo-1", "name": "Repo" }]
            })))
            .mount(&server)
            .await;
        // The delta pass fetches only newer commits; the mock returns just the
        // new one (the previously cached commit is not in this response).
        Mock::given(method("GET"))
            .and(path("/proj-1/_apis/git/repositories/repo-1/commits"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "commitId": "new-commit",
                    "comment": "New commit",
                    "author": { "name": "Dev", "email": "dev@example.com", "date": "2026-06-20T00:00:00Z" }
                }]
            })))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db
            .upsert_organization(OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: None,
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: None,
                authenticated_user_display_name: None,
                authenticated_user_unique_name: None,
            })
            .unwrap();

        // Pre-existing cached commit that must survive a delta (merge) sync.
        db.replace_commits_for_repo(
            &org.id,
            "repo-1",
            &[CachedCommit {
                org_id: org.id.clone(),
                project_id: "proj-1".to_string(),
                project_name: "Platform".to_string(),
                repository_id: "repo-1".to_string(),
                repository_name: "Repo".to_string(),
                commit_id: "old-commit".to_string(),
                comment: "Old commit".to_string(),
                author_name: Some("Dev".to_string()),
                author_email: Some("dev@example.com".to_string()),
                author_date: Some("2026-06-19T00:00:00Z".to_string()),
                web_url: None,
            }],
        )
        .unwrap();

        // Mark a recent full sync and a recent incremental sync so this pass
        // takes the delta path instead of a full window replace.
        let now = Utc::now().to_rfc3339();
        db.update_sync_state(
            &commit_full_sync_scope(&org.id),
            &org.id,
            Some(&now),
            0,
            None,
            None,
        )
        .unwrap();
        db.update_sync_state(
            &format!("commits:{}", org.id),
            &org.id,
            Some(&now),
            0,
            None,
            None,
        )
        .unwrap();

        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);
        let projects = client.list_projects().await.unwrap();
        let budget: SyncBudget = Arc::new(Semaphore::new(8));

        sync_commits_for_org(&db, &client, &org, &projects, &budget)
            .await
            .unwrap();

        let commits = db.search_commits(&org.id, None, None, None, None).unwrap();
        let ids: Vec<&str> = commits.iter().map(|c| c.commit_id.as_str()).collect();
        // Delta merged the new commit while preserving the previously cached one;
        // a full replace would have dropped "old-commit".
        assert!(
            ids.contains(&"old-commit"),
            "delta sync must not drop existing commits"
        );
        assert!(ids.contains(&"new-commit"));
    }
}
