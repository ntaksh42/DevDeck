//! Work item comments that mention the user, for the Inbox.
//!
//! Candidates come from the organization-wide WIQL macro `@RecentMentions`
//! (items the user was mentioned in over the last 30 days), so one query covers
//! every project. If the macro is not accepted by the service, the scan falls
//! back to the user's most recently changed assigned work items. Comments are
//! only fetched for items whose `ChangedDate` moved since the last scan.

use std::collections::HashMap;

use azdo_client::{AdoClient, TeamProject, WorkItemComment};

use crate::db::{AppDatabase, NewInboxItem, Organization, StateInboxRef, WORK_ITEM_CURSOR_KEY};
use crate::prs::{clean_mentions, InboxUpdate};

use super::SyncBudget;

pub(super) const KIND_WI_MENTION: &str = "wi_mention";

/// Both spellings are tried: the macro is documented for the ID field with the
/// `In` operator, and the parenthesised form is the common WIQL list syntax.
const MENTION_WIQLS: [&str; 2] = [
    "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions) \
     ORDER BY [System.ChangedDate] DESC",
    "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN @RecentMentions \
     ORDER BY [System.ChangedDate] DESC",
];
const MENTION_QUERY_TOP: usize = 50;
/// Upper bound of comment fetches per sync pass.
const MAX_COMMENT_FETCHES: usize = 25;
const COMMENTS_PER_ITEM: u32 = 50;
/// How many assigned items the fallback looks at.
const FALLBACK_ITEMS: usize = 15;
const SNIPPET_CHARS: usize = 140;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkItemMentionHit {
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

/// New comments by someone else that mention `me`, and the newest comment id
/// seen. `last_seen == None` is the first observation of the item: nothing is
/// reported (no backfill), only the cursor position.
pub(super) fn work_item_mention_hits(
    comments: &[WorkItemComment],
    me: &str,
    last_seen: Option<i64>,
) -> (Vec<WorkItemMentionHit>, Option<i64>) {
    let max_id = comments.iter().map(|c| c.id).max();
    let Some(threshold) = last_seen else {
        return (Vec::new(), max_id);
    };
    let mut hits: Vec<WorkItemMentionHit> = comments
        .iter()
        .filter(|c| c.id > threshold)
        .filter(|c| author_id(c) != Some(me))
        .filter_map(|c| {
            let text = c.text.as_deref()?;
            mentions(text, me).then(|| WorkItemMentionHit {
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

async fn discover_ids(
    client: &AdoClient,
    budget: &SyncBudget,
    org: &Organization,
) -> Option<Vec<i64>> {
    for wiql in MENTION_WIQLS {
        let _permit = budget.clone().acquire_owned().await.ok()?;
        match client
            .query_work_item_ids_org(wiql, Some(MENTION_QUERY_TOP))
            .await
        {
            Ok(ids) => return Some(ids),
            Err(e) => {
                tracing::debug!(org = %org.name, error = ?e, "inbox: @RecentMentions query rejected");
            }
        }
    }
    None
}

fn fallback_ids(db: &AppDatabase, org: &Organization) -> Vec<i64> {
    let mut items = db.list_my_work_items(&org.id).unwrap_or_default();
    items.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
    items
        .into_iter()
        .take(FALLBACK_ITEMS)
        .map(|item| item.id)
        .collect()
}

/// Scans candidate work items and keeps the Inbox's `wi_mention` items current.
pub(super) async fn update_work_item_mentions(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> InboxUpdate {
    let mut update = InboxUpdate::default();
    let Some(me) = org.authenticated_user_id.as_deref() else {
        return update;
    };

    let ids = match discover_ids(client, budget, org).await {
        Some(ids) => ids,
        None => {
            tracing::warn!(org = %org.name, "inbox: @RecentMentions unavailable, scanning assigned work items");
            fallback_ids(db, org)
        }
    };
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
        .unfinished_inbox_refs(&org.id, &[KIND_WI_MENTION])
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

        let (hits, max_id) = work_item_mention_hits(
            &comments,
            me,
            cursor.as_ref().map(|c| c.last_seen_comment_id),
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
                kind: KIND_WI_MENTION.to_string(),
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
        .unfinished_inbox_refs(&org.id, &[KIND_WI_MENTION])
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

#[cfg(test)]
mod tests {
    use azdo_client::CommentIdentityRef;

    use super::*;

    // Real ids are GUIDs; a short id would also match ordinary words.
    const ME: &str = "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7";

    fn comment(id: i64, author: &str, text: &str) -> WorkItemComment {
        WorkItemComment {
            id,
            text: Some(text.to_string()),
            rendered_text: None,
            created_date: None,
            created_by: Some(CommentIdentityRef {
                id: Some(author.to_string()),
                display_name: Some(format!("{author}-name")),
                unique_name: None,
            }),
            reactions: Vec::new(),
        }
    }

    #[test]
    fn markup_is_reduced_to_readable_text() {
        assert_eq!(
            strip_markup("<div>Hi <a href=\"#\" data-vss-mention=\"version:2.0,abc\">@Me</a>&nbsp;&amp; <b>you</b></div>"),
            "Hi @Me & you"
        );
    }

    #[test]
    fn first_observation_only_records_the_cursor() {
        let comments = [comment(5, "other", &format!("@<{ME}> look"))];
        let (hits, max) = work_item_mention_hits(&comments, ME, None);
        assert!(hits.is_empty());
        assert_eq!(max, Some(5));
    }

    #[test]
    fn new_mentions_by_others_are_reported_oldest_first() {
        let comments = [
            comment(
                9,
                "tanaka",
                &format!("<div><a data-vss-mention=\"version:2.0,{ME}\">@Me</a> please <b>check</b></div>"),
            ),
            comment(8, "suzuki", &format!("@<{}> second", ME.to_uppercase())),
            comment(7, ME, &format!("@<{ME}> my own note")),
            comment(6, "tanaka", "no mention here"),
            comment(3, "tanaka", &format!("@<{ME}> already seen")),
        ];
        let (hits, max) = work_item_mention_hits(&comments, ME, Some(5));
        assert_eq!(max, Some(9));
        let ids: Vec<i64> = hits.iter().map(|h| h.comment_id).collect();
        assert_eq!(ids, vec![8, 9]);
        assert_eq!(hits[0].snippet, "@you second");
        assert_eq!(hits[1].snippet, "@Me please check");
        assert_eq!(hits[1].author.as_deref(), Some("tanaka-name"));
    }

    #[test]
    fn a_later_comment_by_me_answers_the_mention() {
        let open = [
            StateInboxRef {
                id: 1,
                kind: KIND_WI_MENTION.into(),
                repository_id: String::new(),
                subject_id: 42,
                comment_id: 10,
            },
            StateInboxRef {
                id: 2,
                kind: KIND_WI_MENTION.into(),
                repository_id: String::new(),
                subject_id: 42,
                comment_id: 20,
            },
        ];
        let refs: Vec<&StateInboxRef> = open.iter().collect();
        let comments = [
            comment(10, "tanaka", &format!("@<{ME}> a")),
            comment(15, ME, "done"),
            comment(20, "tanaka", &format!("@<{ME}> b")),
        ];
        assert_eq!(answered_mention_ids(&comments, ME, &refs), vec![1]);
    }

    #[test]
    fn mentions_of_finished_work_items_are_finished() {
        let work_item = |id: i64, state: &str| azdo_client::WorkItem {
            id,
            fields: HashMap::from([("System.State".to_string(), state.into())]),
            links: None,
            relations: Vec::new(),
        };
        let open = [(1, 42), (2, 43), (3, 44)].map(|(id, subject_id)| StateInboxRef {
            id,
            kind: KIND_WI_MENTION.into(),
            repository_id: String::new(),
            subject_id,
            comment_id: 1,
        });
        let items = [
            work_item(42, "Closed"),
            work_item(43, "Active"),
            work_item(44, "Removed"),
        ];
        assert_eq!(finished_mention_ids(&items, &open), vec![1, 3]);
    }
}
