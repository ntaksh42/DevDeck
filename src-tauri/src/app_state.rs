use serde::Deserialize;
use tauri::State;
use tokio::sync::mpsc;

use crate::cancellation::CancellationRegistry;
use crate::code_browse::CodeBrowseService;
use crate::code_search::CodeSearchService;
use crate::commits::CommitService;
use crate::db::AppDatabase;
use crate::error::{AppError, Result};
use crate::orgs::OrganizationService;
use crate::pipelines::PipelineService;
use crate::pr_review::PrReviewService;
use crate::prs::PullRequestService;
use crate::settings::SettingsService;
use crate::snooze::SnoozeService;
use crate::sync::{SyncScope, SyncTrigger};
use crate::work_items::WorkItemService;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: AppDatabase,
    pub(crate) organizations: OrganizationService,
    pub(crate) pull_requests: PullRequestService,
    pub(crate) pr_review: PrReviewService,
    pub(crate) work_items: WorkItemService,
    pub(crate) commits: CommitService,
    pub(crate) pipelines: PipelineService,
    pub(crate) code_search: CodeSearchService,
    pub(crate) code_browse: CodeBrowseService,
    pub(crate) settings: SettingsService,
    pub(crate) snooze: SnoozeService,
    pub(crate) cancellation: CancellationRegistry,
    pub(crate) sync_trigger: mpsc::Sender<SyncTrigger>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TriggerSyncInput {
    pub(crate) scope: Option<SyncScope>,
}

// Keeps SQLite and file I/O off the main thread, where synchronous Tauri
// commands would otherwise block the UI event loop.
pub(crate) async fn run_blocking<T, F>(task: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Database(format!("background task failed: {error}")))?
}

pub(crate) async fn ensure_write_enabled(state: &State<'_, AppState>) -> Result<()> {
    let settings = state.settings.clone();
    let read_only =
        run_blocking(move || Ok(settings.get()?.read_only_validation_mode_enabled)).await?;
    if read_only {
        return Err(AppError::InvalidInput(
            "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps."
                .to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trigger_sync_input_rejects_unknown_scope() {
        assert!(serde_json::from_value::<TriggerSyncInput>(json!({
            "scope": "myReviews"
        }))
        .is_ok());
        assert!(serde_json::from_value::<TriggerSyncInput>(json!({
            "scope": "notARealScope"
        }))
        .is_err());
    }
}
