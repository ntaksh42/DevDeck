use azdo_client::{AdoClient, AdoError, GitThread, PullRequestStatus, TeamProject};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;
use crate::sync::{PrNotificationItem, PrNotificationKind};

const PR_SYNC_CONCURRENCY: usize = 4;
// Active PRs across one project; well above what a project realistically has.
const PROJECT_PR_SYNC_TOP: u32 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyReviewPullRequestsInput {
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
    pub my_vote: i32,
    pub my_vote_label: String,
    pub my_is_required: bool,
    pub is_draft: bool,
    pub merge_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPullRequestsInput {
    pub organization_id: Option<String>,
    pub query: Option<String>,
    pub status: Option<String>,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub repository_id: String,
    pub repository_name: String,
    pub pull_request_id: i64,
    pub title: String,
    pub status: String,
    pub created_by: Option<String>,
    pub creation_date: String,
    pub source_ref_name: String,
    pub target_ref_name: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PullRequestService {
    db: AppDatabase,
    #[allow(dead_code)]
    secrets: SecretStore,
}

impl PullRequestService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub fn list_my_reviews(
        &self,
        input: ListMyReviewPullRequestsInput,
    ) -> Result<Vec<ReviewPullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let cached = self.db.list_review_pull_requests(&organization.id)?;
        let mut results: Vec<ReviewPullRequestSummary> = cached
            .into_iter()
            .map(|pr| ReviewPullRequestSummary {
                organization_id: pr.org_id,
                project_id: pr.project_id,
                project_name: pr.project_name,
                repository_id: pr.repository_id,
                repository_name: pr.repository_name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                created_by: pr.created_by,
                creation_date: pr.creation_date,
                target_ref_name: pr.target_ref_name,
                web_url: pr.web_url,
                my_vote: pr.my_vote,
                my_vote_label: pr.my_vote_label,
                my_is_required: pr.my_is_required,
                is_draft: pr.is_draft,
                merge_status: pr.merge_status,
            })
            .collect();
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        Ok(results)
    }

    // Note: cache contains only Active PRs (synced with PullRequestStatus::Active).
    // status filters other than "active" will return 0 results until sync scope is widened.
    pub fn search(&self, input: SearchPullRequestsInput) -> Result<Vec<PullRequestSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let query = input.query.unwrap_or_default().trim().to_ascii_lowercase();
        let project_filter = normalize_optional(input.project_id);
        let repository_filter = normalize_optional(input.repository_id);
        let status_filter = normalize_optional(input.status);
        let cached = self.db.search_pull_requests(
            &organization.id,
            project_filter.as_deref(),
            repository_filter.as_deref(),
            status_filter.as_deref(),
        )?;
        let mut results: Vec<PullRequestSummary> = cached
            .into_iter()
            .map(|pr| PullRequestSummary {
                organization_id: pr.org_id,
                project_id: pr.project_id,
                project_name: pr.project_name,
                repository_id: pr.repository_id,
                repository_name: pr.repository_name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                status: pr.status,
                created_by: pr.created_by,
                creation_date: pr.creation_date,
                source_ref_name: pr.source_ref_name,
                target_ref_name: pr.target_ref_name,
                web_url: pr.web_url,
            })
            .filter(|summary| matches_query(summary, &query))
            .collect();
        results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
        results.truncate(100);
        Ok(results)
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }
}

pub(crate) fn short_ref(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .to_string()
}

pub(crate) fn vote_label(vote: i32) -> &'static str {
    match vote {
        10 => "Approved",
        5 => "Approved w/ Suggestions",
        0 => "No Vote",
        -5 => "Waiting for Author",
        -10 => "Rejected",
        _ => "No Vote",
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "all")
}

fn matches_query(summary: &PullRequestSummary, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }

    // Numeric queries also match the PR number by prefix.
    if query.bytes().all(|b| b.is_ascii_digit())
        && summary.pull_request_id.to_string().starts_with(query)
    {
        return true;
    }

    [
        summary.title.as_str(),
        summary.project_name.as_str(),
        summary.repository_name.as_str(),
        summary.created_by.as_deref().unwrap_or_default(),
        summary.source_ref_name.as_str(),
        summary.target_ref_name.as_str(),
    ]
    .iter()
    .any(|value| value.to_ascii_lowercase().contains(query))
}

fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}

// ── Cache sync ────────────────────────────────────────────────────────────────

struct SyncPrsResult {
    warning: Option<String>,
}

struct PrProjectFetch {
    project_id: String,
    label: String,
    result: Result<Vec<CachedPr>>,
}

pub async fn sync_prs_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("prs:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_prs(db, client, org).await {
        Ok(result) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(
                &scope,
                &org.id,
                Some(&now),
                0,
                None,
                result.warning.as_deref(),
            )?;
            tracing::info!(org = %org.name, "PR sync completed");
            Ok(())
        }
        Err(e) => {
            if let Err(db_err) = db.update_sync_state(
                &scope,
                &org.id,
                None,
                error_count + 1,
                Some(&e.to_string()),
                None,
            ) {
                tracing::warn!(error = ?db_err, "failed to persist sync error state");
            }
            Err(e)
        }
    }
}

async fn do_sync_prs(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<SyncPrsResult> {
    let projects = client.list_projects().await?;
    let mut cached_prs: Vec<CachedPr> = Vec::new();
    let mut synced_project_ids: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut last_skip_error: Option<AppError> = None;
    let mut pr_tasks = JoinSet::new();

    let collect = |fetch: PrProjectFetch,
                   cached_prs: &mut Vec<CachedPr>,
                   synced_project_ids: &mut Vec<String>,
                   skipped: &mut Vec<String>,
                   last_skip_error: &mut Option<AppError>| {
        match fetch.result {
            Ok(prs) => {
                synced_project_ids.push(fetch.project_id);
                cached_prs.extend(prs);
            }
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %fetch.label,
                    error = %e,
                    "PR sync failed for project, preserving cached data"
                );
                skipped.push(fetch.label);
                *last_skip_error = Some(e);
            }
        }
    };

    for project in &projects {
        while pr_tasks.len() >= PR_SYNC_CONCURRENCY {
            let fetch = join_pr_task(&mut pr_tasks).await?;
            collect(
                fetch,
                &mut cached_prs,
                &mut synced_project_ids,
                &mut skipped,
                &mut last_skip_error,
            );
        }
        pr_tasks.spawn(fetch_active_prs_for_project(
            client.clone(),
            org.clone(),
            project.clone(),
        ));
    }
    while !pr_tasks.is_empty() {
        let fetch = join_pr_task(&mut pr_tasks).await?;
        collect(
            fetch,
            &mut cached_prs,
            &mut synced_project_ids,
            &mut skipped,
            &mut last_skip_error,
        );
    }

    // If nothing synced and we have a real error, surface it instead of
    // recording a spurious success.
    if synced_project_ids.is_empty() {
        if let Some(e) = last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = synced_project_ids.iter().map(String::as_str).collect();
    db.replace_pull_requests_for_projects(&org.id, &synced_ids, &cached_prs)?;

    let mut warning_parts: Vec<String> = Vec::new();
    if !skipped.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to PR sync errors: {}.",
            skipped.len(),
            skipped.join(", ")
        ));
    }

    if let Some(user_id) = &org.authenticated_user_id {
        let mut cached_reviews: Vec<CachedReviewPr> = Vec::new();
        let mut review_tasks = JoinSet::new();
        let mut review_failed_projects: Vec<String> = Vec::new();

        for project in &projects {
            while review_tasks.len() >= PR_SYNC_CONCURRENCY {
                let (project_name, result) = join_review_task(&mut review_tasks).await?;
                collect_review_fetch(
                    org,
                    project_name,
                    result,
                    &mut cached_reviews,
                    &mut review_failed_projects,
                );
            }
            review_tasks.spawn(fetch_review_prs_for_project(
                client.clone(),
                org.clone(),
                project.clone(),
                user_id.clone(),
            ));
        }
        while !review_tasks.is_empty() {
            let (project_name, result) = join_review_task(&mut review_tasks).await?;
            collect_review_fetch(
                org,
                project_name,
                result,
                &mut cached_reviews,
                &mut review_failed_projects,
            );
        }

        if review_failed_projects.is_empty() {
            db.replace_review_pull_requests(&org.id, &cached_reviews)?;
        } else {
            // A partial review list would silently drop PRs from the failed
            // projects, so keep the previous cache instead.
            warning_parts.push(format!(
                "Review PR cache was not refreshed; query failed for project(s): {}.",
                review_failed_projects.join(", ")
            ));
        }
    }

    let warning = if warning_parts.is_empty() {
        None
    } else {
        Some(warning_parts.join(" "))
    };
    Ok(SyncPrsResult { warning })
}

fn collect_review_fetch(
    org: &Organization,
    project_name: String,
    result: Result<Vec<CachedReviewPr>>,
    cached_reviews: &mut Vec<CachedReviewPr>,
    review_failed_projects: &mut Vec<String>,
) {
    match result {
        Ok(reviews) => cached_reviews.extend(reviews),
        Err(e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "review PR sync failed for project, preserving cached data"
            );
            review_failed_projects.push(project_name);
        }
    }
}

async fn join_pr_task(tasks: &mut JoinSet<PrProjectFetch>) -> Result<PrProjectFetch> {
    tasks
        .join_next()
        .await
        .expect("PR sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("PR sync task failed: {e}")))
}

async fn join_review_task(
    tasks: &mut JoinSet<(String, Result<Vec<CachedReviewPr>>)>,
) -> Result<(String, Result<Vec<CachedReviewPr>>)> {
    tasks
        .join_next()
        .await
        .expect("review PR sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("review PR sync task failed: {e}")))
}

// One project-level query replaces a request per repository; repositories
// with zero active PRs simply contribute nothing.
async fn fetch_active_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
) -> PrProjectFetch {
    let project_id = project.id.clone();
    let label = project.name.clone();
    let prs = match client
        .list_project_pull_requests(&project.id, PullRequestStatus::Active, PROJECT_PR_SYNC_TOP)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "pull request list returned 404, skipping project"
            );
            // 404 means the project is gone; treat as synced-empty so its
            // stale cached rows are cleaned up.
            return PrProjectFetch {
                project_id,
                label,
                result: Ok(Vec::new()),
            };
        }
        Err(e) => {
            return PrProjectFetch {
                project_id,
                label,
                result: Err(e.into()),
            }
        }
    };

    let cached = prs
        .into_iter()
        .filter_map(|pr| {
            let Some(repo) = pr.repository else {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    pull_request_id = pr.pull_request_id,
                    "pull request response carried no repository; skipping"
                );
                return None;
            };
            let project_name = repo
                .project
                .as_ref()
                .map(|p| p.name.clone())
                .unwrap_or_else(|| project.name.clone());
            let web_url = format!(
                "{}/{}/_git/{}/pullrequest/{}",
                org.base_url,
                encode_path_segment(&project_name),
                encode_path_segment(&repo.name),
                pr.pull_request_id
            );
            Some(CachedPr {
                org_id: org.id.clone(),
                project_id: project.id.clone(),
                project_name,
                repository_id: repo.id,
                repository_name: repo.name,
                pull_request_id: pr.pull_request_id,
                title: pr.title,
                status: pr.status,
                created_by: pr.created_by.and_then(|u| u.display_name.or(u.unique_name)),
                creation_date: pr.creation_date.to_rfc3339(),
                source_ref_name: short_ref(&pr.source_ref_name),
                target_ref_name: short_ref(&pr.target_ref_name),
                web_url: Some(web_url),
            })
        })
        .collect();
    PrProjectFetch {
        project_id,
        label,
        result: Ok(cached),
    }
}

async fn fetch_review_prs_for_project(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    user_id: String,
) -> (String, Result<Vec<CachedReviewPr>>) {
    let project_name = project.name.clone();
    let prs = match client
        .list_pull_requests_by_reviewer(&project.id, &user_id, 200)
        .await
    {
        Ok(prs) => prs,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project.name,
                error = %e,
                "review pull request list returned 404, skipping project"
            );
            return (project_name, Ok(Vec::new()));
        }
        Err(e) => return (project_name, Err(e.into())),
    };

    let mut cached_reviews = Vec::new();
    for pr in prs {
        let Some(repo) = &pr.repository else {
            continue;
        };
        let repo_id = repo.id.clone();
        let repo_name = repo.name.clone();
        let (proj_id, proj_name) = repo
            .project
            .as_ref()
            .map(|p| (p.id.clone(), p.name.clone()))
            .unwrap_or_else(|| (project.id.clone(), project.name.clone()));

        let reviewer = pr
            .reviewers
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .find(|r| r.id.as_deref() == Some(user_id.as_str()));
        let (my_vote, my_is_required) = reviewer
            .map(|r| (r.vote, r.is_required))
            .unwrap_or((0, false));

        let web_url = format!(
            "{}/{}/_git/{}/pullrequest/{}",
            org.base_url,
            encode_path_segment(&proj_name),
            encode_path_segment(&repo_name),
            pr.pull_request_id
        );
        cached_reviews.push(CachedReviewPr {
            org_id: org.id.clone(),
            project_id: proj_id,
            project_name: proj_name,
            repository_id: repo_id,
            repository_name: repo_name,
            pull_request_id: pr.pull_request_id,
            title: pr.title.clone(),
            created_by: pr
                .created_by
                .as_ref()
                .and_then(|u| u.display_name.clone().or(u.unique_name.clone())),
            creation_date: pr.creation_date.to_rfc3339(),
            target_ref_name: short_ref(&pr.target_ref_name),
            web_url: Some(web_url),
            my_vote,
            my_vote_label: vote_label(my_vote).to_string(),
            my_is_required,
            is_draft: pr.is_draft.unwrap_or(false),
            merge_status: pr.merge_status.clone(),
        });
    }
    (project_name, Ok(cached_reviews))
}

// Threads are only fetched for the most recently created review PRs each sync.
pub(crate) const PR_COMMENT_SCAN_LIMIT: usize = 50;

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
    let mut items = Vec::new();
    for pr in reviews.into_iter().take(PR_COMMENT_SCAN_LIMIT) {
        let threads = match client
            .list_pull_request_threads(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await
        {
            Ok(threads) => threads,
            Err(e) => {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "pr-notify: failed to fetch threads");
                continue;
            }
        };
        let last_seen = db
            .get_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id)
            .unwrap_or(None);
        let (hits, max_id) = pr_comment_notification_items(&threads, me.as_deref(), last_seen);
        for hit in hits {
            items.push(PrNotificationItem {
                kind: PrNotificationKind::CommentReply,
                pull_request_id: pr.pull_request_id,
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use serde_json::json;
    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::db::OrganizationDraft;
    use azdo_client::{GitThreadComment, IdentityRef};

    fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
        GitThreadComment {
            id,
            parent_comment_id: None,
            content: Some(content.into()),
            comment_type: Some("text".into()),
            author: Some(IdentityRef {
                id: Some(author_id.into()),
                display_name: Some(author_id.into()),
                unique_name: None,
            }),
            published_date: None,
            is_deleted: false,
        }
    }

    fn thread(id: i64, comments: Vec<GitThreadComment>) -> GitThread {
        GitThread {
            id,
            status: Some("active".into()),
            is_deleted: false,
            comments: Some(comments),
            thread_context: None,
        }
    }

    #[test]
    fn comment_items_suppressed_on_first_observation() {
        let threads = vec![thread(
            1,
            vec![comment(10, "me", "q"), comment(11, "other", "a")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), None);
        assert!(hits.is_empty());
        assert_eq!(max, Some(11));
    }

    #[test]
    fn comment_items_detects_reply_to_my_thread() {
        let threads = vec![thread(
            1,
            vec![comment(10, "me", "q"), comment(12, "other", "a")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(11));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].author.as_deref(), Some("other"));
        assert_eq!(max, Some(12));
    }

    #[test]
    fn comment_items_detects_mention_without_my_thread() {
        let threads = vec![thread(
            1,
            vec![comment(20, "other", "hello @<me-guid> please")],
        )];
        let (hits, _max) = pr_comment_notification_items(&threads, Some("me-guid"), Some(0));
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn comment_items_ignores_my_own_and_seen() {
        let threads = vec![thread(
            1,
            vec![comment(30, "me", "note"), comment(31, "other", "unrelated")],
        )];
        let (hits, _max) = pr_comment_notification_items(&threads, Some("me"), Some(31));
        assert!(hits.is_empty());
    }

    #[test]
    fn comment_items_ignores_unrelated_thread() {
        let threads = vec![thread(
            1,
            vec![comment(40, "alice", "hi"), comment(41, "bob", "yo")],
        )];
        let (hits, max) = pr_comment_notification_items(&threads, Some("me"), Some(0));
        assert!(hits.is_empty());
        assert_eq!(max, Some(41));
    }

    #[tokio::test]
    async fn pr_sync_skips_failing_project_and_preserves_its_cache() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 2,
                "value": [
                    { "id": "project-ok", "name": "Platform" },
                    { "id": "project-bad", "name": "Broken" }
                ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-ok/_apis/git/pullrequests"))
            .and(query_param("searchCriteria.status", "active"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "count": 1,
                "value": [{
                    "pullRequestId": 1,
                    "title": "Fresh PR",
                    "status": "active",
                    "creationDate": "2026-06-09T00:00:00Z",
                    "repository": {
                        "id": "repo-ok",
                        "name": "Good Repo",
                        "project": { "id": "project-ok", "name": "Platform" }
                    },
                    "sourceRefName": "refs/heads/feature",
                    "targetRefName": "refs/heads/main"
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/project-bad/_apis/git/pullrequests"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        let org = db
            .upsert_organization(OrganizationDraft {
                id: "contoso".to_string(),
                name: "contoso".to_string(),
                display_name: None,
                base_url: "https://dev.azure.com/contoso".to_string(),
                auth_provider: "pat".to_string(),
                credential_key: "azdodeck:org:contoso:pat".to_string(),
                authenticated_user_id: None,
                authenticated_user_display_name: None,
                authenticated_user_unique_name: None,
            })
            .unwrap();
        // Pre-existing cached PRs: one in the project that is about to fail
        // (must survive) and one in the healthy project (must be replaced).
        db.replace_pull_requests_for_projects(
            &org.id,
            &["project-bad", "project-ok"],
            &[
                CachedPr {
                    org_id: org.id.clone(),
                    project_id: "project-bad".to_string(),
                    project_name: "Broken".to_string(),
                    repository_id: "repo-bad".to_string(),
                    repository_name: "Bad Repo".to_string(),
                    pull_request_id: 99,
                    title: "Stale but preserved".to_string(),
                    status: "active".to_string(),
                    created_by: None,
                    creation_date: "2026-06-01T00:00:00Z".to_string(),
                    source_ref_name: "feature".to_string(),
                    target_ref_name: "main".to_string(),
                    web_url: None,
                },
                CachedPr {
                    org_id: org.id.clone(),
                    project_id: "project-ok".to_string(),
                    project_name: "Platform".to_string(),
                    repository_id: "repo-ok".to_string(),
                    repository_name: "Good Repo".to_string(),
                    pull_request_id: 98,
                    title: "Closed since last sync".to_string(),
                    status: "active".to_string(),
                    created_by: None,
                    creation_date: "2026-06-01T00:00:00Z".to_string(),
                    source_ref_name: "feature".to_string(),
                    target_ref_name: "main".to_string(),
                    web_url: None,
                },
            ],
        )
        .unwrap();

        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        let client = AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url);

        let result = do_sync_prs(&db, &client, &org).await.unwrap();

        let cached = db.search_pull_requests(&org.id, None, None, None).unwrap();
        let titles: Vec<&str> = cached.iter().map(|pr| pr.title.as_str()).collect();
        assert!(titles.contains(&"Fresh PR"));
        assert!(titles.contains(&"Stale but preserved"));
        // The healthy project was fully replaced, so its stale row is gone.
        assert!(!titles.contains(&"Closed since last sync"));
        assert!(result
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("Broken")));
    }

    #[test]
    fn normalize_optional_trims_and_rejects_blank() {
        assert_eq!(
            normalize_optional(Some(" project-1 ".to_string())),
            Some("project-1".to_string())
        );
        assert_eq!(normalize_optional(Some("all".to_string())), None);
        assert_eq!(normalize_optional(Some(" ".to_string())), None);
        assert_eq!(normalize_optional(None), None);
    }

    #[test]
    fn short_ref_removes_heads_prefix() {
        assert_eq!(short_ref("refs/heads/feature/prs"), "feature/prs");
        assert_eq!(short_ref("refs/tags/v1"), "refs/tags/v1");
    }

    #[test]
    fn matches_query_checks_title_repo_author_and_branches() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 42,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
        };

        assert!(matches_query(&summary, "dashboard"));
        assert!(matches_query(&summary, "test user"));
        assert!(matches_query(&summary, "pr-search"));
        assert!(!matches_query(&summary, "work item"));
    }

    #[test]
    fn matches_query_matches_pr_number_by_prefix() {
        let summary = PullRequestSummary {
            organization_id: "contoso".to_string(),
            project_id: "project-1".to_string(),
            project_name: "Platform".to_string(),
            repository_id: "repo-1".to_string(),
            repository_name: "azdo-dashboard".to_string(),
            pull_request_id: 421,
            title: "Add pull request search".to_string(),
            status: "active".to_string(),
            created_by: Some("Test User".to_string()),
            creation_date: "2026-05-24T00:00:00Z".to_string(),
            source_ref_name: "feature/pr-search".to_string(),
            target_ref_name: "main".to_string(),
            web_url: None,
        };

        assert!(matches_query(&summary, "421"));
        assert!(matches_query(&summary, "42"));
        assert!(!matches_query(&summary, "21"));
    }

    #[test]
    fn is_ado_not_found_only_matches_404_api_errors() {
        assert!(is_ado_not_found(&AdoError::Api {
            status: 404,
            body: "not found".to_string(),
        }));
        assert!(!is_ado_not_found(&AdoError::Api {
            status: 500,
            body: "server error".to_string(),
        }));
        assert!(!is_ado_not_found(&AdoError::Unauthorized));
    }
}
