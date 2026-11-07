//! Bounded PR scans with resumable cursors. No global lock spans network I/O.
use super::{
    progressive_scopes::{Criteria, Scope},
    search::live_pr_to_summary,
    PullRequestSearchResult, PullRequestService, PullRequestSummary, SearchPullRequestsInput,
    StopPullRequestSearchInput,
};
use crate::{
    auth::client_for_organization,
    db::Organization,
    error::{AppError, Result},
};
use azdo_client::{AdoClient, PullRequestPageCriteria, PullRequestStatus};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;

const TTL: Duration = Duration::from_secs(600);
const BUDGET: Duration = Duration::from_secs(20);
const RESULT_PAGE: usize = 100;
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
pub(super) type SearchSessions = Arc<Mutex<HashMap<String, Entry>>>;

#[derive(Debug, Clone)]
pub(super) struct Entry {
    org_id: String,
    signature: String,
    token: String,
    touched: Instant,
    running: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    data: Arc<AsyncMutex<Scan>>,
}
#[derive(Debug)]
struct Scan {
    criteria: Criteria,
    initialized: bool,
    scopes: VecDeque<Scope>,
    failed: Vec<(Scope, String)>,
    pending: VecDeque<PullRequestSummary>,
    seen: HashSet<(String, i64)>,
    emitted: usize,
    scanned: usize,
    successful: usize,
}
struct Running(Arc<AtomicBool>);
impl Drop for Running {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl PullRequestService {
    pub(super) async fn search_progressive(
        &self,
        input: SearchPullRequestsInput,
    ) -> Result<PullRequestSearchResult> {
        let org = self.resolve_organization(input.organization_id.as_deref())?;
        // Validate before reading credentials or making requests.
        Criteria::new(&input, &org)?;
        let client = client_for_organization(&org, &self.secrets)?;
        self.search_progressive_with_client(&client, &org, input)
            .await
    }

    pub async fn stop_search(&self, input: StopPullRequestSearchInput) -> Result<()> {
        let org = self.resolve_organization(input.organization_id.as_deref())?;
        let entries = self
            .search_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = entries.get(&input.search_id).filter(|e| e.org_id == org.id) {
            entry.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub(super) async fn search_progressive_with_client(
        &self,
        client: &AdoClient,
        org: &Organization,
        input: SearchPullRequestsInput,
    ) -> Result<PullRequestSearchResult> {
        let criteria = Criteria::new(&input, org)?;
        let id = input
            .search_id
            .as_deref()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            })
            .ok_or_else(|| AppError::InvalidInput("A valid searchId is required".into()))?
            .to_string();
        let signature = signature(&input)?;
        let entry = {
            let mut entries = self
                .search_sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            entries.retain(|_, e| e.running.load(Ordering::Acquire) || e.touched.elapsed() < TTL);
            let entry = if let Some(token) = &input.continuation_token {
                let entry = entries.get_mut(&id).ok_or_else(expired)?;
                if entry.org_id != org.id || entry.signature != signature || &entry.token != token {
                    return Err(AppError::InvalidInput(
                        "Search conditions changed. Run Search again.".into(),
                    ));
                }
                entry.touched = Instant::now();
                entry.clone()
            } else {
                if entries.contains_key(&id) {
                    return Err(AppError::InvalidInput(
                        "Start a new search with a new searchId".into(),
                    ));
                }
                let entry = Entry {
                    org_id: org.id.clone(),
                    signature,
                    token: new_token(),
                    touched: Instant::now(),
                    running: Arc::new(AtomicBool::new(false)),
                    cancelled: Arc::new(AtomicBool::new(false)),
                    data: Arc::new(AsyncMutex::new(Scan {
                        criteria,
                        initialized: false,
                        scopes: VecDeque::new(),
                        failed: Vec::new(),
                        pending: VecDeque::new(),
                        seen: HashSet::new(),
                        emitted: 0,
                        scanned: 0,
                        successful: 0,
                    })),
                };
                entries.insert(id.clone(), entry.clone());
                entry
            };
            if entry
                .running
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return Err(AppError::InvalidInput(
                    "This search is already running".into(),
                ));
            }
            entry.cancelled.store(false, Ordering::Release);
            entry
        };
        let _running = Running(entry.running.clone());
        let mut scan = entry.data.lock().await;
        let started = Instant::now();
        if !scan.initialized {
            scan.scopes = tokio::time::timeout(BUDGET, scan.criteria.scopes(client))
                .await
                .map_err(|_| {
                    AppError::AzureDevOps(
                        "PR search timed out while loading projects. Run Search again.".into(),
                    )
                })??;
            scan.initialized = true;
        }
        if input.retry_failed.unwrap_or(false) {
            let mut retry: VecDeque<_> = std::mem::take(&mut scan.failed)
                .into_iter()
                .map(|(s, _)| s)
                .collect();
            retry.append(&mut scan.scopes);
            scan.scopes = retry;
        }
        let mut pages = 0;
        while scan.pending.len() < RESULT_PAGE
            && pages < 10
            && !entry.cancelled.load(Ordering::Acquire)
        {
            let Some(mut scope) = scan.scopes.pop_front() else {
                break;
            };
            let Some(remaining) = BUDGET.checked_sub(started.elapsed()) else {
                scan.scopes.push_front(scope);
                break;
            };
            let basis = if scope.status == PullRequestStatus::Active || !scan.criteria.closed_basis
            {
                "created"
            } else {
                "closed"
            };
            let page_criteria = PullRequestPageCriteria {
                project: scope.project_id.as_deref(),
                repository: scope.repository_id.as_deref(),
                status: scope.status,
                author: scan.criteria.author.as_deref(),
                reviewer: scan.criteria.reviewer.as_deref(),
                target: scope.target.as_deref(),
                min_time: scan.criteria.from.as_deref(),
                max_time: scan.criteria.to.as_deref(),
                date_basis: basis,
                skip: scope.skip,
                top: 200,
            };
            let page = client.search_pull_request_page(&page_criteria);
            match tokio::time::timeout(remaining, page).await {
                Err(_) => {
                    scan.scopes.push_front(scope);
                    break;
                }
                Ok(Err(error)) => {
                    scan.failed.push((scope, error.to_string()));
                }
                Ok(Ok(prs)) => {
                    scan.successful += 1;
                    scan.scanned += prs.len();
                    if !prs.is_empty() {
                        scope.skip = scope.skip.checked_add(prs.len() as u32).ok_or_else(|| {
                            AppError::InvalidInput(
                                "Too many PRs. Narrow the search conditions.".into(),
                            )
                        })?;
                        for pr in prs {
                            if let Some(summary) = live_pr_to_summary(
                                org,
                                scope.project_id.as_deref().unwrap_or_default(),
                                &scope.project_name,
                                pr,
                            ) {
                                let matches_project = scan.criteria.project_ids.is_empty()
                                    || scan.criteria.project_ids.contains(&summary.project_id);
                                if matches_project
                                    && scan.seen.insert((
                                        summary.repository_id.clone(),
                                        summary.pull_request_id,
                                    ))
                                    && (!scan.criteria.exclude_drafts || !summary.is_draft)
                                    && scan.criteria.query.matches(&summary)
                                {
                                    scan.pending.push_back(summary);
                                }
                            }
                        }
                        scan.scopes.push_back(scope);
                    }
                }
            }
            pages += 1;
        }
        if scan.successful == 0 && !scan.failed.is_empty() && scan.scopes.is_empty() {
            return Err(AppError::AzureDevOps(
                scan.failed
                    .iter()
                    .map(|(s, e)| format!("{}: {e}", s.label()))
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        let count = scan.pending.len().min(RESULT_PAGE);
        let pull_requests = scan.pending.drain(..count).collect::<Vec<_>>();
        scan.emitted += pull_requests.len();
        let has_more = !scan.pending.is_empty() || !scan.scopes.is_empty();
        let complete = !has_more && scan.failed.is_empty();
        let token = new_token();
        if let Some(entry) = self
            .search_sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(&id)
        {
            entry.token = token.clone();
            entry.touched = Instant::now();
        }
        Ok(PullRequestSearchResult {
            pull_requests,
            total: scan.emitted,
            truncated: has_more,
            search_id: Some(id),
            continuation_token: (!complete).then_some(token),
            scanned_count: Some(scan.scanned),
            search_complete: Some(complete),
            has_more: Some(has_more),
            failed_scopes: Some(scan.failed.iter().map(|(s, _)| s.label()).collect()),
            warnings: scan
                .failed
                .iter()
                .map(|(s, e)| format!("{}: {e}", s.label()))
                .collect(),
        })
    }
}
fn new_token() -> String {
    format!("pr-search-{}", NEXT_TOKEN.fetch_add(1, Ordering::Relaxed))
}
fn expired() -> AppError {
    AppError::InvalidInput("Search expired. Run Search again.".into())
}
fn signature(input: &SearchPullRequestsInput) -> Result<String> {
    let mut input = input.clone();
    input.search_id = None;
    input.continuation_token = None;
    input.retry_failed = None;
    input.sort_by = None;
    serde_json::to_string(&input).map_err(|e| AppError::InvalidInput(e.to_string()))
}

#[cfg(test)]
#[path = "progressive_tests.rs"]
mod tests;
