use azdo_client::{AdoClient, CommitSearchCriteria, GitRepository, TeamProject};
use chrono::{DateTime, Utc};
use tokio::task::JoinSet;

use crate::db::{AppDatabase, CachedCommit, Organization};
use crate::error::{AppError, Result};
use crate::sync::SyncBudget;

use super::helpers::commit_to_cached;

/// Sync window in days. Must cover the largest date preset offered by the
/// commit search UI (`src/features/commits/CommitSearch.tsx`, 90d) so that
/// preset does not silently return near-empty results.
const COMMIT_SYNC_WINDOW_DAYS: i64 = 90;
/// Between full commit syncs, only commits newer than the last sync are
/// fetched and merged. Force-pushes and deletions are reconciled by the next
/// full sync (which replaces each repository's window).
const FULL_COMMIT_SYNC_INTERVAL_HOURS: i64 = 24;
/// Overlap subtracted from the last sync time when computing a delta window, so
/// commits landing right around the previous boundary are not missed.
const COMMIT_DELTA_OVERLAP_HOURS: i64 = 1;
/// Page size for the paginated commit sync. The REST API caps `$top`, so the
/// sync walks pages with `$skip` until a short page signals the end.
const COMMIT_SYNC_PAGE_SIZE: u32 = 100;
type CommitSyncTaskResult = Result<Option<(String, Vec<CachedCommit>)>>;

pub(crate) fn commit_full_sync_scope(org_id: &str) -> String {
    format!("internal:commit_full_sync:{org_id}")
}

/// Returns the RFC3339 `fromDate` for an incremental commit sync, or `None` when
/// a full sync is due (no prior full sync, parse failure, or the periodic
/// interval has elapsed). Mirrors the work item delta cadence.
fn commit_delta_since(db: &AppDatabase, org: &Organization) -> Option<String> {
    let full_at = db
        .get_sync_state(&commit_full_sync_scope(&org.id))
        .ok()??
        .last_synced_at?;
    let last_at = db
        .get_sync_state(&format!("commits:{}", org.id))
        .ok()??
        .last_synced_at?;
    let full_time = DateTime::parse_from_rfc3339(&full_at)
        .ok()?
        .with_timezone(&Utc);
    let last_time = DateTime::parse_from_rfc3339(&last_at)
        .ok()?
        .with_timezone(&Utc);
    if Utc::now() - full_time >= chrono::Duration::hours(FULL_COMMIT_SYNC_INTERVAL_HOURS) {
        return None;
    }
    Some((last_time - chrono::Duration::hours(COMMIT_DELTA_OVERLAP_HOURS)).to_rfc3339())
}

pub async fn sync_commits_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<()> {
    let scope = format!("commits:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_commits(db, client, org, projects, budget).await {
        Ok(was_full_sync) => {
            let now = Utc::now().to_rfc3339();
            db.update_sync_state(&scope, &org.id, Some(&now), 0, None, None)?;
            if was_full_sync {
                db.update_sync_state(
                    &commit_full_sync_scope(&org.id),
                    &org.id,
                    Some(&now),
                    0,
                    None,
                    None,
                )?;
            }
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
            tracing::error!(org = %org.name, error = %e, "commit sync failed");
            Err(e)
        }
    }
}

/// Runs a commit sync pass. Returns whether it was a full sync (so the caller
/// can advance the full-sync marker). A full sync replaces each repository's
/// 90-day window; a delta sync only fetches and merges commits newer than the
/// last sync.
async fn do_sync_commits(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<bool> {
    let purge_before = (Utc::now() - chrono::Duration::days(COMMIT_SYNC_WINDOW_DAYS)).to_rfc3339();
    let delta_since = commit_delta_since(db, org);
    let is_full_sync = delta_since.is_none();
    let from_date = delta_since.unwrap_or_else(|| purge_before.clone());

    // List every repository across all projects concurrently, then fan out the
    // per-repository commit fetches. Both phases are bounded by the shared
    // budget, so listing no longer serializes project-by-project.
    let repositories = list_all_repositories(client, org, projects, budget).await;

    let mut tasks = JoinSet::new();
    for (project, repository) in repositories {
        tasks.spawn(fetch_commits_for_repo(
            client.clone(),
            org.clone(),
            project,
            repository,
            from_date.clone(),
            budget.clone(),
        ));
    }
    while !tasks.is_empty() {
        if let Some((repository_id, cached)) = join_commit_task(&mut tasks).await? {
            if is_full_sync {
                db.replace_commits_for_repo(&org.id, &repository_id, &cached)?;
            } else {
                db.merge_commits(&cached)?;
            }
        }
    }
    db.purge_old_commits(&org.id, &purge_before)?;
    tracing::info!(org = %org.name, full = is_full_sync, "commit sync completed");
    Ok(is_full_sync)
}

/// Lists repositories for every project concurrently, pairing each with its
/// project. A project whose repository listing fails is logged and skipped so
/// the rest still sync.
async fn list_all_repositories(
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Vec<(TeamProject, GitRepository)> {
    let mut tasks: JoinSet<Vec<(TeamProject, GitRepository)>> = JoinSet::new();
    for project in projects {
        let client = client.clone();
        let org = org.clone();
        let project = project.clone();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire_owned().await;
            match client.list_repositories(&project.id).await {
                Ok(repos) => repos
                    .into_iter()
                    .map(|repo| (project.clone(), repo))
                    .collect(),
                Err(e) => {
                    tracing::warn!(
                        org = %org.name,
                        project = %project.name,
                        error = %e,
                        "failed to list repositories, skipping project"
                    );
                    Vec::new()
                }
            }
        });
    }
    let mut repositories = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(pairs) => repositories.extend(pairs),
            Err(e) => tracing::warn!(error = %e, "repository listing task failed"),
        }
    }
    repositories
}

async fn join_commit_task(tasks: &mut JoinSet<CommitSyncTaskResult>) -> CommitSyncTaskResult {
    tasks
        .join_next()
        .await
        .expect("commit sync task set was unexpectedly empty")
        .map_err(|e| AppError::AzureDevOps(format!("commit sync task failed: {e}")))?
}

async fn fetch_commits_for_repo(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    repository: GitRepository,
    from_date: String,
    budget: SyncBudget,
) -> Result<Option<(String, Vec<CachedCommit>)>> {
    let _permit = budget.acquire_owned().await;
    let repository_id = repository.id.clone();
    let mut cached: Vec<CachedCommit> = Vec::new();
    let mut skip = 0u32;
    loop {
        let page = match client
            .list_commits(
                &project.id,
                &repository.id,
                CommitSearchCriteria {
                    author: None,
                    branch: None,
                    item_path: None,
                    from_date: Some(from_date.clone()),
                    to_date: None,
                    top: Some(COMMIT_SYNC_PAGE_SIZE),
                    skip: Some(skip),
                },
            )
            .await
        {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    repository = %repository.name,
                    error = %e,
                    "failed to list commits, skipping repository"
                );
                return Ok(None);
            }
        };
        let page_len = page.len() as u32;
        cached.extend(page.into_iter().map(|c| {
            commit_to_cached(
                &org,
                &project.id,
                &project.name,
                &repository.id,
                &repository.name,
                c,
            )
        }));
        // A short page (fewer than requested) means the API has no more rows.
        if page_len < COMMIT_SYNC_PAGE_SIZE {
            break;
        }
        skip += page_len;
    }
    Ok(Some((repository_id, cached)))
}
