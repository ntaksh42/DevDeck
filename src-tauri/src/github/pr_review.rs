//! GitHub pull request review detail and mutations, mapped onto the pr_review
//! DTOs. GitHub's review model differs from Azure DevOps: "votes" come from
//! submitted reviews, conversation comments are flat issue comments, and inline
//! comments form review threads whose resolved state lives only in GraphQL.

use github_client::{
    GitHubClient, IssueComment, PrCommitItem, PrFileItem, PullRequestDetail, ReviewComment,
    ReviewItem,
};
use serde_json::json;

use crate::auth::github_client_for_organization;
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::pr_review::{
    DeletePullRequestCommentInput, EditPullRequestCommentInput, GetPullRequestFileDiffInput,
    PostPullRequestCommentInput, PrChangedFile, PrComment, PrCommit, PrDetailsResult, PrFileDiff,
    PrLocator, PrReviewer, PrStatusResult, PrThread, PullRequestChanges, PullRequestReview,
    RemovePullRequestReviewerInput, SetPullRequestReviewerRequiredInput,
    SetPullRequestThreadStatusInput, SubmitPullRequestVoteInput, UpdatePullRequestDetailsInput,
    UpdatePullRequestInput,
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
        // Keep the most recent submission.
        if review.submitted_at >= entry.1 {
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
            is_me: login == me,
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
                is_me: requested.login == me,
            });
        }
    }
    reviewers.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    reviewers
}

fn issue_comment_thread(comment: IssueComment, me: &str) -> PrThread {
    let author = comment.user.map(|u| u.login);
    let is_mine = author.as_deref() == Some(me);
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

/// Fetches inline review threads via GraphQL so resolution state is available.
async fn fetch_review_threads(
    client: &GitHubClient,
    owner: &str,
    repo: &str,
    number: i64,
    me: &str,
) -> Result<Vec<PrThread>> {
    const QUERY: &str = r#"
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          reviewThreads(first:100){
            nodes{
              isResolved
              comments(first:100){
                nodes{ databaseId author{login} body createdAt path line originalLine }
              }
            }
          }
        }
      }
    }"#;
    let value = client
        .graphql(
            QUERY,
            json!({ "owner": owner, "repo": repo, "number": number }),
        )
        .await?;
    let nodes = value
        .pointer("/data/repository/pullRequest/reviewThreads/nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

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
        let right_line = first.get("line").and_then(|v| v.as_i64());
        let comments = comment_nodes
            .iter()
            .map(|c| {
                let author = c
                    .pointer("/author/login")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let is_mine = author.as_deref() == Some(me);
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
            left_line: None,
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
        base_commit_id: Some(detail.base.sha),
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
                base_content = client
                    .get_file_content(&owner, &repo, base_path, sha)
                    .await?
            }
            None => base_unavailable_reason = Some("base commit unavailable".to_string()),
        }
    }
    if input.change_type != "delete" {
        match &input.target_commit_id {
            Some(sha) => {
                target_content = client
                    .get_file_content(&owner, &repo, &input.file_path, sha)
                    .await?
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

// ---- Mutations ----

pub async fn post_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: PostPullRequestCommentInput,
) -> Result<PrThread> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let me = login_for(organization);
    let number = input.pr.pull_request_id;

    // Reply to an existing inline thread when the thread id matches a review
    // comment; otherwise fall back to a flat conversation comment.
    if let Some(thread_id) = input.thread_id {
        let review_comments = client.list_review_comments(&owner, &repo, number).await?;
        if review_comments.iter().any(|c| c.id as i64 == thread_id) {
            let reply = client
                .reply_review_comment(&owner, &repo, number, thread_id, &input.content)
                .await?;
            return Ok(review_comment_thread(vec![reply], &me));
        }
        let comment = client
            .create_issue_comment(&owner, &repo, number, &input.content)
            .await?;
        return Ok(issue_comment_thread(comment, &me));
    }

    // A new inline thread anchored to a file/line.
    if let (Some(path), Some(line)) = (
        input.file_path.as_deref(),
        input.right_line.or(input.left_line),
    ) {
        let detail = client.get_pull_request(&owner, &repo, number).await?;
        let side = if input.left_line.is_some() && input.right_line.is_none() {
            "LEFT"
        } else {
            "RIGHT"
        };
        let comment = client
            .create_review_comment(
                &owner,
                &repo,
                number,
                &input.content,
                &detail.head.sha,
                path,
                line,
                side,
            )
            .await?;
        return Ok(review_comment_thread(vec![comment], &me));
    }

    // A new top-level conversation comment.
    let comment = client
        .create_issue_comment(&owner, &repo, number, &input.content)
        .await?;
    Ok(issue_comment_thread(comment, &me))
}

fn review_comment_thread(comments: Vec<ReviewComment>, me: &str) -> PrThread {
    let first = comments.first();
    let id = first.map(|c| c.id as i64).unwrap_or(0);
    let file_path = first.and_then(|c| c.path.clone());
    let right_line = first.and_then(|c| c.line);
    PrThread {
        id,
        status: Some("active".to_string()),
        is_resolved: false,
        file_path,
        right_line,
        left_line: None,
        comments: comments
            .into_iter()
            .map(|c| {
                let author = c.user.map(|u| u.login);
                let is_mine = author.as_deref() == Some(me);
                PrComment {
                    id: c.id as i64,
                    parent_comment_id: c.in_reply_to_id.map(|v| v as i64),
                    content: c.body,
                    author,
                    published_date: Some(c.created_at),
                    is_system: false,
                    is_mine,
                }
            })
            .collect(),
    }
}

pub async fn set_thread_status(
    organization: &Organization,
    secrets: &SecretStore,
    input: SetPullRequestThreadStatusInput,
) -> Result<PrThread> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let resolve = input.status.eq_ignore_ascii_case("closed");

    // Find the GraphQL node id of the thread whose root comment matches.
    const QUERY: &str = r#"
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          reviewThreads(first:100){
            nodes{ id isResolved comments(first:1){ nodes{ databaseId } } }
          }
        }
      }
    }"#;
    let value = client
        .graphql(
            QUERY,
            json!({ "owner": owner, "repo": repo, "number": input.pr.pull_request_id }),
        )
        .await?;
    let nodes = value
        .pointer("/data/repository/pullRequest/reviewThreads/nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();
    let node_id = nodes
        .iter()
        .find(|n| {
            n.pointer("/comments/nodes/0/databaseId")
                .and_then(|v| v.as_i64())
                == Some(input.thread_id)
        })
        .and_then(|n| n.get("id").and_then(|v| v.as_str()))
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::InvalidInput(
                "review thread not found (conversation comments cannot be resolved)".to_string(),
            )
        })?;

    let mutation = if resolve {
        "mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }"
    } else {
        "mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }"
    };
    client.graphql(mutation, json!({ "id": node_id })).await?;

    // Return the refreshed thread.
    let me = login_for(organization);
    let threads =
        fetch_review_threads(&client, &owner, &repo, input.pr.pull_request_id, &me).await?;
    threads
        .into_iter()
        .find(|t| t.id == input.thread_id)
        .ok_or_else(|| AppError::InvalidInput("thread not found after update".to_string()))
}

pub async fn submit_vote(
    organization: &Organization,
    secrets: &SecretStore,
    input: SubmitPullRequestVoteInput,
) -> Result<PrReviewer> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let me = login_for(organization);
    // GitHub reviews only have APPROVE / REQUEST_CHANGES / COMMENT, and COMMENT
    // requires a non-empty body. Sending an empty-body COMMENT (which the old
    // mapping did for the intermediate Azure DevOps votes and for "no vote")
    // is rejected with 422. Map any positive vote to APPROVE and any negative
    // vote to REQUEST_CHANGES (both accept an empty body); GitHub has no way to
    // clear a submitted vote through the review-submission API.
    let event = match input.vote {
        v if v > 0 => "APPROVE",
        v if v < 0 => "REQUEST_CHANGES",
        _ => {
            return Err(AppError::InvalidInput(
                "GitHub does not support clearing a review vote; dismiss the review on GitHub instead."
                    .to_string(),
            ));
        }
    };
    let review = client
        .submit_review(&owner, &repo, input.pr.pull_request_id, event, "")
        .await?;
    let (vote, label) = vote_for(&review.state);
    Ok(PrReviewer {
        id: Some(me.clone()),
        display_name: me,
        vote,
        vote_label: label.to_string(),
        is_required: false,
        is_me: true,
    })
}

pub async fn update_pull_request(
    organization: &Organization,
    secrets: &SecretStore,
    input: UpdatePullRequestInput,
) -> Result<PrStatusResult> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let number = input.pr.pull_request_id;

    match input.action.as_str() {
        "abandon" => {
            let pr = client
                .update_pull_request(&owner, &repo, number, json!({ "state": "closed" }))
                .await?;
            Ok(PrStatusResult {
                status: Some(github_status(&pr)),
                is_draft: pr.draft,
            })
        }
        "reactivate" => {
            let pr = client
                .update_pull_request(&owner, &repo, number, json!({ "state": "open" }))
                .await?;
            Ok(PrStatusResult {
                status: Some(github_status(&pr)),
                is_draft: pr.draft,
            })
        }
        "complete" => {
            let method = match input.merge_strategy.as_deref() {
                Some("squash") => "squash",
                Some("rebase") | Some("rebaseMerge") => "rebase",
                _ => "merge",
            };
            client
                .merge_pull_request(&owner, &repo, number, method)
                .await?;
            Ok(PrStatusResult {
                status: Some("completed".to_string()),
                is_draft: false,
            })
        }
        "publish" => {
            // GitHub marks a PR ready for review via GraphQL; approximate by
            // reporting current state (REST cannot clear draft on classic PATs).
            let pr = client.get_pull_request(&owner, &repo, number).await?;
            Ok(PrStatusResult {
                status: Some(github_status(&pr)),
                is_draft: pr.draft,
            })
        }
        other => Err(AppError::InvalidInput(format!(
            "unsupported pull request action: {other}"
        ))),
    }
}

fn github_status(pr: &PullRequestDetail) -> String {
    if pr.state.eq_ignore_ascii_case("open") {
        "active".to_string()
    } else if pr.merged {
        "completed".to_string()
    } else {
        "abandoned".to_string()
    }
}

pub async fn update_pull_request_details(
    organization: &Organization,
    secrets: &SecretStore,
    input: UpdatePullRequestDetailsInput,
) -> Result<PrDetailsResult> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    // Only send `body` when a new description was provided. Sending `body: ""`
    // for `description: None` (a title-only edit) would wipe the existing PR
    // description on GitHub.
    let mut patch = json!({ "title": input.title });
    if let Some(description) = &input.description {
        patch["body"] = json!(description);
    }
    let pr = client
        .update_pull_request(&owner, &repo, input.pr.pull_request_id, patch)
        .await?;
    Ok(PrDetailsResult {
        title: pr.title,
        description: pr.body,
    })
}

pub async fn edit_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: EditPullRequestCommentInput,
) -> Result<PrThread> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let me = login_for(organization);
    // A thread whose id equals the comment id is a flat conversation comment;
    // otherwise it is an inline review comment.
    if input.thread_id == input.comment_id {
        let comment = client
            .update_issue_comment(&owner, &repo, input.comment_id, &input.content)
            .await?;
        Ok(issue_comment_thread(comment, &me))
    } else {
        let comment = client
            .update_review_comment(&owner, &repo, input.comment_id, &input.content)
            .await?;
        Ok(review_comment_thread(vec![comment], &me))
    }
}

pub async fn delete_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: DeletePullRequestCommentInput,
) -> Result<()> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    if input.thread_id == input.comment_id {
        client
            .delete_issue_comment(&owner, &repo, input.comment_id)
            .await?;
    } else {
        client
            .delete_review_comment(&owner, &repo, input.comment_id)
            .await?;
    }
    Ok(())
}

pub async fn set_reviewer_required(
    organization: &Organization,
    secrets: &SecretStore,
    input: SetPullRequestReviewerRequiredInput,
) -> Result<()> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    let reviewers = vec![input.reviewer_id.clone()];
    // GitHub has no per-PR "required" flag (branch protection governs that), so
    // map required -> request the reviewer, not-required -> remove the request.
    if input.is_required {
        client
            .request_reviewers(&owner, &repo, input.pr.pull_request_id, &reviewers)
            .await?;
    } else {
        client
            .remove_requested_reviewers(&owner, &repo, input.pr.pull_request_id, &reviewers)
            .await?;
    }
    Ok(())
}

pub async fn remove_reviewer(
    organization: &Organization,
    secrets: &SecretStore,
    input: RemovePullRequestReviewerInput,
) -> Result<()> {
    let (owner, repo) = split_owner_repo(&input.pr.repository_id)?;
    let client = client(organization, secrets)?;
    client
        .remove_requested_reviewers(
            &owner,
            &repo,
            input.pr.pull_request_id,
            &[input.reviewer_id],
        )
        .await?;
    Ok(())
}
