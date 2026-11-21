//! Fetches the test results of a pipeline's recent runs for flaky detection.
//! A completed build's results do not change until it is retried (which moves
//! its finish time), so observations are cached per build and finish time.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use azdo_client::{AdoClient, Build, BuildListCriteria};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::super::convert::failed_test_name;
use super::super::flaky::{
    classify_flaky_tests, BuildObservation, FlakyTestReport, ListFlakyTestsInput,
    TestRunObservation, DEFAULT_FLAKY_RUNS, MAX_FLAKY_RUNS,
};
use super::PipelineService;

/// Failed results fetched per test run; a run with more is marked incomplete.
const FAILED_RESULTS_PER_RUN: u32 = 300;
/// Builds fetched at the same time.
const PARALLEL_BUILDS: usize = 4;
/// Cached build observations kept before the cache is cleared.
const CACHE_LIMIT: usize = 500;

fn cache() -> &'static Mutex<HashMap<String, BuildObservation>> {
    static CACHE: OnceLock<Mutex<HashMap<String, BuildObservation>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(organization_id: &str, project_id: &str, build: &Build) -> String {
    let finished = build
        .finish_time
        .map(|time| time.to_rfc3339())
        .unwrap_or_default();
    format!("{organization_id}/{project_id}/{}/{finished}", build.id)
}

impl PipelineService {
    /// Compares the failed tests of the definition's recent completed runs.
    /// Runs whose results cannot be fetched are skipped and counted; the call
    /// fails only when every run failed.
    pub async fn list_flaky_tests(&self, input: ListFlakyTestsInput) -> Result<FlakyTestReport> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let top = input
            .runs
            .unwrap_or(DEFAULT_FLAKY_RUNS)
            .clamp(2, MAX_FLAKY_RUNS);
        let mut builds = client
            .list_builds(
                &project.id,
                BuildListCriteria {
                    definition_id: Some(input.definition_id),
                    branch: input.branch,
                    result_filter: None,
                    status_filter: Some("completed".to_string()),
                    requested_for: None,
                    top: Some(top),
                },
            )
            .await?;
        builds.sort_by_key(|build| (build.finish_time, build.id));

        let mut observations: Vec<Option<BuildObservation>> = vec![None; builds.len()];
        let mut pending = Vec::new();
        {
            let cached = cache().lock().unwrap_or_else(|e| e.into_inner());
            for (index, build) in builds.iter().enumerate() {
                match cached.get(&cache_key(&organization.id, &project.id, build)) {
                    Some(observation) => observations[index] = Some(observation.clone()),
                    None => pending.push(index),
                }
            }
        }

        let limit = Arc::new(Semaphore::new(PARALLEL_BUILDS));
        let mut tasks = JoinSet::new();
        for index in pending {
            let build = builds[index].clone();
            let client = client.clone();
            let project_id = project.id.clone();
            let limit = Arc::clone(&limit);
            tasks.spawn(async move {
                let _permit = limit.acquire_owned().await;
                (index, observe_build(&client, &project_id, &build).await)
            });
        }
        let mut skipped = 0i64;
        let mut first_error: Option<AppError> = None;
        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok((index, Ok(observation))) => {
                    let mut cached = cache().lock().unwrap_or_else(|e| e.into_inner());
                    if cached.len() >= CACHE_LIMIT {
                        cached.clear();
                    }
                    cached.insert(
                        cache_key(&organization.id, &project.id, &builds[index]),
                        observation.clone(),
                    );
                    observations[index] = Some(observation);
                }
                Ok((index, Err(error))) => {
                    tracing::warn!(build_id = builds[index].id, %error, "flaky tests: failed to fetch test results");
                    skipped += 1;
                    first_error.get_or_insert(error);
                }
                Err(error) => {
                    tracing::warn!(%error, "flaky tests: fetch task failed");
                    skipped += 1;
                }
            }
        }

        let observations: Vec<BuildObservation> = observations.into_iter().flatten().collect();
        if observations.is_empty() {
            if let Some(error) = first_error {
                return Err(error);
            }
        }
        Ok(FlakyTestReport {
            compared_runs: observations
                .iter()
                .filter(|observation| observation.runs.iter().any(|run| run.total > 0))
                .count() as i64,
            skipped_runs: skipped,
            tests: classify_flaky_tests(&observations),
        })
    }
}

async fn observe_build(
    client: &AdoClient,
    project_id: &str,
    build: &Build,
) -> Result<BuildObservation> {
    let test_runs = client.list_build_test_runs(project_id, build.id).await?;
    let mut runs = Vec::with_capacity(test_runs.len());
    for run in test_runs {
        let failed_count = run.failed_tests();
        let (failed, complete) = if failed_count == 0 {
            (HashSet::new(), true)
        } else {
            let results = client
                .list_failed_test_results(project_id, run.id, FAILED_RESULTS_PER_RUN)
                .await?;
            let complete = results.len() as i64 >= failed_count;
            (results.iter().map(failed_test_name).collect(), complete)
        };
        runs.push(TestRunObservation {
            name: run.name,
            total: run.total_tests,
            failed,
            complete,
        });
    }
    Ok(BuildObservation {
        build_id: build.id,
        build_number: build.build_number.clone(),
        source_version: build.source_version.clone(),
        runs,
    })
}
