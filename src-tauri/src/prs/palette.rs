//! On-demand active PR snapshot: complete paging, reused briefly between keystrokes.
use super::{search::live_pr_to_summary, PullRequestService, PullRequestSummary};
use crate::{
    auth::client_for_organization,
    db::Organization,
    error::{AppError, Result},
};
use azdo_client::AdoClient;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{sync::Mutex, task::JoinSet};

pub(super) type PalettePrCache = Arc<Mutex<HashMap<String, Snapshot>>>;
#[derive(Debug)]
pub(super) struct Snapshot {
    fetched_at: Instant,
    rows: Vec<PullRequestSummary>,
}

impl PullRequestService {
    pub(crate) async fn search_palette(
        &self,
        org_id: &str,
        query: &str,
    ) -> Result<(Vec<PullRequestSummary>, Vec<String>)> {
        let org = self.resolve_organization(Some(org_id))?;
        let client = client_for_organization(&org, &self.secrets)?;
        self.search_palette_with_client(&client, &org, query).await
    }

    pub(crate) async fn search_palette_with_client(
        &self,
        client: &AdoClient,
        org: &Organization,
        query: &str,
    ) -> Result<(Vec<PullRequestSummary>, Vec<String>)> {
        if let Ok(id) = query.parse::<i32>() {
            let pr = client.get_pull_request_by_id(i64::from(id)).await?;
            return Ok((
                pr.filter(|p| p.status == "active")
                    .and_then(|p| live_pr_to_summary(org, "", "", p))
                    .into_iter()
                    .collect(),
                Vec::new(),
            ));
        }
        // Coalesce overlapping requests, including those from superseded input.
        let mut cache = self.palette_cache.lock().await;
        if let Some(snapshot) = cache
            .get(&org.id)
            .filter(|s| s.fetched_at.elapsed() < Duration::from_secs(30))
        {
            return Ok((matching(&snapshot.rows, query), Vec::new()));
        }
        let projects = client.list_projects().await?;
        let mut rows = Vec::new();
        let mut warnings = Vec::new();
        let mut successful = 0;
        for batch in projects.chunks(4) {
            let mut tasks = JoinSet::new();
            for project in batch {
                let client = client.clone();
                let project = project.clone();
                tasks.spawn(async move {
                    let result = client.list_palette_active_pull_requests(&project.id).await;
                    (project, result)
                });
            }
            while let Some(joined) = tasks.join_next().await {
                let (project, result) = joined.map_err(|e| AppError::AzureDevOps(e.to_string()))?;
                match result {
                    Ok(prs) => {
                        successful += 1;
                        rows.extend(prs.into_iter().filter(|p| p.status == "active").filter_map(
                            |p| live_pr_to_summary(org, &project.id, &project.name, p),
                        ));
                    }
                    Err(error) => {
                        warnings.push(format!("PR search in {} failed: {error}", project.name))
                    }
                }
            }
        }
        if successful == 0 && !warnings.is_empty() {
            return Err(AppError::AzureDevOps(warnings.join("; ")));
        }
        let hits = matching(&rows, query);
        // Incomplete snapshots must be retried, never silently reused as complete.
        if warnings.is_empty() {
            cache.insert(
                org.id.clone(),
                Snapshot {
                    fetched_at: Instant::now(),
                    rows,
                },
            );
        }
        Ok((hits, warnings))
    }
}

fn matching(rows: &[PullRequestSummary], query: &str) -> Vec<PullRequestSummary> {
    let needle = query.to_lowercase();
    rows.iter()
        .filter(|p| p.title.to_lowercase().contains(&needle))
        .cloned()
        .collect()
}
