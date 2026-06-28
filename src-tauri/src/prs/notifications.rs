use azdo_client::{AdoClient, GitThread};
use tokio::task::JoinSet;

use crate::db::{AppDatabase, CachedReviewPr, Organization};
use crate::sync::{PrNotificationItem, PrNotificationKind};

// Threads are only fetched for the most recently created review PRs each sync.
pub(crate) const PR_COMMENT_SCAN_LIMIT: usize = 50;
// Concurrent thread fetches, mirroring CI_FETCH_CONCURRENCY so the comment scan
// does not serialize up to 50 network round-trips and block the sync loop.
const PR_COMMENT_FETCH_CONCURRENCY: usize = 6;

pub(crate) struct CommentHit {
    pub author: Option<String>,
    pub snippet: Option<String>,
}

// Azure DevOps stores mentions in comment content as `@<GUID>`. Matching the
// authenticated user's id substring (case-insensitive) catches it without
// depending on the exact bracket form.
fn mentions_user(content: &str, me: &str) -> bool {
    if me.is_empty() {
        return false;
    }
    content
        .to_ascii_lowercase()
        .contains(&me.to_ascii_lowercase())
}

fn truncate_snippet(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Pure detection of comment replies/mentions for a single PR.
///
/// Returns the hits to notify about and the largest comment id observed (used to
/// advance the per-PR "seen" cursor). A `last_seen` of `None` means this PR has
/// never been observed, so nothing is notified (avoids backfilling history) and
/// only the max id is reported. A comment is a hit when it is newer than
/// `last_seen`, authored by someone other than `me`, not a system comment, and
/// either lands in a thread the user has commented in (a reply) or mentions the
/// user.
pub(crate) fn pr_comment_notification_items(
    threads: &[GitThread],
    me: Option<&str>,
    last_seen: Option<i64>,
) -> (Vec<CommentHit>, Option<i64>) {
    let Some(me) = me else {
        return (Vec::new(), None);
    };
    let backfill = last_seen.is_none();
    let threshold = last_seen.unwrap_or(0);
    let mut max_id: Option<i64> = None;
    let mut hits = Vec::new();
    for thread in threads {
        if thread.is_deleted {
            continue;
        }
        let Some(comments) = thread.comments.as_ref() else {
            continue;
        };
        let i_am_in_thread = comments
            .iter()
            .any(|c| c.author.as_ref().and_then(|a| a.id.as_deref()) == Some(me));
        for comment in comments {
            if comment.is_deleted {
                continue;
            }
            max_id = Some(max_id.map_or(comment.id, |m| m.max(comment.id)));
            if backfill || comment.id <= threshold {
                continue;
            }
            let author_id = comment.author.as_ref().and_then(|a| a.id.as_deref());
            if author_id == Some(me) {
                continue;
            }
            if comment.comment_type.as_deref() == Some("system") {
                continue;
            }
            let content = comment.content.as_deref().unwrap_or("");
            if i_am_in_thread || mentions_user(content, me) {
                hits.push(CommentHit {
                    author: comment.author.as_ref().and_then(|a| a.display_name.clone()),
                    snippet: Some(truncate_snippet(content, 90)),
                });
            }
        }
    }
    (hits, max_id)
}

/// Fetches threads for the most recent review PRs, detects new reply/mention
/// comments, advances the per-PR seen cursor, and returns notification items.
/// A failure for one PR is logged and skipped so other PRs still get processed.
pub(crate) async fn collect_pr_comment_notifications(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Vec<PrNotificationItem> {
    let reviews = match db.list_review_pull_requests(&org.id) {
        Ok(reviews) => reviews,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "pr-notify: failed to list review PRs");
            return Vec::new();
        }
    };
    let me = org.authenticated_user_id.clone();
    let scanned: Vec<CachedReviewPr> = reviews.into_iter().take(PR_COMMENT_SCAN_LIMIT).collect();

    // Fetch each PR's threads concurrently (the network round-trip is the slow
    // part); keep results by index so PRs are still processed in their original
    // order below. A failure for one PR is logged and skipped.
    let mut threads_by_index: std::collections::HashMap<usize, Vec<GitThread>> =
        std::collections::HashMap::new();
    let mut tasks: JoinSet<(usize, Option<Vec<GitThread>>)> = JoinSet::new();
    for (index, pr) in scanned.iter().enumerate() {
        let client = client.clone();
        let org_name = org.name.clone();
        let project_id = pr.project_id.clone();
        let repository_id = pr.repository_id.clone();
        let pull_request_id = pr.pull_request_id;
        while tasks.len() >= PR_COMMENT_FETCH_CONCURRENCY {
            if let Some((idx, Some(threads))) = join_comment_task(&mut tasks).await {
                threads_by_index.insert(idx, threads);
            }
        }
        tasks.spawn(async move {
            let value = match client
                .list_pull_request_threads(&project_id, &repository_id, pull_request_id)
                .await
            {
                Ok(threads) => Some(threads),
                Err(e) => {
                    tracing::warn!(org = %org_name, pr = pull_request_id, error = ?e, "pr-notify: failed to fetch threads");
                    None
                }
            };
            (index, value)
        });
    }
    while !tasks.is_empty() {
        if let Some((idx, Some(threads))) = join_comment_task(&mut tasks).await {
            threads_by_index.insert(idx, threads);
        }
    }

    // Detect new comments and advance the seen cursor serially, in PR order, so
    // DB access stays single-threaded and notifications keep a stable order.
    let mut items = Vec::new();
    for (index, pr) in scanned.iter().enumerate() {
        let Some(threads) = threads_by_index.get(&index) else {
            continue;
        };
        let last_seen = db
            .get_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id)
            .unwrap_or(None);
        let (hits, max_id) = pr_comment_notification_items(threads, me.as_deref(), last_seen);
        for hit in hits {
            items.push(PrNotificationItem {
                kind: PrNotificationKind::CommentReply,
                pull_request_id: pr.pull_request_id,
                repository_id: pr.repository_id.clone(),
                title: pr.title.clone(),
                repository_name: pr.repository_name.clone(),
                project_name: pr.project_name.clone(),
                web_url: pr.web_url.clone(),
                comment_author: hit.author,
                snippet: hit.snippet,
            });
        }
        if let Some(max_id) = max_id {
            if let Err(e) =
                db.set_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id, max_id)
            {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "pr-notify: failed to update seen cursor");
            }
        }
    }
    items
}

async fn join_comment_task(
    tasks: &mut JoinSet<(usize, Option<Vec<GitThread>>)>,
) -> Option<(usize, Option<Vec<GitThread>>)> {
    match tasks.join_next().await {
        Some(Ok(result)) => Some(result),
        Some(Err(e)) => {
            tracing::warn!(error = %e, "PR comment thread task failed");
            None
        }
        None => None,
    }
}
