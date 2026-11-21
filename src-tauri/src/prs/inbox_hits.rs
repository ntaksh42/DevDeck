//! Which PR comments become Inbox items.
//!
//! - A comment that mentions the user is a `pr_mention`; one that mentions a
//!   group/team the user belongs to is a `pr_group_mention`.
//! - Otherwise a comment in a thread the user took part in is a `pr_reply`.
//! - On the user's own PR, a thread the user is not in counts only with its
//!   first comment, so a discussion between other people shows up once.
//! - The first time a PR is seen, only mentions still waiting for the user are
//!   taken (the thread is active and the user has not answered after them), so
//!   a PR that appears in the middle of a discussion keeps its open requests
//!   without flooding the Inbox with history.

use std::collections::HashSet;

use azdo_client::{GitThread, GitThreadComment};

use super::inbox::{thread_needs_action, KIND_PR_MENTION, KIND_PR_REPLY};

pub(crate) const KIND_PR_GROUP_MENTION: &str = "pr_group_mention";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InboxHit {
    pub kind: &'static str,
    pub thread_id: i64,
    pub comment_id: i64,
    pub author: Option<String>,
    pub content: String,
}

// Mentions are stored as `@<GUID>`; matching the id substring catches every
// bracket form without parsing it.
fn contains_id(content: &str, id: &str) -> bool {
    !id.is_empty()
        && content
            .to_ascii_lowercase()
            .contains(&id.to_ascii_lowercase())
}

fn author_id(comment: &GitThreadComment) -> Option<&str> {
    comment.author.as_ref().and_then(|a| a.id.as_deref())
}

fn is_text(comment: &GitThreadComment) -> bool {
    !comment.is_deleted && comment.comment_type.as_deref() != Some("system")
}

fn mention_kind(content: &str, me: &str, groups: &HashSet<String>) -> Option<&'static str> {
    if contains_id(content, me) {
        Some(KIND_PR_MENTION)
    } else if groups.iter().any(|group| contains_id(content, group)) {
        Some(KIND_PR_GROUP_MENTION)
    } else {
        None
    }
}

/// Inbox hits in one PR's threads, and the newest comment id seen (the next
/// cursor). `last_seen == None` is the first observation of the PR.
pub(crate) fn inbox_comment_hits(
    threads: &[GitThread],
    me: &str,
    groups: &HashSet<String>,
    last_seen: Option<i64>,
    authored: bool,
) -> (Vec<InboxHit>, Option<i64>) {
    let mut max_id: Option<i64> = None;
    let mut hits = Vec::new();
    for thread in threads.iter().filter(|thread| !thread.is_deleted) {
        let Some(comments) = thread.comments.as_ref() else {
            continue;
        };
        let mut texts: Vec<&GitThreadComment> = comments.iter().filter(|c| is_text(c)).collect();
        texts.sort_by_key(|c| c.id);
        let i_am_in_thread = texts.iter().any(|c| author_id(c) == Some(me));
        let first_id = texts.first().map(|c| c.id);
        let waiting = thread_needs_action(thread.status.as_deref());
        for comment in comments.iter().filter(|c| !c.is_deleted) {
            max_id = Some(max_id.map_or(comment.id, |m| m.max(comment.id)));
        }
        for comment in &texts {
            if author_id(comment) == Some(me) {
                continue;
            }
            let content = comment.content.as_deref().unwrap_or("");
            let mention = mention_kind(content, me, groups);
            let kind = match last_seen {
                None => {
                    let answered = texts
                        .iter()
                        .any(|c| c.id > comment.id && author_id(c) == Some(me));
                    mention.filter(|_| waiting && !answered)
                }
                Some(seen) if comment.id <= seen => None,
                Some(_) => mention.or_else(|| {
                    (i_am_in_thread || (authored && first_id == Some(comment.id)))
                        .then_some(KIND_PR_REPLY)
                }),
            };
            if let Some(kind) = kind {
                hits.push(InboxHit {
                    kind,
                    thread_id: thread.id,
                    comment_id: comment.id,
                    author: comment.author.as_ref().and_then(|a| a.display_name.clone()),
                    content: content.to_string(),
                });
            }
        }
    }
    (hits, max_id)
}
