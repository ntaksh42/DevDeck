use std::sync::Arc;

use serde::Deserialize;
use tauri::State;
use tokio::sync::{mpsc, RwLock};

use crate::cancellation::CancellationRegistry;
use crate::code_browse::CodeBrowseService;
use crate::code_search::CodeSearchService;
use crate::commits::CommitService;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::orgs::OrganizationService;
use crate::pipelines::PipelineService;
use crate::pr_review::PrReviewService;
use crate::providers::{AzdoProvider, GithubProvider, Provider};
use crate::prs::PullRequestService;
use crate::secrets::SecretStore;
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
    /// The API-layer provider for the active connection. Built lazily from the
    /// active organization and swapped when the active connection changes, so
    /// the command layer talks to one platform at a time without knowing which.
    pub(crate) active_provider: Arc<RwLock<Option<Arc<dyn Provider>>>>,
}

impl AppState {
    /// Returns the provider for the active connection, building and caching it on
    /// first use.
    pub(crate) async fn provider(&self) -> Result<Arc<dyn Provider>> {
        if let Some(provider) = self.active_provider.read().await.clone() {
            return Ok(provider);
        }
        let provider = self.build_active_provider()?;
        *self.active_provider.write().await = Some(provider.clone());
        Ok(provider)
    }

    /// Rebuilds the cached provider from the current active organization. Call
    /// after the active connection changes or a connection is added/removed.
    pub(crate) async fn refresh_provider(&self) -> Result<()> {
        let provider = self.build_active_provider()?;
        *self.active_provider.write().await = Some(provider);
        Ok(())
    }

    /// Drops the cached provider so the next `provider()` rebuilds it. Used when
    /// the active connection may have gone away (e.g. it was deleted).
    pub(crate) async fn clear_provider(&self) {
        *self.active_provider.write().await = None;
    }

    fn build_active_provider(&self) -> Result<Arc<dyn Provider>> {
        let org = self.db.resolve_organization(None)?;
        Ok(self.provider_for(org))
    }

    fn provider_for(&self, org: Organization) -> Arc<dyn Provider> {
        match org.provider_kind.as_str() {
            "github" => Arc::new(GithubProvider::new(org, SecretStore)),
            _ => Arc::new(AzdoProvider::new(
                self.pull_requests.clone(),
                self.pr_review.clone(),
                self.work_items.clone(),
                self.commits.clone(),
                self.code_search.clone(),
                self.code_browse.clone(),
                self.pipelines.clone(),
                self.db.clone(),
            )),
        }
    }
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
    ensure_settings_write_enabled(&state.settings).await
}

/// The read-only check behind [`ensure_write_enabled`], factored out so it can
/// be exercised directly in tests without a `tauri::State`.
async fn ensure_settings_write_enabled(settings: &SettingsService) -> Result<()> {
    let settings = settings.clone();
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

    // Returns the backing `NamedTempFile` alongside the service: it must stay
    // alive for the database file to exist (dropping it deletes the file).
    fn test_settings_service() -> (tempfile::NamedTempFile, SettingsService) {
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let db = AppDatabase::new(db_file.path().to_path_buf());
        db.initialize().unwrap();
        (db_file, SettingsService::new(db))
    }

    // Exercises the same gate `create_branch`/`delete_branch` (and every other
    // write command) run through via `ensure_write_enabled`.
    #[tokio::test]
    async fn ensure_settings_write_enabled_rejects_when_read_only_mode_is_on() {
        let (_db_file, settings_service) = test_settings_service();
        let mut settings = settings_service.get().unwrap();
        settings.read_only_validation_mode_enabled = true;
        settings_service.update_normalized(settings).unwrap();

        let error = ensure_settings_write_enabled(&settings_service)
            .await
            .unwrap_err();
        match error {
            AppError::InvalidInput(message) => {
                assert!(message.contains("Read-only validation mode is enabled"));
            }
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ensure_settings_write_enabled_allows_writes_by_default() {
        let (_db_file, settings_service) = test_settings_service();
        assert!(ensure_settings_write_enabled(&settings_service)
            .await
            .is_ok());
    }
}
