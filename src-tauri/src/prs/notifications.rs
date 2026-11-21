use azdo_client::{AdoClient, GitThread};
use tokio::task::JoinSet;

use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::sync::{PrNotificationItem, PrNotificationKind, SyncBudget};

// Threads are only fetched for the most recently created review PRs each sync.
pub(crate) const PR_COMMENT_SCAN_LIMIT: usize = 100;
// ...and for the user's own most recent active PRs (Inbox only), so replies to
// the user's PRs show up without listing them live on every sync.
pub(crate) const AUTHORED_PR_SCAN_LIMIT: usize = 60;
// Concurrent thread fetches, mirroring CI_FETCH_CONCURRENCY so the comment scan
// does not serialize up to 50 network round-trips and block the sync loop.
const PR_COMMENT_FETCH_CONCURRENCY: usize = 6;

pub(crate) struct CommentHit {
    pub author: Option<String>,
    pub snippet: Option<String>,
}

/// The few fields a comment scan needs from a cached PR, whichever cache it
/// came from (review PRs or the user's own PRs).
#[derive(Debug, Clone)]
pub(crate) struct PrScanTarget {
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub web_url: Option<String>,
}

impl From<CachedReviewPr> for PrScanTarget {
    fn from(pr: CachedReviewPr) -> Self {
        Self {
            project_id: pr.project_id,
            project_name: pr.project_name,
            repository_id: pr.repository_id,
            repository_name: pr.repository_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title,
            web_url: pr.web_url,
        }
    }
}

impl From<CachedPr> for PrScanTarget {
    fn from(pr: CachedPr) -> Self {
        Self {
            project_id: pr.project_id,
            project_name: pr.project_name,
            repository_id: pr.repository_id,
            repository_name: pr.repository_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title,
            web_url: pr.web_url,
        }
    }
}

/// A PR together with its fetched comment threads. One fetch feeds both the
/// notification pass and the Inbox pass so the API is hit once per sync.
pub(crate) struct ScannedPr {
    pub pr: PrScanTarget,
    /// The user wrote this PR (as opposed to being asked to review it). Any new
    /// comment from someone else matters there, not only replies and mentions.
    pub authored: bool,
    pub threads: Vec<GitThread>,
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
            let mentions_me = mentions_user(content, me);
            if i_am_in_thread || mentions_me {
                hits.push(CommentHit {
                    author: comment.author.as_ref().and_then(|a| a.display_name.clone()),
                    snippet: Some(truncate_snippet(content, 90)),
                });
            }
        }
    }
    (hits, max_id)
}

/// The PRs whose threads one sync scanned, and a warning when a scan cap left
/// some PRs out (shown as "Limited" in Sync health).
pub(crate) struct PrThreadScan {
    pub prs: Vec<ScannedPr>,
    pub warning: Option<String>,
}

/// What the scan caps left out, as a Sync health message.
pub(crate) fn scan_limit_warning(skipped_reviews: usize, skipped_own: usize) -> Option<String> {
    let mut parts = Vec::new();
    if skipped_reviews > 0 {
        parts.push(format!(
            "{skipped_reviews} older review PR(s) beyond the newest {PR_COMMENT_SCAN_LIMIT}"
        ));
    }
    if skipped_own > 0 {
        parts.push(format!(
            "{skipped_own} older PR(s) of yours beyond the newest {AUTHORED_PR_SCAN_LIMIT}"
        ));
    }
    (!parts.is_empty()).then(|| {
        format!(
            "Inbox did not read the comments of {}.",
            parts.join(" and ")
        )
    })
}

/// Review PRs plus the user's own active PRs, newest first and capped, each
/// flagged with whether the user authored it, and the cap warning.
fn scan_targets(
    db: &AppDatabase,
    org: &Organization,
) -> (Vec<(PrScanTarget, bool)>, Option<String>) {
    let reviews = match db.list_review_pull_requests(&org.id) {
        Ok(reviews) => reviews,
        Err(e) => {
            tracing::warn!(org = %org.name, error = ?e, "pr-notify: failed to list review PRs");
            return (Vec::new(), None);
        }
    };
    let skipped_reviews = reviews.len().saturating_sub(PR_COMMENT_SCAN_LIMIT);
    let mut skipped_own = 0;
    let mut targets: Vec<(PrScanTarget, bool)> = reviews
        .into_iter()
        .take(PR_COMMENT_SCAN_LIMIT)
        .map(|pr| (PrScanTarget::from(pr), false))
        .collect();

    if let Some(me) = org.authenticated_user_id.as_deref() {
        let mut own: Vec<CachedPr> = db
            .search_pull_requests(&org.id, None, None, Some("active"))
            .unwrap_or_default()
            .into_iter()
            .filter(|pr| pr.created_by_id.as_deref() == Some(me))
            .collect();
        own.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        skipped_own = own.len().saturating_sub(AUTHORED_PR_SCAN_LIMIT);
        for pr in own.into_iter().take(AUTHORED_PR_SCAN_LIMIT) {
            let already_scanned = targets.iter().any(|(target, _)| {
                target.repository_id == pr.repository_id
                    && target.pull_request_id == pr.pull_request_id
            });
            if !already_scanned {
                targets.push((PrScanTarget::from(pr), true));
            }
        }
    }
    (targets, scan_limit_warning(skipped_reviews, skipped_own))
}

/// Fetches the comment threads of the PRs to scan. A failure for one PR is
/// logged and that PR is left out, so the others still get processed.
pub(crate) async fn fetch_pr_threads(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    budget: &SyncBudget,
) -> PrThreadScan {
    let (scanned, warning) = scan_targets(db, org);

    // Fetch each PR's threads concurrently (the network round-trip is the slow
    // part); keep results by index so PRs are still processed in their original
    // order below. A failure for one PR is logged and skipped.
    let mut threads_by_index: std::collections::HashMap<usize, Vec<GitThread>> =
        std::collections::HashMap::new();
    let mut tasks: JoinSet<(usize, Option<Vec<GitThread>>)> = JoinSet::new();
    for (index, (pr, _)) in scanned.iter().enumerate() {
        let client = client.clone();
        let org_name = org.name.clone();
        let project_id = pr.project_id.clone();
        let repository_id = pr.repository_id.clone();
        let pull_request_id = pr.pull_request_id;
        let budget = budget.clone();
        while tasks.len() >= PR_COMMENT_FETCH_CONCURRENCY {
            if let Some((idx, Some(threads))) = join_comment_task(&mut tasks).await {
                threads_by_index.insert(idx, threads);
            }
        }
        tasks.spawn(async move {
            // Share the sync-wide request budget with the other sync passes.
            let _permit = budget.acquire_owned().await;
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

    let prs = scanned
        .into_iter()
        .enumerate()
        .filter_map(|(index, (pr, authored))| {
            threads_by_index.remove(&index).map(|threads| ScannedPr {
                pr,
                authored,
                threads,
            })
        })
        .collect();
    PrThreadScan { prs, warning }
}

/// Detects new reply/mention comments in the fetched threads, advances the
/// per-PR seen cursor, and returns notification items. Serial, in PR order, so
/// DB access stays single-threaded and notifications keep a stable order.
pub(crate) fn pr_comment_notifications_from(
    db: &AppDatabase,
    org: &Organization,
    scanned: &[ScannedPr],
) -> Vec<PrNotificationItem> {
    let me = org.authenticated_user_id.clone();
    let mut items = Vec::new();
    // Replies to the user's own PRs are an Inbox feature; notifications keep
    // covering review PRs only.
    for ScannedPr { pr, threads, .. } in scanned.iter().filter(|scanned| !scanned.authored) {
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
