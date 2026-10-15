//! GitHub pull request review detail and mutations, mapped onto the pr_review
//! DTOs. GitHub's review model differs from Azure DevOps: "votes" come from
//! submitted reviews, conversation comments are flat issue comments, and inline
//! comments form review threads whose resolved state lives only in GraphQL.

use github_client::{
    FileContent, GitHubClient, GitHubError, IssueComment, PrCommitItem, PrFileItem,
    PullRequestDetail, ReviewComment, ReviewItem,
};
use serde_json::json;

use crate::auth::github_client_for_organization;
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::pr_review::{
    AddPullRequestReviewerInput, DeletePullRequestCommentInput, EditPullRequestCommentInput,
    GetPullRequestFileDiffInput, PostPullRequestCommentInput, PrChangedFile, PrComment, PrCommit,
    PrDetailsResult, PrFileDiff, PrLocator, PrReviewer, PrStatusResult, PrThread,
    PullRequestChanges, PullRequestReview, RemovePullRequestReviewerInput,
    SetPullRequestReviewerRequiredInput, SetPullRequestThreadStatusInput,
    SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput, UpdatePullRequestInput,
};
use crate::secrets::SecretStore;

/// Splits a GitHub `owner/repo` repository id into its parts.
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

/// The authenticated user's login, from the connection id (`github:{login}`).
fn login_for(organization: &Organization) -> String {
    organization
        .id
        .strip_prefix("github:")
        .map(str::to_string)
        .or_else(|| organization.display_name.clone())
        .unwrap_or_default()
}

/// Whether `login` is the authenticated user. GitHub logins are
/// case-insensitive, and the connection id stores the login lowercased.
fn is_me(login: Option<&str>, me: &str) -> bool {
    login.is_some_and(|login| !me.is_empty() && login.eq_ignore_ascii_case(me))
}

fn client(organization: &Organization, secrets: &SecretStore) -> Result<GitHubClient> {
    github_client_for_organization(organization, secrets)
}

/// Maps a GitHub review state to the Azure DevOps numeric vote and label.
fn vote_for(state: &str) -> (i32, &'static str) {
    match state.to_ascii_uppercase().as_str() {
        "APPROVED" => (10, "Approved"),
        "CHANGES_REQUESTED" => (-10, "Rejected"),
        "COMMENTED" => (0, "Commented"),
        _ => (0, ""),
    }
}

pub async fn get_review(
    organization: &Organization,
    secrets: &SecretStore,
    pr: PrLocator,
) -> Result<PullRequestReview> {
    let (owner, repo) = split_owner_repo(&pr.repository_id)?;
    let client = client(organization, secrets)?;
    let me = login_for(organization);

    let detail = client
        .get_pull_request(&owner, &repo, pr.pull_request_id)
        .await?;
    let reviews = client
        .list_pull_request_reviews(&owner, &repo, pr.pull_request_id)
        .await?;
    let issue_comments = client
        .list_issue_comments(&owner, &repo, pr.pull_request_id)
        .await?;

    let reviewers = build_reviewers(&detail, &reviews, &me);
    let mut threads: Vec<PrThread> = Vec::new();
    // Conversation (issue) comments are flat: one thread per comment.
    for comment in issue_comments {
        threads.push(issue_comment_thread(comment, &me));
    }
    // Inline review threads carry resolution state, fetched via GraphQL.
    threads.extend(fetch_review_threads(&client, &owner, &repo, pr.pull_request_id, &me).await?);

    Ok(PullRequestReview {
        labels: Vec::new(),
        pull_request_id: detail.number as i64,
        title: detail.title,
        description: detail.body,
        source_ref_name: detail.head.ref_name,
        target_ref_name: detail.base.ref_name,
        created_by: detail.user.map(|u| u.login),
        creation_date: Some(detail.created_at),
        is_draft: detail.draft,
        auto_complete: false,
        reviewers,
        threads,
    })
}

fn build_reviewers(
    detail: &PullRequestDetail,
    reviews: &[ReviewItem],
    me: &str,
) -> Vec<PrReviewer> {
    use std::collections::HashMap;
    // Latest definitive review state per reviewer login.
    let mut latest: HashMap<String, (String, Option<String>)> = HashMap::new();
    for review in reviews {
        let Some(login) = review.user.as_ref().map(|u| u.login.clone()) else {
            continue;
        };
        let state = review.state.to_ascii_uppercase();
        if state == "PENDING" || state == "DISMISSED" {
            continue;
        }
        let entry = latest
            .entry(login)
            .or_insert((state.clone(), review.submitted_at.clone()));
        // A plain comment does not change a reviewer's approval or change
        // request (GitHub keeps counting it), so it only stands when there is
        // nothing else. Otherwise keep the most recent submission.
        let replaces = if state == "COMMENTED" {
            entry.0 == "COMMENTED" && review.submitted_at >= entry.1
        } else {
            entry.0 == "COMMENTED" || review.submitted_at >= entry.1
        };
        if replaces {
            *entry = (state, review.submitted_at.clone());
        }
    }

    let mut reviewers: Vec<PrReviewer> = Vec::new();
    for (login, (state, _)) in &latest {
        let (vote, label) = vote_for(state);
        reviewers.push(PrReviewer {
            id: Some(login.clone()),
            display_name: login.clone(),
            vote,
            vote_label: label.to_string(),
            is_required: false,
            is_me: is_me(Some(login), me),
        });
    }
    // Requested (pending) reviewers who have not yet submitted a review.
    for requested in &detail.requested_reviewers {
        if !latest.contains_key(&requested.login) {
            reviewers.push(PrReviewer {
                id: Some(requested.login.clone()),
                display_name: requested.login.clone(),
                vote: 0,
                vote_label: String::new(),
                is_required: false,
                is_me: is_me(Some(&requested.login), me),
            });
        }
    }
    reviewers.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    reviewers
}

fn issue_comment_thread(comment: IssueComment, me: &str) -> PrThread {
    let author = comment.user.map(|u| u.login);
    let is_mine = is_me(author.as_deref(), me);
    PrThread {
        id: comment.id as i64,
        status: None,
        is_resolved: false,
        file_path: None,
        right_line: None,
        left_line: None,
        comments: vec![PrComment {
            id: comment.id as i64,
            parent_comment_id: None,
            content: comment.body,
            author,
            published_date: Some(comment.created_at),
            is_system: false,
            is_mine,
        }],
    }
}

/// Every review thread node of a PR, `fields` selecting what each holds.
/// GitHub returns at most 100 per request, so later threads are read page by
/// page; otherwise they could not be shown, replied to or resolved.
pub(super) async fn review_thread_nodes(
    client: &GitHubClient,
    owner: &str,
    repo: &str,
    number: i64,
    fields: &str,
) -> Result<Vec<serde_json::Value>> {
    let query = format!(
        r#"query($owner:String!,$repo:String!,$number:Int!,$after:String){{
          repository(owner:$owner,name:$repo){{
            pullRequest(number:$number){{
              reviewThreads(first:100,after:$after){{
                pageInfo{{ hasNextPage endCursor }}
                nodes{{ {fields} }}
              }}
            }}
          }}
        }}"#
    );
    let mut nodes = Vec::new();
    let mut after: Option<String> = None;
    // A bound in case the service keeps reporting more pages.
    for _ in 0..30 {
        let value = client
            .graphql(
                &query,
                json!({ "owner": owner, "repo": repo, "number": number, "after": after }),
            )
            .await?;
        let threads = value.pointer("/data/repository/pullRequest/reviewThreads");
        nodes.extend(
            threads
                .and_then(|t| t.get("nodes"))
                .and_then(|n| n.as_array())
                .cloned()
                .unwrap_or_default(),
        );
        let next = threads
            .and_then(|t| t.pointer("/pageInfo/hasNextPage"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        after = threads
            .and_then(|t| t.pointer("/pageInfo/endCursor"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if !next || after.is_none() {
            break;
        }
    }
    Ok(nodes)
}

/// Fetches inline review threads via GraphQL so resolution state is available.
async fn fetch_review_threads(
    client: &GitHubClient,
    owner: &str,
    repo: &str,
    number: i64,
    me: &str,
) -> Result<Vec<PrThread>> {
    let nodes = review_thread_nodes(
        client,
        owner,
        repo,
        number,
        "isResolved diffSide comments(first:100){ nodes{ databaseId author{login} body createdAt path line originalLine } }",
    )
    .await?;

    let mut threads = Vec::new();
    for node in nodes {
        let is_resolved = node
            .get("isResolved")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let comment_nodes = node
            .pointer("/comments/nodes")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        if comment_nodes.is_empty() {
            continue;
        }
        let first = &comment_nodes[0];
        let root_id = first
            .get("databaseId")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let file_path = first
            .get("path")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let line = first.get("line").and_then(|v| v.as_i64());
        // A comment on a deleted line sits on the base (left) side.
        let (left_line, right_line) = match node.get("diffSide").and_then(|v| v.as_str()) {
            Some("LEFT") => (line, None),
            _ => (None, line),
        };
        let comments = comment_nodes
            .iter()
            .map(|c| {
                let author = c
                    .pointer("/author/login")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let is_mine = is_me(author.as_deref(), me);
                PrComment {
                    id: c.get("databaseId").and_then(|v| v.as_i64()).unwrap_or(0),
                    parent_comment_id: None,
                    content: c.get("body").and_then(|v| v.as_str()).map(str::to_string),
                    author,
                    published_date: c
                        .get("createdAt")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    is_system: false,
                    is_mine,
                }
            })
            .collect();
        threads.push(PrThread {
            id: root_id,
            status: Some(if is_resolved { "closed" } else { "active" }.to_string()),
            is_resolved,
            file_path,
            right_line,
            left_line,
            comments,
        });
    }
    Ok(threads)
}

pub async fn list_changes(
    organization: &Organization,
    secrets: &SecretStore,
    pr: PrLocator,
) -> Result<PullRequestChanges> {
    let (owner, repo) = split_owner_repo(&pr.repository_id)?;
    let client = client(organization, secrets)?;
    let detail = client
        .get_pull_request(&owner, &repo, pr.pull_request_id)
        .await?;
    let files = client
        .list_pull_request_files(&owner, &repo, pr.pull_request_id)
        .await?;
    Ok(PullRequestChanges {
        // The files are relative to the merge base; the base branch tip may
        // have moved on, and diffing against it would show those newer base
        // changes as reverted in the PR. The tip stays the fallback.
        base_commit_id: Some(
            client
                .merge_base(&owner, &repo, &detail.base.sha, &detail.head.sha)
                .await
                .unwrap_or(detail.base.sha),
        ),
        target_commit_id: Some(detail.head.sha),
        files: files.into_iter().map(file_to_changed).collect(),
    })
}

fn file_to_changed(file: PrFileItem) -> PrChangedFile {
    let change_type = match file.status.as_str() {
        "added" => "add",
        "removed" => "delete",
        "renamed" => "rename",
        "modified" | "changed" => "edit",
        other => other,
    }
    .to_string();
    PrChangedFile {
        path: file.filename,
        change_type,
        original_path: file.previous_filename,
    }
}

/// One side of a diff and why it has no text, as the Azure DevOps path reports it.
fn file_side(content: FileContent) -> (Option<String>, Option<String>) {
    match content {
        FileContent::Text(text) => (Some(text), None),
        FileContent::Missing => (None, None),
        FileContent::TooLarge => (None, Some("tooLarge".to_string())),
    }
}

pub async fn get_file_diff(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetPullRequestFileDiffInput,
) -> Result<PrFileDiff> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let base_path = input.original_path.as_deref().unwrap_or(&input.file_path);

    let mut base_content = None;
    let mut target_content = None;
    let mut base_unavailable_reason = None;
    let mut target_unavailable_reason = None;

    if input.change_type != "add" {
        match &input.base_commit_id {
            Some(sha) => {
                (base_content, base_unavailable_reason) = file_side(
                    client
                        .get_file_content(&owner, &repo, base_path, sha)
                        .await?,
                )
            }
            None => base_unavailable_reason = Some("base commit unavailable".to_string()),
        }
    }
    if input.change_type != "delete" {
        match &input.target_commit_id {
            Some(sha) => {
                (target_content, target_unavailable_reason) = file_side(
                    client
                        .get_file_content(&owner, &repo, &input.file_path, sha)
                        .await?,
                )
            }
            None => target_unavailable_reason = Some("target commit unavailable".to_string()),
        }
    }

    Ok(PrFileDiff {
        file_path: input.file_path,
        base_content,
        target_content,
        base_unavailable_reason,
        target_unavailable_reason,
    })
}

pub async fn list_commits(
    organization: &Organization,
    secrets: &SecretStore,
    pr: PrLocator,
) -> Result<Vec<PrCommit>> {
    let (owner, repo) = split_owner_repo(&pr.repository_id)?;
    let client = client(organization, secrets)?;
    let commits = client
        .list_pull_request_commits(&owner, &repo, pr.pull_request_id)
        .await?;
    Ok(commits.into_iter().map(commit_to_pr_commit).collect())
}

fn commit_to_pr_commit(item: PrCommitItem) -> PrCommit {
    let author = item.commit.author;
    PrCommit {
        short_commit_id: item.sha.chars().take(7).collect(),
        commit_id: item.sha,
        comment: item.commit.message,
        author_name: author.as_ref().and_then(|a| a.name.clone()),
        author_date: author.as_ref().and_then(|a| a.date.clone()),
        web_url: Some(item.html_url),
    }
}

mod mutations;
#[cfg(test)]
mod tests;
pub use mutations::{
    add_reviewer, delete_comment, edit_comment, post_comment, remove_reviewer,
    set_reviewer_required, set_thread_status, submit_vote, update_pull_request,
    update_pull_request_details,
};
