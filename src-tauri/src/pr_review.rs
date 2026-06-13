use azdo_client::{AdoError, GitThread, NewThreadContext};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::prs::vote_label;
use crate::secrets::SecretStore;

const MAX_DIFF_CONTENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrLocator {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub repository_id: String,
    pub pull_request_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPullRequestReviewInput {
    #[serde(flatten)]
    pub pr: PrLocator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPullRequestChangesInput {
    #[serde(flatten)]
    pub pr: PrLocator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPullRequestFileDiffInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub file_path: String,
    pub original_path: Option<String>,
    pub change_type: String,
    pub base_commit_id: Option<String>,
    pub target_commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    /// None creates a new thread; Some replies to an existing thread.
    pub thread_id: Option<i64>,
    /// Parent comment id for replies (usually the thread's first comment id).
    pub parent_comment_id: Option<i64>,
    pub content: String,
    /// Line anchor for new threads (future inline-comment support).
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPullRequestThreadStatusInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    /// "active" | "closed"
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPullRequestVoteInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub vote: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPullRequestCommitsInput {
    #[serde(flatten)]
    pub pr: PrLocator,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReview {
    pub pull_request_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub created_by: Option<String>,
    pub creation_date: Option<String>,
    pub is_draft: bool,
    pub reviewers: Vec<PrReviewer>,
    pub threads: Vec<PrThread>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewer {
    pub display_name: String,
    pub vote: i32,
    pub vote_label: String,
    pub is_required: bool,
    pub is_me: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrThread {
    pub id: i64,
    pub status: Option<String>,
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
    pub comments: Vec<PrComment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: i64,
    pub parent_comment_id: Option<i64>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub is_system: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChanges {
    pub base_commit_id: Option<String>,
    pub target_commit_id: Option<String>,
    pub files: Vec<PrChangedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrChangedFile {
    pub path: String,
    pub change_type: String,
    pub original_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileDiff {
    pub file_path: String,
    pub base_content: Option<String>,
    pub target_content: Option<String>,
    pub base_unavailable_reason: Option<String>,
    pub target_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PrReviewService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl PrReviewService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
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

    pub async fn get_review(&self, input: GetPullRequestReviewInput) -> Result<PullRequestReview> {
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (detail, threads) = tokio::try_join!(
            client.get_pull_request_detail(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
            ),
            client.list_pull_request_threads(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
            ),
        )?;

        let me = organization.authenticated_user_id.as_deref();
        Ok(PullRequestReview {
            pull_request_id: detail.pull_request_id,
            title: detail.title,
            description: detail.description,
            source_ref_name: detail.source_ref_name,
            target_ref_name: detail.target_ref_name,
            created_by: detail.created_by.and_then(|id| id.display_name),
            creation_date: detail.creation_date.map(|date| date.to_rfc3339()),
            is_draft: detail.is_draft.unwrap_or(false),
            reviewers: detail
                .reviewers
                .unwrap_or_default()
                .into_iter()
                .map(|reviewer| PrReviewer {
                    is_me: me.is_some() && reviewer.id.as_deref() == me,
                    display_name: reviewer.display_name.unwrap_or_default(),
                    vote: reviewer.vote,
                    vote_label: vote_label(reviewer.vote).to_string(),
                    is_required: reviewer.is_required,
                })
                .collect(),
            threads: map_threads(threads),
        })
    }

    pub async fn list_changes(
        &self,
        input: ListPullRequestChangesInput,
    ) -> Result<PullRequestChanges> {
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let iterations = client
            .list_pull_request_iterations(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
            )
            .await?;
        let Some(latest) = iterations.into_iter().max_by_key(|iteration| iteration.id) else {
            return Ok(PullRequestChanges {
                base_commit_id: None,
                target_commit_id: None,
                files: vec![],
            });
        };
        let entries = client
            .get_pull_request_iteration_changes(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                latest.id,
            )
            .await?;
        let files = entries
            .into_iter()
            .filter_map(|entry| {
                let item = entry.item?;
                if item.is_folder.unwrap_or(false) {
                    return None;
                }
                Some(PrChangedFile {
                    path: item.path?,
                    change_type: entry.change_type.unwrap_or_else(|| "edit".to_string()),
                    original_path: entry.source_server_item,
                })
            })
            .collect();
        Ok(PullRequestChanges {
            base_commit_id: latest.common_ref_commit.map(|commit| commit.commit_id),
            target_commit_id: latest.source_ref_commit.map(|commit| commit.commit_id),
            files,
        })
    }

    pub async fn get_file_diff(&self, input: GetPullRequestFileDiffInput) -> Result<PrFileDiff> {
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let change_type = input.change_type.to_ascii_lowercase();

        let base_path = input
            .original_path
            .clone()
            .unwrap_or_else(|| input.file_path.clone());
        let (base_content, base_unavailable_reason) = if change_type.contains("add") {
            (None, None)
        } else if let Some(commit) = input.base_commit_id.as_deref() {
            fetch_side(&client, &input.pr, &base_path, commit).await?
        } else {
            (None, Some("missing".to_string()))
        };

        let (target_content, target_unavailable_reason) = if change_type.contains("delete") {
            (None, None)
        } else if let Some(commit) = input.target_commit_id.as_deref() {
            fetch_side(&client, &input.pr, &input.file_path, commit).await?
        } else {
            (None, Some("missing".to_string()))
        };

        Ok(PrFileDiff {
            file_path: input.file_path,
            base_content,
            target_content,
            base_unavailable_reason,
            target_unavailable_reason,
        })
    }

    pub async fn post_comment(&self, input: PostPullRequestCommentInput) -> Result<PrThread> {
        let content = input.content.trim();
        if content.is_empty() {
            return Err(AppError::InvalidInput("comment is empty".to_string()));
        }
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let thread = if let Some(thread_id) = input.thread_id {
            client
                .add_pull_request_comment(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                    input.parent_comment_id.unwrap_or(1),
                    content,
                )
                .await?;
            // Re-fetch the thread so the response includes every comment.
            client
                .list_pull_request_threads(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                )
                .await?
                .into_iter()
                .find(|thread| thread.id == thread_id)
                .ok_or_else(|| AppError::InvalidInput(format!("thread not found: {thread_id}")))?
        } else {
            let context = match (&input.file_path, input.right_line) {
                (Some(file_path), Some(line)) => Some(NewThreadContext {
                    file_path: file_path.clone(),
                    right_line: line,
                }),
                _ => None,
            };
            client
                .create_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    content,
                    context,
                )
                .await?
        };
        map_threads(vec![thread]).into_iter().next().ok_or_else(|| {
            AppError::InvalidInput("posted thread has no visible comments".to_string())
        })
    }

    pub async fn set_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread> {
        validate_thread_status(&input.status)?;
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let thread = client
            .update_pull_request_thread_status(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                &input.status,
            )
            .await?;
        map_threads(vec![thread]).into_iter().next().ok_or_else(|| {
            AppError::InvalidInput("updated thread has no visible comments".to_string())
        })
    }

    pub async fn list_commits(&self, input: ListPullRequestCommitsInput) -> Result<Vec<PrCommit>> {
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let commits = client
            .list_pull_request_commits(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
            )
            .await?;
        Ok(commits
            .into_iter()
            .map(|commit| {
                let comment = commit
                    .comment
                    .unwrap_or_default()
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string();
                PrCommit {
                    short_commit_id: commit.commit_id.chars().take(8).collect(),
                    commit_id: commit.commit_id,
                    comment,
                    author_name: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.name.clone()),
                    author_date: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.date)
                        .map(|date| date.to_rfc3339()),
                }
            })
            .collect())
    }

    pub async fn submit_vote(&self, input: SubmitPullRequestVoteInput) -> Result<PrReviewer> {
        validate_vote(input.vote)?;
        let organization = self.resolve_organization(input.pr.organization_id.as_deref())?;
        let reviewer_id = organization.authenticated_user_id.clone().ok_or_else(|| {
            AppError::InvalidInput(
                "organization has no authenticated user id; re-add the organization".to_string(),
            )
        })?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let reviewer = client
            .submit_pull_request_vote(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &reviewer_id,
                input.vote,
            )
            .await?;
        Ok(PrReviewer {
            is_me: true,
            display_name: reviewer.display_name.unwrap_or_default(),
            vote: reviewer.vote,
            vote_label: vote_label(reviewer.vote).to_string(),
            is_required: reviewer.is_required,
        })
    }
}

fn validate_vote(vote: i32) -> Result<()> {
    if matches!(vote, -10 | -5 | 0 | 5 | 10) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "invalid vote value: {vote}"
        )))
    }
}

fn validate_thread_status(status: &str) -> Result<()> {
    if matches!(status, "active" | "closed") {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "invalid thread status: {status}"
        )))
    }
}

async fn fetch_side(
    client: &azdo_client::AdoClient,
    pr: &PrLocator,
    path: &str,
    commit_id: &str,
) -> Result<(Option<String>, Option<String>)> {
    match client
        .get_item_content(&pr.project_id, &pr.repository_id, path, commit_id)
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

fn map_threads(threads: Vec<GitThread>) -> Vec<PrThread> {
    threads
        .into_iter()
        .filter(|thread| !thread.is_deleted)
        .map(|thread| {
            let context = thread.thread_context;
            PrThread {
                id: thread.id,
                status: thread.status,
                file_path: context.as_ref().and_then(|ctx| ctx.file_path.clone()),
                right_line: context
                    .as_ref()
                    .and_then(|ctx| ctx.right_file_start.as_ref())
                    .map(|position| position.line),
                comments: thread
                    .comments
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|comment| !comment.is_deleted)
                    .map(|comment| PrComment {
                        id: comment.id,
                        parent_comment_id: comment.parent_comment_id,
                        content: comment.content,
                        author: comment.author.and_then(|author| author.display_name),
                        published_date: comment.published_date.map(|date| date.to_rfc3339()),
                        is_system: comment.comment_type.as_deref() == Some("system"),
                    })
                    .collect(),
            }
        })
        // Threads whose comments were all deleted carry no useful content.
        .filter(|thread| !thread.comments.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_threads_skips_deleted_and_flags_system_comments() {
        let threads: Vec<GitThread> = serde_json::from_value(serde_json::json!([
            { "id": 1, "isDeleted": true, "comments": [{ "id": 1, "content": "gone" }] },
            {
                "id": 2,
                "status": "active",
                "threadContext": {
                    "filePath": "/src/app.ts",
                    "rightFileStart": { "line": 12, "offset": 1 }
                },
                "comments": [
                    { "id": 1, "content": "real", "commentType": "text" },
                    { "id": 2, "content": "voted", "commentType": "system" },
                    { "id": 3, "content": "deleted", "commentType": "text", "isDeleted": true }
                ]
            }
        ]))
        .unwrap();

        let mapped = map_threads(threads);
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].file_path.as_deref(), Some("/src/app.ts"));
        assert_eq!(mapped[0].right_line, Some(12));
        assert_eq!(mapped[0].comments.len(), 2);
        assert!(!mapped[0].comments[0].is_system);
        assert!(mapped[0].comments[1].is_system);
    }

    #[test]
    fn validate_vote_accepts_only_known_values() {
        assert!(validate_vote(10).is_ok());
        assert!(validate_vote(5).is_ok());
        assert!(validate_vote(0).is_ok());
        assert!(validate_vote(-5).is_ok());
        assert!(validate_vote(-10).is_ok());
        assert!(validate_vote(3).is_err());
    }

    #[test]
    fn validate_thread_status_accepts_active_and_closed() {
        assert!(validate_thread_status("active").is_ok());
        assert!(validate_thread_status("closed").is_ok());
        assert!(validate_thread_status("fixed").is_err());
    }
}
