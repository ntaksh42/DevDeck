use azdo_client::{AdoError, GitThread};

use crate::error::{AppError, Result};

use super::types::{PrComment, PrLocator, PrThread};

pub(super) const MAX_DIFF_CONTENT_BYTES: usize = 256 * 1024;

/// Azure DevOps serializes `VersionControlChangeType` as comma-joined tokens
/// (e.g. "edit, rename", "undelete"). Substring matching misreads "undelete" as
/// a delete, so the tokens are parsed explicitly.
pub(super) struct ChangeFlags {
    pub(super) is_add: bool,
    pub(super) is_delete: bool,
}

impl ChangeFlags {
    pub(super) fn parse(change_type: &str) -> Self {
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
pub(super) fn root_comment_id(thread: &GitThread) -> i64 {
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
pub(super) fn thread_resolved(status: Option<&str>) -> bool {
    matches!(
        status,
        Some("closed") | Some("fixed") | Some("wontFix") | Some("byDesign")
    )
}

pub(super) fn validate_vote(vote: i32) -> Result<()> {
    if matches!(vote, -10 | -5 | 0 | 5 | 10) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "invalid vote value: {vote}"
        )))
    }
}

pub(super) fn validate_thread_status(status: &str) -> Result<()> {
    if matches!(status, "active" | "closed") {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "invalid thread status: {status}"
        )))
    }
}

pub(super) fn validate_merge_strategy(strategy: &str) -> Result<()> {
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

pub(super) async fn fetch_side(
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

pub(super) fn map_threads(threads: Vec<GitThread>, me: Option<&str>) -> Vec<PrThread> {
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
