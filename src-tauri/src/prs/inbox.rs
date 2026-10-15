//! Feeds the Inbox from the review-PR comment threads fetched during sync.
//!
//! Detection reuses the notification rules (a comment that replies in a thread
//! the user took part in, or mentions the user) but keeps its own seen cursor,
//! so the Inbox works whether or not desktop notifications are enabled.

use std::collections::HashMap;

use azdo_client::GitThread;

use crate::db::{AppDatabase, NewInboxItem, Organization};

use super::notifications::{pr_comment_hits, ScannedPr};

pub(crate) const KIND_PR_MENTION: &str = "pr_mention";
pub(crate) const KIND_PR_REPLY: &str = "pr_reply";
const INBOX_SNIPPET_CHARS: usize = 140;

/// Thread statuses that mean "someone still has to act".
fn thread_needs_action(status: Option<&str>) -> bool {
    matches!(
        status.map(str::to_ascii_lowercase).as_deref(),
        None | Some("active") | Some("pending") | Some("unknown")
    )
}

/// Replaces Azure DevOps `@<GUID>` mention tokens with readable text: `@you`
/// for the user, `@mention` for anyone else.
pub(crate) fn clean_mentions(content: &str, me: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find("@<") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('>') {
            Some(end) => {
                let id = &after[..end];
                out.push_str(if !me.is_empty() && id.eq_ignore_ascii_case(me) {
                    "@you"
                } else {
                    "@mention"
                });
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn summarize(content: &str, me: &str) -> String {
    let cleaned = clean_mentions(content, me);
    let single_line = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= INBOX_SNIPPET_CHARS {
        return single_line;
    }
    let mut out: String = single_line
        .chars()
        .take(INBOX_SNIPPET_CHARS.saturating_sub(1))
        .collect();
    out.push('…');
    out
}

/// Where a thread sits in the code: its file and the first line on the new
/// side (the old side for a comment on a deleted line). `None` for PR-wide
/// threads.
pub(crate) fn thread_location(thread: &GitThread) -> Option<(String, Option<i64>)> {
    let context = thread.thread_context.as_ref()?;
    let file_path = context.file_path.clone().filter(|path| !path.is_empty())?;
    let line = context
        .right_file_start
        .as_ref()
        .or(context.left_file_start.as_ref())
        .map(|position| position.line);
    Some((file_path, line))
}

/// Ids of open items whose thread no longer needs the user: the thread was
/// resolved or deleted, the comment was deleted, or the user answered after it.
pub(crate) fn resolved_inbox_ids(
    threads: &[GitThread],
    me: Option<&str>,
    open: &[crate::db::OpenInboxRef],
) -> Vec<i64> {
    let by_id: HashMap<i64, &GitThread> = threads.iter().map(|t| (t.id, t)).collect();
    open.iter()
        .filter(|item| {
            let Some(thread) = by_id.get(&item.thread_id) else {
                return true;
            };
            if thread.is_deleted || !thread_needs_action(thread.status.as_deref()) {
                return true;
            }
            let comments = thread.comments.as_deref().unwrap_or(&[]);
            let comment_gone = comments
                .iter()
                .find(|c| c.id == item.comment_id)
                .is_none_or(|c| c.is_deleted);
            if comment_gone {
                return true;
            }
            me.is_some_and(|me| {
                comments.iter().any(|c| {
                    c.id > item.comment_id
                        && !c.is_deleted
                        && c.comment_type.as_deref() != Some("system")
                        && c.author.as_ref().and_then(|a| a.id.as_deref()) == Some(me)
                })
            })
        })
        .map(|item| item.id)
        .collect()
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct InboxUpdate {
    pub added: usize,
    pub resolved: usize,
}

impl InboxUpdate {
    pub fn changed(&self) -> bool {
        self.added > 0 || self.resolved > 0
    }
}

/// Adds Inbox items for new mentions/replies and closes items whose thread was
/// handled. Failures are logged per PR and never stop the sync.
pub(crate) fn update_action_inbox(
    db: &AppDatabase,
    org: &Organization,
    scanned: &[ScannedPr],
) -> InboxUpdate {
    let me = org.authenticated_user_id.as_deref();
    let mut update = InboxUpdate::default();
    for ScannedPr {
        pr,
        authored,
        threads,
    } in scanned
    {
        let last_seen = db
            .get_inbox_comment_cursor(&org.id, &pr.repository_id, pr.pull_request_id)
            .unwrap_or(None);
        let (hits, max_id) = pr_comment_hits(threads, me, last_seen, *authored);
        let locations: HashMap<i64, (String, Option<i64>)> = threads
            .iter()
            .filter_map(|thread| thread_location(thread).map(|location| (thread.id, location)))
            .collect();
        let new_items: Vec<NewInboxItem> = hits
            .into_iter()
            .map(|hit| {
                let location = locations.get(&hit.thread_id).cloned();
                NewInboxItem {
                    organization_id: org.id.clone(),
                    kind: if hit.mentions_me {
                        KIND_PR_MENTION
                    } else {
                        KIND_PR_REPLY
                    }
                    .to_string(),
                    subject_id: pr.pull_request_id,
                    project_id: pr.project_id.clone(),
                    project_name: pr.project_name.clone(),
                    repository_id: pr.repository_id.clone(),
                    repository_name: pr.repository_name.clone(),
                    thread_id: hit.thread_id,
                    comment_id: hit.comment_id,
                    title: pr.title.clone(),
                    author: hit.author,
                    snippet: Some(summarize(&hit.content, me.unwrap_or_default())),
                    web_url: pr.web_url.clone(),
                    line: location.as_ref().and_then(|(_, line)| *line),
                    file_path: location.map(|(path, _)| path),
                }
            })
            .collect();
        // The cursor moves past the new comments only once they are stored;
        // otherwise the next sync would skip them for good.
        let stored = match db.insert_inbox_items(&new_items) {
            Ok(count) => {
                update.added += count;
                true
            }
            Err(e) => {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "inbox: failed to store items");
                false
            }
        };
        if let Some(max_id) = max_id.filter(|_| stored) {
            if let Err(e) =
                db.set_inbox_comment_cursor(&org.id, &pr.repository_id, pr.pull_request_id, max_id)
            {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "inbox: failed to update cursor");
            }
        }
        match db.open_inbox_refs_for_pr(&org.id, &pr.repository_id, pr.pull_request_id) {
            Ok(open) => {
                for item in &open {
                    if let Some((path, line)) = locations.get(&item.thread_id) {
                        if let Err(e) = db.backfill_inbox_location(item.id, path, *line) {
                            tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "inbox: failed to store a thread location");
                        }
                    }
                }
                let done = resolved_inbox_ids(threads, me, &open);
                if done.is_empty() {
                    continue;
                }
                match db.set_inbox_item_state(&done, "done", None) {
                    Ok(count) => update.resolved += count,
                    Err(e) => {
                        tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "inbox: failed to close handled items")
                    }
                }
            }
            Err(e) => {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "inbox: failed to read open items")
            }
        }
    }
    update
}
