//! Cherry-pick/revert cover the same read-only gate as every other mutating
//! command (`app_state::ensure_write_enabled`), but re-checked at the service
//! layer so it is testable without a `tauri::State`. These tests only exercise
//! that gate and basic input validation, both of which short-circuit before
//! any network/keyring access; REST behavior for the underlying Azure DevOps
//! calls is covered by wiremock tests in `crates/azdo-client`.

use tempfile::NamedTempFile;

use crate::db::{AppDatabase, OrganizationDraft};
use crate::error::AppError;
use crate::secrets::SecretStore;

use super::{CherryPickCommitInput, CommitService, RevertCommitInput};

// Returns the `NamedTempFile` alongside the service: `AppDatabase` only holds
// a path and reopens a connection per call, so the backing file must outlive
// the service or the next open silently recreates an empty, unmigrated db.
fn test_service(read_only: bool) -> (NamedTempFile, CommitService) {
    let db_file = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    db.upsert_organization(OrganizationDraft {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: None,
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        provider_kind: "azdo".to_string(),
    })
    .unwrap();
    if read_only {
        let mut settings = db.get_app_settings().unwrap();
        settings.read_only_validation_mode_enabled = true;
        db.update_app_settings(settings).unwrap();
    }
    (db_file, CommitService::new(db, SecretStore))
}

fn cherry_pick_input() -> CherryPickCommitInput {
    CherryPickCommitInput {
        organization_id: Some("contoso".to_string()),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "azdo-dashboard".to_string(),
        commit_id: "abc123".to_string(),
        onto_branch: "main".to_string(),
        new_branch_name: "cherry-pick/abc123".to_string(),
    }
}

fn revert_input() -> RevertCommitInput {
    RevertCommitInput {
        organization_id: Some("contoso".to_string()),
        project_id: "project-1".to_string(),
        project_name: "Platform".to_string(),
        repository_id: "repo-1".to_string(),
        repository_name: "azdo-dashboard".to_string(),
        commit_id: "abc123".to_string(),
        onto_branch: "main".to_string(),
        new_branch_name: "revert/abc123".to_string(),
    }
}

#[tokio::test]
async fn cherry_pick_commit_rejects_when_read_only_mode_enabled() {
    let (_db_file, service) = test_service(true);

    let error = service
        .cherry_pick_commit(cherry_pick_input())
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
async fn revert_commit_rejects_when_read_only_mode_enabled() {
    let (_db_file, service) = test_service(true);

    let error = service.revert_commit(revert_input()).await.unwrap_err();

    match error {
        AppError::InvalidInput(message) => {
            assert!(message.contains("Read-only validation mode is enabled"));
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

#[tokio::test]
async fn cherry_pick_commit_rejects_blank_new_branch_name() {
    let (_db_file, service) = test_service(false);
    let mut input = cherry_pick_input();
    input.new_branch_name = "   ".to_string();

    let error = service.cherry_pick_commit(input).await.unwrap_err();

    match error {
        AppError::InvalidInput(message) => {
            assert_eq!(message, "new branch name is required");
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

#[tokio::test]
async fn revert_commit_rejects_blank_new_branch_name() {
    let (_db_file, service) = test_service(false);
    let mut input = revert_input();
    input.new_branch_name = "".to_string();

    let error = service.revert_commit(input).await.unwrap_err();

    match error {
        AppError::InvalidInput(message) => {
            assert_eq!(message, "new branch name is required");
        }
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}
