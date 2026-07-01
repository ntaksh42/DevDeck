//! GitHub commit search mapped onto the commit DTOs. Uses `GET /search/commits`
//! which spans every repository the token can see, mirroring how the Azure
//! DevOps commit search ranges across an organization's repositories.

use github_client::{CommitSearchItem, PrFileItem};

use crate::auth::github_client_for_organization;
use crate::commits::{
    fetch_parents_concurrently, CommitChangeSet, CommitChangedFile, CommitFileDiff, CommitParents,
    CommitPullRequest, CommitSearchResult, CommitSummary, GetCommitChangesInput,
    GetCommitFileDiffInput, GetCommitParentsInput, GetCommitPullRequestsInput, SearchCommitsInput,
};
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const COMMIT_SEARCH_LIMIT: u32 = 100;

/// Splits a GitHub `owner/repo` repository id.
fn split_owner_repo(repository_id: &str) -> Result<(String, String)> {
    repository_id
        .split_once('/')
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .filter(|(o, r)| !o.is_empty() && !r.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!(
                "GitHub repository id must be 'owner/repo', got '{repository_id}'"
            ))
        })
}

fn file_change_type(status: &str) -> String {
    match status {
        "added" => "add",
        "removed" => "delete",
        "renamed" => "rename",
        "modified" | "changed" => "edit",
        other => other,
    }
    .to_string()
}

fn file_to_changed(file: PrFileItem) -> CommitChangedFile {
    CommitChangedFile {
        change_type: file_change_type(&file.status),
        original_path: file.previous_filename,
        path: file.filename,
    }
}

pub async fn get_commit_changes(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetCommitChangesInput,
) -> Result<CommitChangeSet> {
    let (owner, repo) = split_owner_repo(&input.repository_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let commit = client
        .get_commit_detail(&owner, &repo, &input.commit_id)
        .await?;
    Ok(CommitChangeSet {
        commit_id: commit.sha,
        parent_commit_id: commit.parents.first().map(|p| p.sha.clone()),
        files: commit.files.into_iter().map(file_to_changed).collect(),
    })
}

pub async fn get_commit_file_diff(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetCommitFileDiffInput,
) -> Result<CommitFileDiff> {
    let (owner, repo) = split_owner_repo(&input.repository_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let base_path = input
        .original_path
        .clone()
        .unwrap_or_else(|| input.file_path.clone());

    let mut base_content = None;
    let mut target_content = None;
    let mut base_unavailable_reason = None;
    let target_unavailable_reason = None;

    if input.change_type != "add" {
        match &input.parent_commit_id {
            Some(sha) => {
                base_content = client
                    .get_file_content(&owner, &repo, &base_path, sha)
                    .await?
            }
            None => base_unavailable_reason = Some("parent commit unavailable".to_string()),
        }
    }
    if input.change_type != "delete" {
        target_content = client
            .get_file_content(&owner, &repo, &input.file_path, &input.commit_id)
            .await?;
    }

    Ok(CommitFileDiff {
        file_path: input.file_path,
        base_content,
        target_content,
        base_unavailable_reason,
        target_unavailable_reason,
    })
}

pub async fn get_commit_pull_requests(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetCommitPullRequestsInput,
) -> Result<Vec<CommitPullRequest>> {
    let (owner, repo) = split_owner_repo(&input.repository_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let pulls = client
        .list_commit_pulls(&owner, &repo, &input.commit_id)
        .await?;
    Ok(pulls
        .into_iter()
        .map(|pr| {
            let status = if pr.state.eq_ignore_ascii_case("open") {
                "active"
            } else if pr.merged {
                "completed"
            } else {
                "abandoned"
            };
            CommitPullRequest {
                pull_request_id: pr.number as i64,
                repository_id: format!("{owner}/{repo}"),
                title: pr.title,
                status: status.to_string(),
                my_vote: 0,
                my_vote_label: String::new(),
                web_url: Some(pr.html_url),
            }
        })
        .collect())
}

/// Resolves parent commit shas for the commit graph view. Unlike Azure
/// DevOps, GitHub's list/search endpoints do include parents, but that would
/// mean plumbing a new field through the shared `CommitSummary` cache path
/// just for this read-only view — so this reuses the same bounded-concurrency
/// per-commit lookup as the Azure DevOps provider instead, keeping the graph
/// feature's fetch shape identical across providers.
pub async fn get_commit_parents(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetCommitParentsInput,
) -> Result<Vec<CommitParents>> {
    let (owner, repo) = split_owner_repo(&input.repository_id)?;
    let client = github_client_for_organization(organization, secrets)?;

    let parents_by_id = fetch_parents_concurrently(input.commit_ids, move |commit_id| {
        let client = client.clone();
        let owner = owner.clone();
        let repo = repo.clone();
        async move {
            let detail = client
                .get_commit_detail(&owner, &repo, &commit_id)
                .await
                .ok()?;
            Some(detail.parents.into_iter().map(|p| p.sha).collect())
        }
    })
    .await;

    Ok(parents_by_id
        .into_iter()
        .map(|(commit_id, parent_ids)| CommitParents {
            commit_id,
            parent_ids,
        })
        .collect())
}

pub async fn search(
    organization: &Organization,
    secrets: &SecretStore,
    input: &SearchCommitsInput,
) -> Result<CommitSearchResult> {
    let client = github_client_for_organization(organization, secrets)?;

    // Default to the authenticated user's commits; an explicit author filter
    // overrides it. Free text and repository scoping are appended as GitHub
    // search qualifiers.
    let author = input
        .author
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty());
    let mut q = match author {
        Some(author) => format!("author:{author}"),
        None => "author:@me".to_string(),
    };
    if let Some(repos) = &input.repository_ids {
        for repo in repos.iter().filter(|r| !r.trim().is_empty()) {
            q.push_str(&format!(" repo:{}", repo.trim()));
        }
    }
    if let Some(query) = input
        .query
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
    {
        q.push(' ');
        q.push_str(query);
    }

    let items = client.search_commits(&q, COMMIT_SEARCH_LIMIT).await?;
    let mut commits: Vec<CommitSummary> = items
        .into_iter()
        .map(|item| item_to_summary(&organization.id, item))
        .collect();
    commits.sort_by(|a, b| b.author_date.cmp(&a.author_date));
    let total = commits.len();
    Ok(CommitSearchResult {
        commits,
        total,
        truncated: false,
    })
}

fn item_to_summary(org_id: &str, item: CommitSearchItem) -> CommitSummary {
    let repo = item.repository.as_ref();
    let owner = repo
        .and_then(|r| r.owner.as_ref())
        .map(|o| o.login.clone())
        .unwrap_or_default();
    let repo_name = repo.map(|r| r.name.clone()).unwrap_or_default();
    let repo_id = repo
        .and_then(|r| r.full_name.clone())
        .unwrap_or_else(|| format!("{owner}/{repo_name}"));
    let short = item.sha.chars().take(7).collect::<String>();
    let author = item.commit.author;
    CommitSummary {
        organization_id: org_id.to_string(),
        project_id: owner.clone(),
        project_name: owner,
        repository_id: repo_id,
        repository_name: repo_name,
        commit_id: item.sha,
        short_commit_id: short,
        comment: item.commit.message,
        author_name: author.as_ref().and_then(|a| a.name.clone()),
        author_email: author.as_ref().and_then(|a| a.email.clone()),
        author_date: author.as_ref().and_then(|a| a.date.clone()),
        web_url: Some(item.html_url),
    }
}
