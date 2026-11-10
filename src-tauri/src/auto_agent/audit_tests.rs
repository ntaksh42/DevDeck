use chrono::{Duration, Utc};

use super::{queue, state::History, AutoItem};
use crate::db::{AppDatabase, CachedWorkItem, OrganizationDraft};

#[test]
fn an_approved_work_item_failure_returns_to_the_queue_after_backoff() {
    let dir = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(dir.path().join("db.sqlite3"));
    db.initialize().unwrap();
    let org = db
        .upsert_organization(OrganizationDraft {
            id: "audit-org".into(),
            name: "audit-org".into(),
            display_name: None,
            base_url: "https://dev.azure.com/audit-org".into(),
            auth_provider: "pat".into(),
            credential_key: "unused".into(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
    let mut settings = db.get_app_settings().unwrap();
    settings.auto_agent_enabled = true;
    settings.auto_agent_approval_enabled = true;
    settings.work_item_result_folder_path = Some(dir.path().display().to_string());
    let wi = CachedWorkItem {
        org_id: org.id.clone(),
        project_id: "project".into(),
        project_name: "Project".into(),
        id: 42,
        title: "Retry the approved investigation".into(),
        work_item_type: None,
        state: Some("Active".into()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: Some(Utc::now().to_rfc3339()),
        web_url: None,
        tags: None,
    };
    db.replace_work_items(
        &org.id,
        &["project"],
        std::slice::from_ref(&wi),
        std::slice::from_ref(&wi),
    )
    .unwrap();
    assert_eq!(queue::candidates(&db, &settings, &org).unwrap().len(), 1);

    let item = AutoItem::WorkItem(wi);
    let mut history = History::default();
    history.begin(None, None, Utc::now() - Duration::hours(2));
    history.finish(
        false,
        Some("Temporary material collection failure".into()),
        None,
    );
    history.runs.last_mut().unwrap().finished_at = Some(Utc::now() - Duration::hours(2));
    assert!(history.due(Utc::now()));
    history.save(&item.history_path(&db, &org)).unwrap();

    let retry_candidates = queue::candidates(&db, &settings, &org).unwrap();
    assert_eq!(
        retry_candidates.len(),
        1,
        "An expired failure must remain selectable while approval disables automatic retries"
    );
}
