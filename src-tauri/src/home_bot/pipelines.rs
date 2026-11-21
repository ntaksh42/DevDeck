//! Watched pipelines in the Look around overview. The Pipelines view keeps
//! its watch list in the browser, so it pushes a copy here on every change;
//! each look reads the latest run of each watched pipeline from the API.

use std::fmt::Write as _;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::snapshot::Target;
use super::store;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::pipelines::{ListPipelineRunsInput, PipelineRunSummary, PipelineService};
use crate::secrets::SecretStore;

const WATCH_KEY: &str = "home_bot_pipelines";
/// Watched pipelines a look reads (the Pipelines view allows 100).
pub(crate) const MAX_WATCHED: usize = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedPipeline {
    pub organization_id: String,
    pub project_id: String,
    pub project_name: String,
    pub definition_id: i64,
    pub definition_name: String,
}

pub(crate) fn save_watch(conn: &Connection, list: &[WatchedPipeline]) -> Result<()> {
    let list: Vec<&WatchedPipeline> = list.iter().take(MAX_WATCHED).collect();
    let json = serde_json::to_string(&list)
        .map_err(|e| crate::error::AppError::InvalidInput(e.to_string()))?;
    store::set_kv(conn, WATCH_KEY, &json)
}

pub(crate) fn load_watch(conn: &Connection) -> Vec<WatchedPipeline> {
    store::get_kv(conn, WATCH_KEY)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

/// The latest run of each watched pipeline (an error message when it could
/// not be read).
fn latest_runs(
    db: &AppDatabase,
    watch: &[WatchedPipeline],
) -> Vec<(
    WatchedPipeline,
    std::result::Result<Option<PipelineRunSummary>, String>,
)> {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return Vec::new();
    };
    let service = PipelineService::new(db.clone(), SecretStore);
    runtime.block_on(async {
        let mut rows = Vec::new();
        for pipeline in watch.iter().take(MAX_WATCHED) {
            let runs = service
                .list_runs(ListPipelineRunsInput {
                    organization_id: Some(pipeline.organization_id.clone()),
                    project_id: pipeline.project_id.clone(),
                    definition_id: Some(pipeline.definition_id),
                    branch: None,
                    result: None,
                    status: None,
                    requested_for_me: None,
                })
                .await
                .map(|runs| runs.into_iter().next())
                .map_err(|e| e.to_string());
            rows.push((pipeline.clone(), runs));
        }
        rows
    })
}

/// Whether a run is worth the user's attention: it failed, partly failed or
/// was cancelled.
fn needs_attention(run: &PipelineRunSummary) -> bool {
    matches!(
        run.result.as_deref(),
        Some("failed" | "partiallySucceeded" | "canceled")
    )
}

/// The target a suggestion about a failing pipeline names; it opens the run.
fn target(pipeline: &WatchedPipeline, run: &PipelineRunSummary) -> Target {
    Target {
        key: format!(
            "pipe:{}/{}/{}",
            pipeline.organization_id, pipeline.project_id, pipeline.definition_id
        ),
        label: pipeline.definition_name.clone(),
        title: pipeline.definition_name.clone(),
        repository: None,
        web_url: Some(run.web_url.clone()),
    }
}

/// The overview section and the failing pipelines as targets. Healthy
/// pipelines are counted, not listed.
pub(crate) fn section(
    rows: &[(
        WatchedPipeline,
        std::result::Result<Option<PipelineRunSummary>, String>,
    )],
) -> (String, Vec<Target>) {
    if rows.is_empty() {
        return (
            "\n## Watched pipelines\nThe user watches no pipelines.\n".to_string(),
            Vec::new(),
        );
    }
    let mut md = String::from("\n## Watched pipelines: latest run of each\n");
    let mut targets = Vec::new();
    let mut healthy = 0;
    for (pipeline, run) in rows {
        let name = format!("{} ({})", pipeline.definition_name, pipeline.project_name);
        match run {
            Ok(Some(run)) if needs_attention(run) => {
                let target = target(pipeline, run);
                let _ = writeln!(
                    md,
                    "- [{}] {name}: run {} {} on {}, finished {}. {}",
                    target.key,
                    run.build_number.as_deref().unwrap_or("?"),
                    run.result.as_deref().unwrap_or("?"),
                    run.source_branch.as_deref().unwrap_or("?"),
                    run.finish_time.as_deref().unwrap_or("?"),
                    run.web_url
                );
                targets.push(target);
            }
            Ok(_) => healthy += 1,
            Err(error) => {
                let _ = writeln!(md, "- {name}: could not be read ({error})");
            }
        }
    }
    if healthy > 0 {
        let _ = writeln!(
            md,
            "- {healthy} other watched pipelines: latest run succeeded, is running, or has none."
        );
    }
    (md, targets)
}

/// The section for a look: reads the watch list and the latest runs.
pub(crate) fn overview(db: &AppDatabase) -> (String, Vec<Target>) {
    let watch = db.open().map(|conn| load_watch(&conn)).unwrap_or_default();
    section(&latest_runs(db, &watch))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pipeline(name: &str) -> WatchedPipeline {
        WatchedPipeline {
            organization_id: "o".into(),
            project_id: "p".into(),
            project_name: "Proj".into(),
            definition_id: 1,
            definition_name: name.into(),
        }
    }

    fn run(result: Option<&str>) -> PipelineRunSummary {
        PipelineRunSummary {
            organization_id: "o".into(),
            project_id: "p".into(),
            project_name: "Proj".into(),
            build_id: 7,
            build_number: Some("20261121.3".into()),
            definition_id: Some(1),
            definition_name: Some("CI".into()),
            status: Some("completed".into()),
            result: result.map(str::to_string),
            source_branch: Some("refs/heads/main".into()),
            reason: None,
            requested_for: None,
            queue_time: None,
            start_time: None,
            finish_time: Some("2026-11-21T03:00:00Z".into()),
            web_url: "https://dev.azure.com/o/p/_build/results?buildId=7".into(),
        }
    }

    #[test]
    fn lists_failures_and_counts_the_rest() {
        let (md, targets) = section(&[
            (pipeline("CI"), Ok(Some(run(Some("failed"))))),
            (pipeline("Nightly"), Ok(Some(run(Some("succeeded"))))),
            (pipeline("Docs"), Ok(None)),
            (pipeline("Release"), Err("401".into())),
        ]);
        assert!(md.contains("- [pipe:o/p/1] CI (Proj): run 20261121.3 failed on refs/heads/main"));
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].label, "CI");
        assert_eq!(
            targets[0].web_url.as_deref(),
            Some("https://dev.azure.com/o/p/_build/results?buildId=7")
        );
        assert!(!md.contains("Nightly"));
        assert!(md.contains("Release (Proj): could not be read (401)"));
        assert!(md.contains("2 other watched pipelines"));
        assert!(section(&[]).0.contains("watches no pipelines"));
    }

    #[test]
    fn the_watch_list_round_trips_and_is_capped() {
        let dir = tempfile::tempdir().unwrap();
        let db = AppDatabase::new(dir.path().join("t.sqlite3"));
        db.initialize().unwrap();
        let conn = db.open().unwrap();
        assert!(load_watch(&conn).is_empty());
        let many: Vec<WatchedPipeline> = (0..40).map(|i| pipeline(&format!("p{i}"))).collect();
        save_watch(&conn, &many).unwrap();
        let saved = load_watch(&conn);
        assert_eq!(saved.len(), MAX_WATCHED);
        assert_eq!(saved[0], pipeline("p0"));
    }
}
