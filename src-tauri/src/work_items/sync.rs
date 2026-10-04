//! Background cache synchronization for work items.
//!
//! `sync_work_items_for_org` is the entry point used by the app-wide sync
//! orchestrator. It runs either a full sync (replacing the cached rows) or a
//! delta sync keyed on `System.ChangedDate`, fetching ids per project via WIQL
//! and hydrating them in batches.

use super::*;

use azdo_client::TeamProject;
use tokio::task::JoinSet;

use crate::shared_cache;
use crate::sync::SyncBudget;

pub(super) const SYNC_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     ORDER BY [System.ChangedDate] DESC";

// StateCategory (not State) so custom process states are covered. Completed
// items are excluded so they neither fill the TOP cap nor inflate the badge.
pub(super) const SYNC_MY_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     AND [System.AssignedTo] = @Me \
     AND [System.StateCategory] NOT IN ('Completed', 'Removed') \
     ORDER BY [System.ChangedDate] DESC";
const SYNC_WORK_ITEM_BATCH_SIZE: usize = 200;
// Between full syncs, only items whose ChangedDate moved past the last sync
// are fetched. Deletions are reconciled by the next full sync.
const FULL_WI_SYNC_INTERVAL_HOURS: i64 = 24;
// WIQL fails with VS402337 when a query would return more than 20,000 items.
// Cap sync queries well below that; ORDER BY ChangedDate DESC keeps the most
// recently changed items.
pub(super) const SYNC_WORK_ITEM_QUERY_TOP: usize = 2000;

pub(super) struct SyncWorkItemsResult {
    warning: Option<String>,
    pub(super) was_full_sync: bool,
}

pub(super) fn full_sync_scope(org_id: &str) -> String {
    format!("internal:wi_full_sync:{org_id}")
}

pub(super) fn wiql_with_changed_date_filter(base: &str, since_date: &str) -> String {
    base.replace(
        " ORDER BY",
        &format!(" AND [System.ChangedDate] >= '{since_date}' ORDER BY"),
    )
}

// Returns the day-precision date for a delta sync, or None when a full sync
// is due (no prior full sync, parse failure, or the interval has elapsed).
pub(super) fn delta_sync_since(db: &AppDatabase, org: &Organization) -> Option<String> {
    let full_at = db
        .get_sync_state(&full_sync_scope(&org.id))
        .ok()??
        .last_synced_at?;
    let last_at = db
        .get_sync_state(&format!("work_items:{}", org.id))
        .ok()??
        .last_synced_at?;
    let full_time = DateTime::parse_from_rfc3339(&full_at)
        .ok()?
        .with_timezone(&Utc);
    let last_time = DateTime::parse_from_rfc3339(&last_at)
        .ok()?
        .with_timezone(&Utc);
    if Utc::now() - full_time >= chrono::Duration::hours(FULL_WI_SYNC_INTERVAL_HOURS) {
        return None;
    }
    // WIQL date literals are day-precision; back off one extra day for safety.
    Some(
        (last_time - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string(),
    )
}

pub(super) struct SyncWorkItemFetchResult {
    items: Vec<CachedWorkItem>,
    queried_count: usize,
}

/// Outcome of syncing one project's work items. `result` is `Ok(None)` for a
/// 404 (skip silently, preserve cache), `Ok(Some((all, my)))` on success, and
/// `Err` for a real error (skip and remember).
struct ProjectWorkItemFetch {
    project_id: String,
    project_name: String,
    #[allow(clippy::type_complexity)]
    result: Result<Option<(SyncWorkItemFetchResult, SyncWorkItemFetchResult)>>,
}

/// Fetches one project's "all" and "my" work items together under a single
/// budget permit, so project-level parallelism is bounded by the shared budget.
///
/// `was_full_sync` decides how the "all" result is written to the shared
/// cache (`shared_cache` module, read by waypoint): a full result replaces
/// that project's rows outright, while a delta result only carries items
/// that changed and must be upserted rather than replacing the snapshot.
#[allow(clippy::too_many_arguments)]
async fn fetch_project_work_items(
    client: AdoClient,
    org: Organization,
    project: TeamProject,
    all_wiql: String,
    fields: Vec<String>,
    budget: SyncBudget,
    was_full_sync: bool,
) -> ProjectWorkItemFetch {
    let _permit = budget.acquire_owned().await;
    let (all_result, my_result) = tokio::join!(
        fetch_sync_work_items(
            &client,
            &org,
            &project.id,
            &project.name,
            &all_wiql,
            fields.clone(),
            "work item",
        ),
        fetch_sync_work_items(
            &client,
            &org,
            &project.id,
            &project.name,
            SYNC_MY_WI_WIQL,
            fields.clone(),
            "my work item",
        ),
    );
    let result = match (all_result, my_result) {
        (Err(e), _) | (_, Err(e)) => Err(e),
        (Ok(None), _) | (_, Ok(None)) => Ok(None),
        (Ok(Some(all)), Ok(Some(my))) => {
            write_all_work_items_to_shared_cache(&org, &project, &all.items, was_full_sync);
            Ok(Some((all, my)))
        }
    };
    ProjectWorkItemFetch {
        project_id: project.id,
        project_name: project.name,
        result,
    }
}

/// Best-effort mirror of the "all work items" result into the shared cache
/// for waypoint's benefit. DevDeck never reads this back for itself (unlike
/// PRs, this sync is not gated on the shared cache's freshness — the
/// full/delta interaction below is intricate enough that adding a read-side
/// skip here was judged not worth the risk); this is a pure write-through.
fn write_all_work_items_to_shared_cache(
    org: &Organization,
    project: &TeamProject,
    items: &[CachedWorkItem],
    was_full_sync: bool,
) {
    let rows: Vec<shared_cache::SharedWorkItem> = items
        .iter()
        .map(|item| shared_cache::SharedWorkItem {
            id: item.id,
            title: item.title.clone(),
            work_item_type: item.work_item_type.clone(),
            state: item.state.clone(),
            assigned_to: item.assigned_to.clone(),
            assigned_to_unique_name: item.assigned_to_unique_name.clone(),
            changed_date: item.changed_date.clone(),
            web_url: item.web_url.clone(),
            tags: item.tags.clone(),
        })
        .collect();
    let outcome = (|| -> Result<()> {
        let mut conn = shared_cache::open()?;
        if was_full_sync {
            shared_cache::write_work_items(&mut conn, &org.name, &project.name, &rows)?;
        } else {
            shared_cache::upsert_work_items(&mut conn, &org.name, &project.name, &rows)?;
        }
        shared_cache::mark_synced(
            &conn,
            &org.name,
            &project.name,
            shared_cache::KIND_WORK_ITEMS,
            shared_cache::SYNCED_BY,
        )
    })();
    if let Err(e) = outcome {
        tracing::warn!(
            org = %org.name,
            project = %project.name,
            error = %e,
            "failed to write work items to the shared cache"
        );
    }
}

pub(crate) async fn sync_work_items_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<()> {
    let scope = format!("work_items:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_work_items(db, client, org, projects, budget).await {
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
            if result.was_full_sync {
                db.update_sync_state(
                    &full_sync_scope(&org.id),
                    &org.id,
                    Some(&now),
                    0,
                    None,
                    None,
                )?;
            }
            tracing::info!(org = %org.name, full = result.was_full_sync, "work item sync completed");
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

pub(super) async fn do_sync_work_items(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    projects: &[TeamProject],
    budget: &SyncBudget,
) -> Result<SyncWorkItemsResult> {
    let fields: Vec<String> = WORK_ITEM_FIELDS.iter().map(ToString::to_string).collect();
    let delta_since = delta_sync_since(db, org);
    let was_full_sync = delta_since.is_none();
    let all_wiql = match delta_since.as_deref() {
        Some(since) => wiql_with_changed_date_filter(SYNC_WI_WIQL, since),
        None => SYNC_WI_WIQL.to_string(),
    };
    let mut all_cached: Vec<CachedWorkItem> = Vec::new();
    let mut my_cached: Vec<CachedWorkItem> = Vec::new();
    let mut synced_project_ids: Vec<String> = Vec::new();
    // Projects whose query hit SYNC_WORK_ITEM_QUERY_TOP: the snapshot is
    // truncated (oldest-changed items dropped), so it must not be used to delete
    // that project's existing cached rows.
    let mut capped_project_ids: Vec<String> = Vec::new();
    let mut skipped_projects: Vec<String> = Vec::new();
    let mut last_skip_error: Option<AppError> = None;
    let mut capped_query_count = 0usize;

    // Fetch every project concurrently, bounded by the shared budget; each
    // project still runs its all/my WIQL queries together internally.
    let mut tasks: JoinSet<ProjectWorkItemFetch> = JoinSet::new();
    for project in projects {
        tasks.spawn(fetch_project_work_items(
            client.clone(),
            org.clone(),
            project.clone(),
            all_wiql.clone(),
            fields.clone(),
            budget.clone(),
            was_full_sync,
        ));
    }

    while let Some(joined) = tasks.join_next().await {
        let fetch = joined
            .map_err(|e| AppError::AzureDevOps(format!("work item sync task failed: {e}")))?;
        match fetch.result {
            // 404 on either query means the project is unreachable; skip it so
            // its cached rows survive.
            Ok(None) => continue,
            Ok(Some((project_all, project_my))) => {
                // Batching a long ID list loses nothing; only reaching the query
                // cap means the WIQL result may have been cut off.
                let capped_queries = [project_all.queried_count, project_my.queried_count]
                    .iter()
                    .filter(|&&count| count >= SYNC_WORK_ITEM_QUERY_TOP)
                    .count();
                capped_query_count += capped_queries;
                if capped_queries > 0 {
                    capped_project_ids.push(fetch.project_id.clone());
                }
                synced_project_ids.push(fetch.project_id);
                all_cached.extend(project_all.items);
                my_cached.extend(project_my.items);
            }
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %fetch.project_name,
                    error = %e,
                    "work item sync failed for project, preserving cached data"
                );
                skipped_projects.push(fetch.project_name);
                last_skip_error = Some(e);
            }
        }
    }

    // If every project failed with a real error (not 404), surface it rather than
    // recording a spurious success with no cache update.
    if synced_project_ids.is_empty() {
        if let Some(e) = last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = synced_project_ids.iter().map(String::as_str).collect();
    if was_full_sync {
        // A full sync replaces a project's rows, deleting any that are missing
        // from the snapshot. For a capped project the snapshot is incomplete, so
        // it is merged like a delta instead: fetched rows are upserted and the
        // rest (still valid upstream) are kept.
        let (capped_all, full_all): (Vec<_>, Vec<_>) = all_cached
            .into_iter()
            .partition(|item| capped_project_ids.contains(&item.project_id));
        let (capped_my, full_my): (Vec<_>, Vec<_>) = my_cached
            .into_iter()
            .partition(|item| capped_project_ids.contains(&item.project_id));
        let replace_ids: Vec<&str> = synced_ids
            .iter()
            .copied()
            .filter(|id| !capped_project_ids.iter().any(|capped| capped == id))
            .collect();
        db.replace_work_items(&org.id, &replace_ids, &full_all, &full_my)?;
        if !capped_project_ids.is_empty() {
            let capped_ids: Vec<&str> = capped_project_ids.iter().map(String::as_str).collect();
            db.apply_work_items_delta(&org.id, &capped_ids, &capped_all, &capped_my)?;
        }
    } else {
        db.apply_work_items_delta(&org.id, &synced_ids, &all_cached, &my_cached)?;
    }

    Ok(SyncWorkItemsResult {
        warning: sync_warning(&skipped_projects, capped_query_count),
        was_full_sync,
    })
}

/// The sync-health warning: projects that failed and were skipped, and query
/// results that reached the `SYNC_WORK_ITEM_QUERY_TOP` cap (older items beyond it
/// are not refreshed, though their cached rows are kept). `None` when clean.
pub(super) fn sync_warning(
    skipped_projects: &[String],
    capped_query_count: usize,
) -> Option<String> {
    let mut warning_parts: Vec<String> = Vec::new();
    if !skipped_projects.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to sync errors: {}.",
            skipped_projects.len(),
            skipped_projects.join(", ")
        ));
    }
    if capped_query_count > 0 {
        warning_parts.push(format!(
            "Work item sync reached the {SYNC_WORK_ITEM_QUERY_TOP}-item query limit in {capped_query_count} query result(s); items older than that window are not refreshed (their cached rows are kept)."
        ));
    }
    (!warning_parts.is_empty()).then(|| warning_parts.join(" "))
}

pub(super) async fn fetch_sync_work_items(
    client: &AdoClient,
    org: &Organization,
    project_id: &str,
    project_name: &str,
    wiql: &str,
    fields: Vec<String>,
    label: &str,
) -> Result<Option<SyncWorkItemFetchResult>> {
    let ids = match client
        .query_work_item_ids(project_id, wiql, Some(SYNC_WORK_ITEM_QUERY_TOP))
        .await
    {
        Ok(ids) => ids,
        Err(e) if is_ado_not_found(&e) => {
            tracing::warn!(
                org = %org.name,
                project = %project_name,
                error = %e,
                "{} query returned 404, skipping project",
                label
            );
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    };
    let queried_count = ids.len();
    if ids.is_empty() {
        return Ok(Some(SyncWorkItemFetchResult {
            items: Vec::new(),
            queried_count,
        }));
    }

    let mut work_items = Vec::new();
    for chunk in ids.chunks(SYNC_WORK_ITEM_BATCH_SIZE) {
        let chunk_work_items = match client
            .get_work_items_batch(project_id, chunk.to_vec(), fields.clone())
            .await
        {
            Ok(work_items) => work_items,
            Err(e) if is_ado_not_found(&e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project_name,
                    error = %e,
                    "{} batch returned 404, skipping project",
                    label
                );
                return Ok(None);
            }
            Err(e) => return Err(e.into()),
        };
        work_items.extend(chunk_work_items);
    }

    Ok(Some(SyncWorkItemFetchResult {
        items: work_items
            .into_iter()
            .map(|wi| work_item_to_cached(org, project_id, project_name, &wi))
            .collect(),
        queried_count,
    }))
}

pub(super) fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}
