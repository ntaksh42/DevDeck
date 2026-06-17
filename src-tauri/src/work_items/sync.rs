//! Background cache synchronization for work items.
//!
//! `sync_work_items_for_org` is the entry point used by the app-wide sync
//! orchestrator. It runs either a full sync (replacing the cached rows) or a
//! delta sync keyed on `System.ChangedDate`, fetching ids per project via WIQL
//! and hydrating them in batches.

use super::*;

pub(super) const SYNC_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     ORDER BY [System.ChangedDate] DESC";

const SYNC_MY_WI_WIQL: &str =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
     AND [System.AssignedTo] = @Me \
     ORDER BY [System.ChangedDate] DESC";
const SYNC_WORK_ITEM_BATCH_SIZE: usize = 200;
// Between full syncs, only items whose ChangedDate moved past the last sync
// are fetched. Deletions are reconciled by the next full sync.
const FULL_WI_SYNC_INTERVAL_HOURS: i64 = 24;
// WIQL fails with VS402337 when a query would return more than 20,000 items.
// Cap sync queries well below that; ORDER BY ChangedDate DESC keeps the most
// recently changed items.
const SYNC_WORK_ITEM_QUERY_TOP: usize = 2000;

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

pub(crate) async fn sync_work_items_for_org(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Result<()> {
    let scope = format!("work_items:{}", org.id);
    let error_count = db.get_sync_state(&scope)?.map_or(0, |s| s.error_count);

    match do_sync_work_items(db, client, org).await {
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
) -> Result<SyncWorkItemsResult> {
    let projects = client.list_projects().await?;
    let fields: Vec<String> = WORK_ITEM_FIELDS.iter().map(ToString::to_string).collect();
    let delta_since = delta_sync_since(db, org);
    let all_wiql = match delta_since.as_deref() {
        Some(since) => wiql_with_changed_date_filter(SYNC_WI_WIQL, since),
        None => SYNC_WI_WIQL.to_string(),
    };
    let mut all_cached: Vec<CachedWorkItem> = Vec::new();
    let mut my_cached: Vec<CachedWorkItem> = Vec::new();
    let mut synced_project_ids: Vec<String> = Vec::new();
    let mut skipped_projects: Vec<String> = Vec::new();
    let mut last_skip_error: Option<AppError> = None;
    let mut large_query_count = 0usize;
    let mut largest_query_result = 0usize;

    for project in &projects {
        let (all_result, my_result) = tokio::join!(
            fetch_sync_work_items(
                client,
                org,
                &project.id,
                &project.name,
                &all_wiql,
                fields.clone(),
                "work item",
            ),
            fetch_sync_work_items(
                client,
                org,
                &project.id,
                &project.name,
                SYNC_MY_WI_WIQL,
                fields.clone(),
                "my work item",
            ),
        );

        let project_all = match all_result {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "work item sync failed for project, preserving cached data"
                );
                skipped_projects.push(project.name.clone());
                last_skip_error = Some(e);
                continue;
            }
        };

        let project_my = match my_result {
            Ok(Some(r)) => r,
            // The "my" query 404ing means the project itself is unreachable;
            // skip it entirely so its cached my_work_items rows survive.
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(
                    org = %org.name,
                    project = %project.name,
                    error = %e,
                    "my work item sync failed for project, preserving cached data"
                );
                skipped_projects.push(project.name.clone());
                last_skip_error = Some(e);
                continue;
            }
        };

        synced_project_ids.push(project.id.clone());

        if project_all.queried_count > SYNC_WORK_ITEM_BATCH_SIZE {
            large_query_count += 1;
            largest_query_result = largest_query_result.max(project_all.queried_count);
        }
        all_cached.extend(project_all.items);
        if project_my.queried_count > SYNC_WORK_ITEM_BATCH_SIZE {
            large_query_count += 1;
            largest_query_result = largest_query_result.max(project_my.queried_count);
        }
        my_cached.extend(project_my.items);
    }

    // If every project failed with a real error (not 404), surface it rather than
    // recording a spurious success with no cache update.
    if synced_project_ids.is_empty() {
        if let Some(e) = last_skip_error {
            return Err(e);
        }
    }

    let synced_ids: Vec<&str> = synced_project_ids.iter().map(String::as_str).collect();
    let was_full_sync = delta_since.is_none();
    if was_full_sync {
        db.replace_work_items(&org.id, &synced_ids, &all_cached, &my_cached)?;
    } else {
        db.apply_work_items_delta(&org.id, &synced_ids, &all_cached, &my_cached)?;
    }

    let mut warning_parts: Vec<String> = Vec::new();
    if !skipped_projects.is_empty() {
        warning_parts.push(format!(
            "{} project(s) skipped due to sync errors: {}.",
            skipped_projects.len(),
            skipped_projects.join(", ")
        ));
    }
    if large_query_count > 0 {
        warning_parts.push(format!(
            "Work item sync fetched more than {SYNC_WORK_ITEM_BATCH_SIZE} IDs in {large_query_count} query result(s); largest result had {largest_query_result} IDs and was loaded in batches."
        ));
    }
    let warning = if warning_parts.is_empty() {
        None
    } else {
        Some(warning_parts.join(" "))
    };

    Ok(SyncWorkItemsResult {
        warning,
        was_full_sync,
    })
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
