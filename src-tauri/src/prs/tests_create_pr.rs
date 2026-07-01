// Tests for create_pull_request (issue #387), split out from tests.rs to keep
// that file under the 500-line cap.
use tempfile::NamedTempFile;

use super::*;
use crate::db::AppDatabase;
use crate::secrets::SecretStore;

fn service() -> PullRequestService {
    let db_file = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    PullRequestService::new(db, SecretStore)
}

fn valid_input() -> CreatePullRequestInput {
    CreatePullRequestInput {
        organization_id: None,
        project_id: "project-1".to_string(),
        repository_id: "repo-1".to_string(),
        source_branch: "feature/x".to_string(),
        target_branch: "main".to_string(),
        title: "New PR".to_string(),
        description: None,
    }
}

#[tokio::test]
async fn create_pull_request_rejects_empty_title() {
    let input = CreatePullRequestInput {
        title: "   ".to_string(),
        ..valid_input()
    };
    let error = service().create_pull_request(input).await.unwrap_err();
    assert!(error.to_string().contains("title"));
}

#[tokio::test]
async fn create_pull_request_rejects_missing_branches() {
    let input = CreatePullRequestInput {
        source_branch: "  ".to_string(),
        ..valid_input()
    };
    let error = service().create_pull_request(input).await.unwrap_err();
    assert!(error.to_string().contains("branch"));
}

#[tokio::test]
async fn create_pull_request_rejects_same_source_and_target() {
    let input = CreatePullRequestInput {
        source_branch: "main".to_string(),
        target_branch: "refs/heads/main".to_string(),
        ..valid_input()
    };
    let error = service().create_pull_request(input).await.unwrap_err();
    assert!(error.to_string().contains("differ"));
}

#[test]
fn full_ref_expands_short_branch_names() {
    assert_eq!(full_ref("main"), "refs/heads/main");
    assert_eq!(full_ref("refs/heads/main"), "refs/heads/main");
    assert_eq!(full_ref("  feature/x  "), "refs/heads/feature/x");
    assert_eq!(full_ref(""), "");
}
