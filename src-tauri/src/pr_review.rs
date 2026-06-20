use azdo_client::{AdoError, GitThread, NewThreadContext};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::AppDatabase;
use crate::error::{AppError, Result};
use crate::prs::{short_ref, vote_label};
use crate::secrets::SecretStore;
use crate::work_items::{summarize_mention_candidate, MentionCandidate};

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
    pub content: String,
    /// File + line anchor for a new inline thread. `right_line` targets the new
    /// side of the diff, `left_line` the old side; at most one is set.
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
    pub left_line: Option<i64>,
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
pub struct UpdatePullRequestInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    /// "abandon" | "reactivate" | "publish" | "complete"
    pub action: String,
    /// Required for "complete": noFastForward | squash | rebase | rebaseMerge
    pub merge_strategy: Option<String>,
    pub delete_source_branch: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusResult {
    pub status: Option<String>,
    pub is_draft: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestMentionsInput {
    pub organization_id: Option<String>,
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    pub comment_id: i64,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePullRequestCommentInput {
    #[serde(flatten)]
    pub pr: PrLocator,
    pub thread_id: i64,
    pub comment_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommit {
    pub commit_id: String,
    pub short_commit_id: String,
    pub comment: String,
    pub author_name: Option<String>,
    pub author_date: Option<String>,
    pub web_url: Option<String>,
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
    pub is_resolved: bool,
    pub file_path: Option<String>,
    pub right_line: Option<i64>,
    pub left_line: Option<i64>,
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
    pub is_mine: bool,
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

    pub async fn get_review(&self, pr: PrLocator) -> Result<PullRequestReview> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (detail, threads) = tokio::try_join!(
            client.get_pull_request_detail(&pr.project_id, &pr.repository_id, pr.pull_request_id,),
            client
                .list_pull_request_threads(&pr.project_id, &pr.repository_id, pr.pull_request_id,),
        )?;

        let me = organization.authenticated_user_id.as_deref();
        Ok(PullRequestReview {
            pull_request_id: detail.pull_request_id,
            title: detail.title,
            description: detail.description,
            source_ref_name: short_ref(&detail.source_ref_name),
            target_ref_name: short_ref(&detail.target_ref_name),
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
            threads: map_threads(threads, me),
        })
    }

    pub async fn list_changes(&self, pr: PrLocator) -> Result<PullRequestChanges> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let iterations = client
            .list_pull_request_iterations(&pr.project_id, &pr.repository_id, pr.pull_request_id)
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
                &pr.project_id,
                &pr.repository_id,
                pr.pull_request_id,
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
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let flags = ChangeFlags::parse(&input.change_type);

        let base_path = input
            .original_path
            .clone()
            .unwrap_or_else(|| input.file_path.clone());

        // The two sides are independent; fetch them concurrently.
        let base_future = async {
            if flags.is_add {
                Ok((None, None))
            } else if let Some(commit) = input.base_commit_id.as_deref() {
                fetch_side(&client, &input.pr, &base_path, commit).await
            } else {
                Ok((None, Some("missing".to_string())))
            }
        };
        let target_future = async {
            if flags.is_delete {
                Ok((None, None))
            } else if let Some(commit) = input.target_commit_id.as_deref() {
                fetch_side(&client, &input.pr, &input.file_path, commit).await
            } else {
                Ok((None, Some("missing".to_string())))
            }
        };
        let ((base_content, base_unavailable_reason), (target_content, target_unavailable_reason)) =
            tokio::try_join!(base_future, target_future)?;

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
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let thread = if let Some(thread_id) = input.thread_id {
            // Fetch just this thread to find its root comment (the reply parent)
            // instead of trusting a client-supplied id; the same single-thread
            // call doubles as the up-to-date response after posting.
            let existing = client
                .get_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                )
                .await?;
            let parent_comment_id = root_comment_id(&existing);
            client
                .add_pull_request_comment(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                    parent_comment_id,
                    content,
                )
                .await?;
            client
                .get_pull_request_thread(
                    &input.pr.project_id,
                    &input.pr.repository_id,
                    input.pr.pull_request_id,
                    thread_id,
                )
                .await?
        } else {
            let context = match &input.file_path {
                Some(file_path) if input.right_line.is_some() || input.left_line.is_some() => {
                    Some(NewThreadContext {
                        file_path: file_path.clone(),
                        right_line: input.right_line,
                        left_line: input.left_line,
                    })
                }
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
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("posted thread has no visible comments".to_string())
            })
    }

    pub async fn set_thread_status(
        &self,
        input: SetPullRequestThreadStatusInput,
    ) -> Result<PrThread> {
        validate_thread_status(&input.status)?;
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
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
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("updated thread has no visible comments".to_string())
            })
    }

    pub async fn update_pull_request(
        &self,
        input: UpdatePullRequestInput,
    ) -> Result<PrStatusResult> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let body = match input.action.as_str() {
            "abandon" => serde_json::json!({ "status": "abandoned" }),
            "reactivate" => serde_json::json!({ "status": "active" }),
            "publish" => serde_json::json!({ "isDraft": false }),
            "complete" => {
                let merge_strategy = input
                    .merge_strategy
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "merge strategy is required to complete a pull request".to_string(),
                        )
                    })?;
                validate_merge_strategy(merge_strategy)?;
                let detail = client
                    .get_pull_request_detail(
                        &input.pr.project_id,
                        &input.pr.repository_id,
                        input.pr.pull_request_id,
                    )
                    .await?;
                let last_commit = detail
                    .last_merge_source_commit
                    .map(|c| c.commit_id)
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "pull request has no source commit to merge".to_string(),
                        )
                    })?;
                serde_json::json!({
                    "status": "completed",
                    "lastMergeSourceCommit": { "commitId": last_commit },
                    "completionOptions": {
                        "mergeStrategy": merge_strategy,
                        "deleteSourceBranch": input.delete_source_branch.unwrap_or(false),
                    }
                })
            }
            other => {
                return Err(AppError::InvalidInput(format!(
                    "unknown pull request action: {other}"
                )))
            }
        };
        let updated = client
            .update_pull_request(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                &body,
            )
            .await?;
        Ok(PrStatusResult {
            status: updated.status,
            is_draft: updated.is_draft.unwrap_or(false),
        })
    }

    pub async fn edit_comment(&self, input: EditPullRequestCommentInput) -> Result<PrThread> {
        let content = input.content.trim();
        if content.is_empty() {
            return Err(AppError::InvalidInput("comment is empty".to_string()));
        }
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .update_pull_request_comment(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                input.comment_id,
                content,
            )
            .await?;
        let thread = client
            .get_pull_request_thread(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
            )
            .await?;
        map_threads(vec![thread], organization.authenticated_user_id.as_deref())
            .into_iter()
            .next()
            .ok_or_else(|| {
                AppError::InvalidInput("edited thread has no visible comments".to_string())
            })
    }

    pub async fn delete_comment(&self, input: DeletePullRequestCommentInput) -> Result<()> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        client
            .delete_pull_request_comment(
                &input.pr.project_id,
                &input.pr.repository_id,
                input.pr.pull_request_id,
                input.thread_id,
                input.comment_id,
            )
            .await?;
        Ok(())
    }

    pub async fn list_commits(&self, pr: PrLocator) -> Result<Vec<PrCommit>> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let commits = client
            .list_pull_request_commits(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await?;
        // Azure DevOps resolves the repository GUID in the `_git/{repo}` path,
        // so the commit web URL is built from trusted fields without an extra
        // round-trip (matching the URL guidance in AGENTS.md).
        let base_url = organization.base_url.trim_end_matches('/');
        let repo_segment = encode_path_segment(&pr.repository_id);
        let project_segment = encode_path_segment(&pr.project_id);
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
                let web_url = Some(format!(
                    "{base_url}/{project_segment}/_git/{repo_segment}/commit/{}",
                    commit.commit_id
                ));
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
                    web_url,
                }
            })
            .collect())
    }

    pub async fn search_mentions(
        &self,
        input: SearchPullRequestMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        let query = input.query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let identities = client.search_identities(query, 40).await?;
        Ok(identities
            .into_iter()
            .filter_map(summarize_mention_candidate)
            .collect())
    }

    pub async fn submit_vote(&self, input: SubmitPullRequestVoteInput) -> Result<PrReviewer> {
        validate_vote(input.vote)?;
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
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
        // Keep the cached review row in sync so the grid's vote column updates
        // immediately instead of waiting for the next background sync.
        let label = vote_label(reviewer.vote).to_string();
        match self.db.update_review_pr_vote(
            &organization.id,
            &input.pr.repository_id,
            input.pr.pull_request_id,
            reviewer.vote,
            &label,
        ) {
            Ok(0) => {
                // The PR is not in the My Reviews cache (opened from search or a
                // direct URL), so there is no grid row to keep in sync. The
                // command return value below still reflects the new vote.
                tracing::debug!(
                    pull_request_id = input.pr.pull_request_id,
                    "vote cast on PR absent from My Reviews cache; no cached row updated"
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(error = %error, "failed to update cached review vote");
            }
        }
        Ok(PrReviewer {
            is_me: true,
            display_name: reviewer.display_name.unwrap_or_default(),
            vote: reviewer.vote,
            vote_label: label,
            is_required: reviewer.is_required,
        })
    }
}

/// Azure DevOps serializes `VersionControlChangeType` as comma-joined tokens
/// (e.g. "edit, rename", "undelete"). Substring matching misreads "undelete" as
/// a delete, so the tokens are parsed explicitly.
struct ChangeFlags {
    is_add: bool,
    is_delete: bool,
}

impl ChangeFlags {
    fn parse(change_type: &str) -> Self {
        let mut is_add = false;
        let mut is_delete = false;
        for token in change_type.split(',') {
            match token.trim().to_ascii_lowercase().as_str() {
                // A restored file ("undelete") exists on the target side and is
                // absent at the base, so it behaves like an add for diffing.
                "add" | "undelete" => is_add = true,
                "delete" => is_delete = true,
                _ => {}
            }
        }
        ChangeFlags { is_add, is_delete }
    }
}

/// The reply parent is the thread's root comment (parentCommentId == 0), not
/// the first visible one — deleted roots must not reparent replies.
fn root_comment_id(thread: &GitThread) -> i64 {
    thread
        .comments
        .as_ref()
        .and_then(|comments| {
            comments
                .iter()
                .find(|comment| comment.parent_comment_id.unwrap_or(0) == 0)
                .or_else(|| comments.first())
        })
        .map(|comment| comment.id)
        .unwrap_or(1)
}

/// Maps an Azure DevOps thread status to a resolved/unresolved boolean. Only the
/// explicit closed-like statuses count as resolved; "active", "pending",
/// "unknown", and absent status are treated as open.
fn thread_resolved(status: Option<&str>) -> bool {
    matches!(
        status,
        Some("closed") | Some("fixed") | Some("wontFix") | Some("byDesign")
    )
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

fn validate_merge_strategy(strategy: &str) -> Result<()> {
    if matches!(
        strategy,
        "noFastForward" | "squash" | "rebase" | "rebaseMerge"
    ) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "invalid merge strategy: {strategy}"
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

fn map_threads(threads: Vec<GitThread>, me: Option<&str>) -> Vec<PrThread> {
    threads
        .into_iter()
        .filter(|thread| !thread.is_deleted)
        .map(|thread| {
            let context = thread.thread_context;
            PrThread {
                id: thread.id,
                is_resolved: thread_resolved(thread.status.as_deref()),
                status: thread.status,
                file_path: context.as_ref().and_then(|ctx| ctx.file_path.clone()),
                right_line: context
                    .as_ref()
                    .and_then(|ctx| ctx.right_file_start.as_ref())
                    .map(|position| position.line),
                left_line: context
                    .as_ref()
                    .and_then(|ctx| ctx.left_file_start.as_ref())
                    .map(|position| position.line),
                comments: thread
                    .comments
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|comment| !comment.is_deleted)
                    .map(|comment| {
                        let author = comment.author;
                        let is_mine =
                            me.is_some() && author.as_ref().and_then(|a| a.id.as_deref()) == me;
                        PrComment {
                            id: comment.id,
                            parent_comment_id: comment.parent_comment_id,
                            content: comment.content,
                            author: author.and_then(|author| author.display_name),
                            published_date: comment.published_date.map(|date| date.to_rfc3339()),
                            is_system: comment.comment_type.as_deref() == Some("system"),
                            is_mine,
                        }
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
                    { "id": 1, "content": "real", "commentType": "text", "author": { "id": "me-1" } },
                    { "id": 2, "content": "voted", "commentType": "system" },
                    { "id": 3, "content": "deleted", "commentType": "text", "isDeleted": true }
                ]
            }
        ]))
        .unwrap();

        let mapped = map_threads(threads, Some("me-1"));
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].file_path.as_deref(), Some("/src/app.ts"));
        assert_eq!(mapped[0].right_line, Some(12));
        assert_eq!(mapped[0].left_line, None);
        assert_eq!(mapped[0].comments.len(), 2);
        assert!(!mapped[0].comments[0].is_system);
        assert!(mapped[0].comments[0].is_mine);
        assert!(mapped[0].comments[1].is_system);
    }

    #[test]
    fn map_threads_reads_left_side_anchor() {
        let threads: Vec<GitThread> = serde_json::from_value(serde_json::json!([
            {
                "id": 3,
                "status": "active",
                "threadContext": {
                    "filePath": "/src/app.ts",
                    "leftFileStart": { "line": 8, "offset": 1 }
                },
                "comments": [{ "id": 1, "content": "on the old line" }]
            }
        ]))
        .unwrap();

        let mapped = map_threads(threads, None);
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].left_line, Some(8));
        assert_eq!(mapped[0].right_line, None);
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

    #[test]
    fn validate_merge_strategy_accepts_known_strategies() {
        for strategy in ["noFastForward", "squash", "rebase", "rebaseMerge"] {
            assert!(validate_merge_strategy(strategy).is_ok());
        }
        assert!(validate_merge_strategy("ff").is_err());
        assert!(validate_merge_strategy("").is_err());
    }

    #[test]
    fn change_flags_parse_handles_undelete_and_combined_tokens() {
        let undelete = ChangeFlags::parse("undelete");
        assert!(undelete.is_add);
        assert!(!undelete.is_delete);

        let edit_rename = ChangeFlags::parse("edit, rename");
        assert!(!edit_rename.is_add);
        assert!(!edit_rename.is_delete);

        let delete = ChangeFlags::parse("delete");
        assert!(delete.is_delete);
        assert!(!delete.is_add);
    }

    #[test]
    fn thread_resolved_treats_unknown_as_open() {
        assert!(thread_resolved(Some("closed")));
        assert!(thread_resolved(Some("fixed")));
        assert!(!thread_resolved(Some("active")));
        assert!(!thread_resolved(Some("pending")));
        assert!(!thread_resolved(Some("unknown")));
        assert!(!thread_resolved(None));
    }

    #[test]
    fn root_comment_id_picks_the_thread_root_not_first_visible() {
        let thread: GitThread = serde_json::from_value(serde_json::json!({
            "id": 5,
            "comments": [
                { "id": 10, "parentCommentId": 0, "content": "root" },
                { "id": 11, "parentCommentId": 10, "content": "reply" }
            ]
        }))
        .unwrap();
        assert_eq!(root_comment_id(&thread), 10);
    }
}
