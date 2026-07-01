use azdo_client::CommitSearchCriteria;
use chrono::{DateTime, Utc};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, CachedCommit, CachedCommitPr, Organization};
use crate::error::{AppError, Result};
use crate::prs::vote_label;
use crate::secrets::SecretStore;

use super::helpers::{
    cached_commit_to_summary, commit_to_cached, encode_path_segment, entries_to_changed_files,
    fetch_commit_side, normalize_date, normalize_item_path, normalize_optional, normalize_set,
    ChangeFlags,
};
use super::{
    CommitActivityDay, CommitActivityInput, CommitChangeSet, CommitFileDiff, CommitPullRequest,
    CommitRangeChangeSet, CommitRepositoryOption, CommitSearchResult, CommitSummary,
    GetCommitChangesInput, GetCommitFileDiffInput, GetCommitPullRequestsInput,
    GetCommitRangeChangesInput, ListCommitRepositoriesInput, SearchCommitsInput,
};

/// How long a commit's related-PR lookup stays cached before being refreshed.
const COMMIT_PR_CACHE_TTL_MINUTES: i64 = 30;
/// Upper bound on commit search rows returned to the UI. When more matches
/// exist the result is flagged `truncated` so the count is shown honestly.
const COMMIT_SEARCH_RESULT_LIMIT: usize = 100;

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
        let project_set = normalize_set(input.project_ids);
        let repository_set = normalize_set(input.repository_ids);

        let from_rfc = from_date.as_ref().map(DateTime::to_rfc3339);
        let to_rfc = to_date.as_ref().map(DateTime::to_rfc3339);

        // Branch- or path-scoped search bypasses the cache: sync only fetches
        // each repository's default branch and never records per-commit changed
        // paths, so neither can be answered from SQLite. Query Azure DevOps live
        // for the requested branch/path instead.
        let is_live_search = branch.is_some() || item_path.is_some();
        let cached = if is_live_search {
            // A branch lives in exactly one repository, and a path filter is run
            // live per repository, so the live query needs a single repository
            // to scope to.
            let repository_id = match repository_set.as_deref() {
                Some([repository_id]) => repository_id.as_str(),
                _ => {
                    return Err(AppError::InvalidInput(
                        "select a single repository to search a specific branch or path"
                            .to_string(),
                    ));
                }
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
                repository_set.as_deref(),
                author.as_deref(),
                from_rfc.as_deref(),
                to_rfc.as_deref(),
            )?
        } else {
            // FTS は日付絞り込み非対応なので in-memory でフィルタする
            let mut rows =
                self.db
                    .search_commits_fts(&organization.id, &query, repository_set.as_deref())?;
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
                    && project_set
                        .as_ref()
                        .is_none_or(|set| set.contains(&c.project_id))
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
        let files = entries_to_changed_files(entries);
        Ok(CommitChangeSet {
            commit_id: input.commit_id,
            parent_commit_id,
            files,
        })
    }

    /// Changed files between two arbitrary commits (the two-commit compare
    /// view), as opposed to [`Self::get_commit_changes`] which diffs a commit
    /// against its own parent. `base_commit_id`/`target_commit_id` are passed
    /// through unchanged so callers can reuse them as `parentCommitId`/
    /// `commitId` in a later [`Self::get_commit_file_diff`] call for the same
    /// pair without inverting which side is which.
    pub async fn get_commit_range_changes(
        &self,
        input: GetCommitRangeChangesInput,
    ) -> Result<CommitRangeChangeSet> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let entries = client
            .get_commit_diff(
                &input.project_id,
                &input.repository_id,
                &input.base_commit_id,
                &input.target_commit_id,
            )
            .await?;
        Ok(CommitRangeChangeSet {
            base_commit_id: input.base_commit_id,
            target_commit_id: input.target_commit_id,
            files: entries_to_changed_files(entries),
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
