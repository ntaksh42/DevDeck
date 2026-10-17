use super::merge_readiness::collect_ready_prs;
use super::*;
use crate::db::{CachedPr, NotificationRule, OrganizationDraft};
use azdo_client::{AdoClient, PatProvider};
use serde_json::json;
use std::collections::HashSet;
use wiremock::{matchers::path, Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn ready_sync_obeys_routing_and_snooze_without_hiding_badge() {
    let server = MockServer::start().await;
    Mock::given(path("/p/_apis/git/repositories/r/pullrequests/42"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pullRequestId": 42, "title": "Ready", "status": "active",
            "creationDate": "2026-01-01T00:00:00Z", "sourceRefName": "refs/heads/topic",
            "targetRefName": "refs/heads/main", "isDraft": false,
            "mergeStatus": "succeeded", "reviewers": []
        })))
        .mount(&server)
        .await;
    Mock::given(path("/p/_apis/policy/evaluations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value": []})))
        .mount(&server)
        .await;
    let client = AdoClient::new("org", Arc::new(PatProvider::new("test")))
        .unwrap()
        .with_base_url(url::Url::parse(&format!("{}/", server.uri())).unwrap());
    let file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            id: "org".into(),
            name: "Org".into(),
            display_name: None,
            base_url: "https://dev.azure.com/org".into(),
            auth_provider: "pat".into(),
            credential_key: "test".into(),
            authenticated_user_id: Some("me".into()),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
    db.replace_pull_requests_for_projects(
        "org",
        &["p"],
        &[CachedPr {
            org_id: "org".into(),
            project_id: "p".into(),
            project_name: "Project".into(),
            repository_id: "r".into(),
            repository_name: "Repo".into(),
            pull_request_id: 42,
            title: "Ready".into(),
            status: "active".into(),
            created_by: None,
            created_by_id: Some("me".into()),
            creation_date: "2026-01-01".into(),
            source_ref_name: "topic".into(),
            target_ref_name: "main".into(),
            web_url: None,
            is_draft: false,
        }],
    )
    .unwrap();
    let budget = Arc::new(Semaphore::new(2));
    let none = HashSet::new();
    let rule = NotificationRule {
        types: vec!["readyToMerge".into()],
        projects: vec!["project".into()],
        repositories: vec!["repo".into()],
        mute: true,
    };
    let mut settings = crate::db::AppSettings {
        notification_rules: vec![rule],
        ..Default::default()
    };
    assert!(
        collect_ready_prs(&db, &client, &org, &settings, &budget, &none)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(db.pr_ready_to_merge("org", "r", 42).unwrap());
    settings.notification_rules.clear();
    let snoozed = HashSet::from(["r:42".into()]);
    assert!(
        collect_ready_prs(&db, &client, &org, &settings, &budget, &snoozed)
            .await
            .unwrap()
            .is_empty()
    );
    let items = collect_ready_prs(&db, &client, &org, &settings, &budget, &none)
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].kind, PrNotificationKind::ReadyToMerge);
    assert!(
        collect_ready_prs(&db, &client, &org, &settings, &budget, &none)
            .await
            .unwrap()
            .is_empty()
    );
    let history = db.list_notifications(10, None, false, None, None).unwrap();
    assert_eq!(history.items.len(), 1);
    assert_eq!(history.items[0].kind, "prReadyToMerge");
}
