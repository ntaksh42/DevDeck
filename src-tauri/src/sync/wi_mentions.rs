//! Work item comments addressed to the user, for the Inbox: mentions
//! (`wi_mention`) and replies (`wi_reply`) — a new comment on a work item the
//! user follows, or after the user's own comment on it.
//!
//! Candidates come from `wi_candidates`. Comments are only fetched for items
//! whose `ChangedDate` moved since the last scan.

use std::collections::{HashMap, HashSet};

use azdo_client::{AdoClient, TeamProject, WorkItemComment};

use crate::db::{AppDatabase, NewInboxItem, Organization, StateInboxRef, WORK_ITEM_CURSOR_KEY};
use crate::prs::{clean_mentions, InboxUpdate};

use super::SyncBudget;

pub(super) const KIND_WI_MENTION: &str = "wi_mention";
pub(super) const KIND_WI_REPLY: &str = "wi_reply";
/// Kinds this scan keeps current.
pub(super) const WI_COMMENT_KINDS: [&str; 2] = [KIND_WI_MENTION, KIND_WI_REPLY];

/// Upper bound of comment fetches per sync pass.
const MAX_COMMENT_FETCHES: usize = 50;
const COMMENTS_PER_ITEM: u32 = 100;
const SNIPPET_CHARS: usize = 140;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkItemCommentHit {
    pub kind: &'static str,
    pub comment_id: i64,
    pub author: Option<String>,
    pub snippet: String,
}

/// Replaces tags with spaces, decodes the few entities Azure DevOps emits and
/// collapses whitespace.
pub(super) fn strip_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            _ => out.push(ch),
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn summarize(text: &str, me: &str) -> String {
    // Mention tokens first: `@<guid>` would otherwise be dropped as a tag.
    let plain = strip_markup(&clean_mentions(text, me));
    if plain.chars().count() <= SNIPPET_CHARS {
        return plain;
    }
    let mut out: String = plain.chars().take(SNIPPET_CHARS - 1).collect();
    out.push('…');
    out
}

fn mentions(text: &str, me: &str) -> bool {
    !me.is_empty() && text.to_ascii_lowercase().contains(&me.to_ascii_lowercase())
}

fn author_id(comment: &WorkItemComment) -> Option<&str> {
    comment.created_by.as_ref().and_then(|a| a.id.as_deref())
}

/// New comments by someone else addressed to `me`, and the newest comment id
/// seen: a mention, or else a reply when the item is `followed` or comes after
/// a comment of `me`. `last_seen == None` is the first observation of the
/// item: nothing is reported (no backfill), only the cursor position.
pub(super) fn work_item_comment_hits(
    comments: &[WorkItemComment],
    me: &str,
    last_seen: Option<i64>,
    followed: bool,
) -> (Vec<WorkItemCommentHit>, Option<i64>) {
    let max_id = comments.iter().map(|c| c.id).max();
    let Some(threshold) = last_seen else {
        return (Vec::new(), max_id);
    };
    let mut hits: Vec<WorkItemCommentHit> = comments
        .iter()
        .filter(|c| c.id > threshold)
        .filter(|c| author_id(c) != Some(me))
        .filter_map(|c| {
            let text = c.text.as_deref()?;
            let after_mine = comments
                .iter()
                .any(|mine| mine.id < c.id && author_id(mine) == Some(me));
            let kind = if mentions(text, me) {
                KIND_WI_MENTION
            } else if followed || after_mine {
                KIND_WI_REPLY
            } else {
                return None;
            };
            Some(WorkItemCommentHit {
                kind,
                comment_id: c.id,
                author: c.created_by.as_ref().and_then(|a| a.display_name.clone()),
                snippet: summarize(text, me),
            })
        })
        .collect();
    hits.sort_by_key(|hit| hit.comment_id);
    (hits, max_id)
}

/// Ids of open mention items the user already answered with a later comment.
pub(super) fn answered_mention_ids(
    comments: &[WorkItemComment],
    me: &str,
    open: &[&StateInboxRef],
) -> Vec<i64> {
    open.iter()
        .filter(|item| {
            comments
                .iter()
                .any(|c| c.id > item.comment_id && author_id(c) == Some(me))
        })
        .map(|item| item.id)
        .collect()
}

fn field_str(item: &azdo_client::WorkItem, name: &str) -> Option<String> {
    item.fields
        .get(name)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}

/// Scans candidate work items and keeps the Inbox's work item comment items
/// current. Returns the update and a Sync health warning, if any.
pub(super) async fn update_work_item_mentions(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> (InboxUpdate, Option<String>) {
    let update = InboxUpdate::default();
    let Some(me) = org.authenticated_user_id.as_deref() else {
        return (update, None);
    };
    let candidates = super::wi_candidates::discover(db, client, org, budget).await;
    let update = scan_candidates(
        db,
        client,
        org,
        projects,
        budget,
        me,
        candidates.ids,
        &candidates.followed,
    )
    .await;
    (update, candidates.warning)
}

#[allow(clippy::too_many_arguments)]
async fn scan_candidates(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
    me: &str,
    ids: Vec<i64>,
    followed: &HashSet<i64>,
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    if ids.is_empty() {
        return update;
    }

    let fields = vec![
        "System.Title".to_string(),
        "System.TeamProject".to_string(),
        "System.ChangedDate".to_string(),
    ];
    let items = {
        let Ok(_permit) = budget.clone().acquire_owned().await else {
            return update;
        };
        match client.get_work_items_batch_org(ids, fields).await {
            Ok(items) => items,
            Err(e) => {
                tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read mentioned work items");
                return update;
            }
        }
    };

    let project_ids: HashMap<String, &TeamProject> = projects
        .iter()
        .map(|project| (project.name.to_ascii_lowercase(), project))
        .collect();
    let open = db
        .unfinished_inbox_refs(&org.id, &WI_COMMENT_KINDS)
        .unwrap_or_default();

    let mut fetches = 0;
    for work_item in items {
        let changed = field_str(&work_item, "System.ChangedDate");
        let cursor = db
            .get_inbox_cursor(&org.id, WORK_ITEM_CURSOR_KEY, work_item.id)
            .unwrap_or(None);
        if let (Some(cursor), Some(changed)) = (&cursor, &changed) {
            if cursor.marker.as_deref() == Some(changed.as_str()) {
                continue;
            }
        }
        if fetches >= MAX_COMMENT_FETCHES {
            break;
        }
        let project_name = field_str(&work_item, "System.TeamProject").unwrap_or_default();
        let Some(project) = project_ids.get(&project_name.to_ascii_lowercase()) else {
            continue;
        };
        fetches += 1;
        let comments = {
            let Ok(_permit) = budget.clone().acquire_owned().await else {
                break;
            };
            match client
                .list_work_item_comments(&project.id, work_item.id, COMMENTS_PER_ITEM)
                .await
            {
                Ok(comments) => comments,
                Err(e) => {
                    tracing::warn!(org = %org.name, work_item = work_item.id, error = ?e, "inbox: failed to read work item comments");
                    continue;
                }
            }
        };

        let (hits, max_id) = work_item_comment_hits(
            &comments,
            me,
            cursor.as_ref().map(|c| c.last_seen_comment_id),
            followed.contains(&work_item.id),
        );
        let title = field_str(&work_item, "System.Title").unwrap_or_default();
        let web_url = format!(
            "{}/{}/_workitems/edit/{}",
            org.base_url, project.name, work_item.id
        );
        let new_items: Vec<NewInboxItem> = hits
            .into_iter()
            .map(|hit| NewInboxItem {
                organization_id: org.id.clone(),
                kind: hit.kind.to_string(),
                subject_id: work_item.id,
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                repository_id: String::new(),
                repository_name: String::new(),
                thread_id: 0,
                comment_id: hit.comment_id,
                title: title.clone(),
                author: hit.author,
                snippet: Some(hit.snippet),
                web_url: Some(web_url.clone()),
                file_path: None,
                line: None,
            })
            .collect();
        match db.insert_inbox_items(&new_items) {
            Ok(count) => update.added += count,
            Err(e) => {
                tracing::warn!(org = %org.name, error = ?e, "inbox: failed to store work item mentions")
            }
        }

        let mine: Vec<&StateInboxRef> = open
            .iter()
            .filter(|item| item.subject_id == work_item.id)
            .collect();
        let answered = answered_mention_ids(&comments, me, &mine);
        if !answered.is_empty() {
            match db.set_inbox_item_state(&answered, "done", None) {
                Ok(count) => update.resolved += count,
                Err(e) => {
                    tracing::warn!(org = %org.name, error = ?e, "inbox: failed to close answered mentions")
                }
            }
        }

        if let Err(e) = db.set_inbox_cursor(
            &org.id,
            WORK_ITEM_CURSOR_KEY,
            work_item.id,
            max_id.unwrap_or(0),
            changed.as_deref(),
        ) {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to update work item cursor");
        }
    }
    update
}

/// States that end a work item; the same list My Work Items leaves out.
const FINISHED_STATES: [&str; 4] = ["Closed", "Done", "Completed", "Removed"];

/// Ids of open mention items whose work item reached a finished state.
pub(super) fn finished_mention_ids(
    items: &[azdo_client::WorkItem],
    open: &[StateInboxRef],
) -> Vec<i64> {
    let finished: Vec<i64> = items
        .iter()
        .filter(|item| {
            field_str(item, "System.State")
                .is_some_and(|state| FINISHED_STATES.contains(&state.as_str()))
        })
        .map(|item| item.id)
        .collect();
    open.iter()
        .filter(|item| finished.contains(&item.subject_id))
        .map(|item| item.id)
        .collect()
}

/// Finishes mention items whose work item was closed or removed. Looks up the
/// state of every work item with an open mention, whether or not it is still
/// among the recent mentions the scan reads comments for.
pub(super) async fn finish_closed_work_item_mentions(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    budget: &SyncBudget,
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let open = db
        .unfinished_inbox_refs(&org.id, &WI_COMMENT_KINDS)
        .unwrap_or_default();
    let mut ids: Vec<i64> = open.iter().map(|item| item.subject_id).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return update;
    }
    let items = {
        let Ok(_permit) = budget.clone().acquire_owned().await else {
            return update;
        };
        match client
            .get_work_items_batch_org(ids, vec!["System.State".to_string()])
            .await
        {
            Ok(items) => items,
            Err(e) => {
                tracing::warn!(org = %org.name, error = ?e, "inbox: failed to read the state of mentioned work items");
                return update;
            }
        }
    };
    let finished = finished_mention_ids(&items, &open);
    if finished.is_empty() {
        return update;
    }
    match db.set_inbox_item_state(&finished, "done", None) {
        Ok(count) => update.resolved += count,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "inbox: failed to close mentions of closed work items")
        }
    }
    update
}
