//! The overview DevDeck gives the Home Bot: what waits on the user across
//! every connection, read from the sync cache only (no Azure DevOps calls),
//! plus the targets a suggestion or a worker may name.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use chrono::{DateTime, Utc};

use crate::agent_notes::AgentNoteService;
use crate::db::{AppDatabase, InboxListState};
use crate::error::Result;

/// Longest overview handed to the agent.
const MAX_CHARS: usize = 60_000;
const MAX_PER_SECTION: usize = 40;

/// Something a suggestion or a worker can be about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    /// `pr:{org}/{repositoryId}/{id}` or `wi:{org}/{id}`.
    pub key: String,
    /// `!798` / `#4521`.
    pub label: String,
    pub title: String,
    pub repository: Option<String>,
    pub web_url: Option<String>,
}

pub(crate) struct Snapshot {
    pub markdown: String,
    pub targets: BTreeMap<String, Target>,
}

impl Snapshot {
    pub(crate) fn target(&self, key: &str) -> Option<&Target> {
        self.targets.get(key.trim())
    }
}

fn days_since(date: &str, now: DateTime<Utc>) -> Option<i64> {
    DateTime::parse_from_rfc3339(date)
        .ok()
        .map(|d| (now - d.with_timezone(&Utc)).num_days())
}

fn age(date: Option<&str>, now: DateTime<Utc>) -> String {
    date.and_then(|d| days_since(d, now))
        .map(|days| format!("{days}d"))
        .unwrap_or_else(|| "?".into())
}

pub(crate) fn build(db: &AppDatabase, now: DateTime<Utc>) -> Result<Snapshot> {
    let mut targets = BTreeMap::new();
    let mut add = |target: Target| -> String {
        let key = target.key.clone();
        targets.entry(key.clone()).or_insert(target);
        key
    };
    let mut md = String::new();
    let _ = writeln!(
        md,
        "# What waits on the user ({})\n",
        now.format("%Y-%m-%d %H:%M UTC")
    );
    let _ = writeln!(
        md,
        "Lines start with a target key in brackets; use it as `target` when a suggestion or worker is about that item.\n"
    );

    for org in db.list_organizations()? {
        let org_id = org.id.clone();
        let _ = writeln!(
            md,
            "## Connection {}\n",
            org.display_name.as_deref().unwrap_or(&org.name)
        );

        let inbox =
            db.list_inbox_items(Some(&org_id), InboxListState::Open, MAX_PER_SECTION as u32)?;
        let _ = writeln!(
            md,
            "### Inbox: comments addressed to the user, not handled ({})",
            inbox.len()
        );
        for item in &inbox {
            let is_pr = item.kind.starts_with("pr_");
            let key = add(if is_pr {
                Target {
                    key: format!("pr:{org_id}/{}/{}", item.repository_id, item.subject_id),
                    label: format!("!{}", item.subject_id),
                    title: item.title.clone(),
                    repository: Some(item.repository_name.clone()),
                    web_url: item.web_url.clone(),
                }
            } else {
                Target {
                    key: format!("wi:{org_id}/{}", item.subject_id),
                    label: format!("#{}", item.subject_id),
                    title: item.title.clone(),
                    repository: None,
                    web_url: item.web_url.clone(),
                }
            });
            let verdict = item
                .insight
                .as_ref()
                .and_then(|i| i.verdict.clone())
                .map(|v| format!(", judgment: {v}"))
                .unwrap_or_default();
            let snippet: String = item
                .snippet
                .as_deref()
                .unwrap_or("")
                .chars()
                .take(200)
                .collect();
            let _ = writeln!(
                md,
                "- [{key}] {} \"{}\" — {} by {}, {} ago{verdict}: {}",
                if is_pr {
                    format!("!{}", item.subject_id)
                } else {
                    format!("#{}", item.subject_id)
                },
                item.title,
                item.kind,
                item.author.as_deref().unwrap_or("someone"),
                age(Some(&item.detected_at), now),
                snippet.replace('\n', " ")
            );
        }

        let reviews = db.list_review_pull_requests(&org_id)?;
        let _ = writeln!(
            md,
            "\n### Pull requests the user reviews ({})",
            reviews.len()
        );
        for pr in reviews.iter().take(MAX_PER_SECTION) {
            let key = add(Target {
                key: format!("pr:{org_id}/{}/{}", pr.repository_id, pr.pull_request_id),
                label: format!("!{}", pr.pull_request_id),
                title: pr.title.clone(),
                repository: Some(pr.repository_name.clone()),
                web_url: pr.web_url.clone(),
            });
            let _ = writeln!(
                md,
                "- [{key}] !{} \"{}\" in {} by {} — opened {} ago, my vote: {}{}{}, CI: {}, merge: {}",
                pr.pull_request_id,
                pr.title,
                pr.repository_name,
                pr.created_by.as_deref().unwrap_or("?"),
                age(Some(&pr.creation_date), now),
                pr.my_vote_label,
                if pr.my_is_required { " (required)" } else { "" },
                if pr.is_draft { ", draft" } else { "" },
                pr.ci_status.as_deref().unwrap_or("unknown"),
                pr.merge_status.as_deref().unwrap_or("unknown"),
            );
        }

        if let Some(user_id) = org.authenticated_user_id.as_deref() {
            let mine = db.list_created_pull_requests(&org_id, user_id)?;
            let _ = writeln!(md, "\n### Pull requests the user created ({})", mine.len());
            for created in mine.iter().take(MAX_PER_SECTION) {
                let pr = &created.pr;
                let key = add(Target {
                    key: format!("pr:{org_id}/{}/{}", pr.repository_id, pr.pull_request_id),
                    label: format!("!{}", pr.pull_request_id),
                    title: pr.title.clone(),
                    repository: Some(pr.repository_name.clone()),
                    web_url: pr.web_url.clone(),
                });
                let ready = db
                    .pr_ready_to_merge(&org_id, &pr.repository_id, pr.pull_request_id)
                    .unwrap_or(false);
                let _ = writeln!(
                    md,
                    "- [{key}] !{} \"{}\" in {} — opened {} ago, approvals {}/{}{}{}",
                    pr.pull_request_id,
                    pr.title,
                    pr.repository_name,
                    age(Some(&pr.creation_date), now),
                    created.approvals,
                    created.reviewer_count,
                    if pr.is_draft { ", draft" } else { "" },
                    if ready { ", ready to merge" } else { "" },
                );
            }
        }

        let items = db.list_my_work_items(&org_id)?;
        let _ = writeln!(
            md,
            "\n### Work items assigned to the user ({})",
            items.len()
        );
        for wi in items.iter().take(MAX_PER_SECTION) {
            let key = add(Target {
                key: format!("wi:{org_id}/{}", wi.id),
                label: format!("#{}", wi.id),
                title: wi.title.clone(),
                repository: None,
                web_url: wi.web_url.clone(),
            });
            let _ = writeln!(
                md,
                "- [{key}] #{} {} \"{}\" — state {}, changed {} ago",
                wi.id,
                wi.work_item_type.as_deref().unwrap_or("Item"),
                wi.title,
                wi.state.as_deref().unwrap_or("?"),
                age(wi.changed_date.as_deref(), now),
            );
        }
        md.push('\n');
    }

    let asks = AgentNoteService::new(db.clone())
        .list_asks()
        .unwrap_or_default();
    let waiting: Vec<_> = asks
        .iter()
        .flat_map(|ask| ask.notes.iter().map(move |note| (ask.item_id, note)))
        .filter(|(_, note)| {
            note.status == "open"
                && note
                    .replies
                    .last()
                    .is_some_and(|reply| reply.author != "user")
        })
        .take(MAX_PER_SECTION)
        .collect();
    let _ = writeln!(
        md,
        "## Agent conversations waiting on the user ({})",
        waiting.len()
    );
    for (ask_id, note) in waiting {
        let first: String = note
            .body
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(120)
            .collect();
        let _ = writeln!(
            md,
            "- ask-{ask_id}: \"{first}\" ({})",
            note.context.as_deref().unwrap_or("no subject")
        );
    }
    md.push_str("\nPipelines are not in this overview: DevDeck does not cache them.\n");
    if md.len() > MAX_CHARS {
        let cut = md
            .char_indices()
            .nth(MAX_CHARS)
            .map(|(i, _)| i)
            .unwrap_or(md.len());
        md.truncate(cut);
        md.push_str("\n…(cut)\n");
    }
    Ok(Snapshot {
        markdown: md,
        targets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_cache_still_gives_an_overview() {
        let dir = tempfile::tempdir().unwrap();
        let db = AppDatabase::new(dir.path().join("t.sqlite3"));
        db.initialize().unwrap();
        let snapshot = build(&db, Utc::now()).unwrap();
        assert!(snapshot.markdown.contains("What waits on the user"));
        assert!(snapshot.targets.is_empty());
    }
}
