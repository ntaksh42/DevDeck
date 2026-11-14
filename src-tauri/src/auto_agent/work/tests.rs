use chrono::{Duration, Utc};

use super::excluded::ExcludedItem;
use super::*;

fn database() -> (tempfile::TempDir, AppDatabase) {
    let dir = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(dir.path().join("db.sqlite3"));
    db.initialize().unwrap();
    (dir, db)
}

fn save_label(path: &Path, title: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let label = ItemLabel {
        title: title.into(),
        scope: "repo".into(),
        project_id: Some("p".into()),
        web_url: None,
    };
    fs::write(meta_path(path), serde_json::to_vec(&label).unwrap()).unwrap();
}

#[test]
fn history_names_skip_labels_logs_and_temp_files() {
    assert_eq!(
        parse_history_name("pr-12.json"),
        Some((NoteTarget::PullRequest, 12))
    );
    assert_eq!(
        parse_history_name("wi-3.json"),
        Some((NoteTarget::WorkItem, 3))
    );
    assert_eq!(parse_history_name("pr-12.meta.json"), None);
    assert_eq!(parse_history_name("pr-12-1.log"), None);
    assert_eq!(parse_history_name("pr-12.tmp"), None);
    assert_eq!(decode_hex("6f7267"), Some("org".into()));
    assert_eq!(decode_hex("6f7"), None);
}

#[test]
fn lists_each_history_with_its_latest_status_and_label() {
    let (_dir, db) = database();
    let ok = state::history_path(&db, "org", "repo-id", NoteTarget::PullRequest, 7);
    let mut history = History::default();
    history.begin(None, Some("a".into()), Utc::now());
    history.finish(true, None, Some(0));
    history.save(&ok).unwrap();
    save_label(&ok, "Cache tenant lookups");

    let failed = state::history_path(&db, "org", "project-id", NoteTarget::WorkItem, 9);
    let mut history = History::default();
    history.begin(None, None, Utc::now());
    history.finish(false, Some("exit 1".into()), Some(1));
    history.save(&failed).unwrap();

    let entries = list(&db).unwrap();
    let pr = entries.iter().find(|e| e.id == 7).unwrap();
    assert_eq!(
        (pr.status, pr.target, pr.title.as_str()),
        ("succeeded", "pull-request", "Cache tenant lookups")
    );
    assert_eq!(pr.scope_id, "repo-id");
    let wi = entries.iter().find(|e| e.id == 9).unwrap();
    assert_eq!(
        (wi.status, wi.failures, wi.error.as_deref()),
        ("failed", 1, Some("exit 1"))
    );
    assert!(wi.next_retry_at.is_some());
}

#[test]
fn an_expired_running_attempt_counts_as_failed() {
    let mut history = History::default();
    let now = Utc::now();
    history.begin(None, None, now);
    assert_eq!(status_of(&history, None, now), "running");
    assert_eq!(
        status_of(&history, None, now + Duration::minutes(31)),
        "failed"
    );
}

#[test]
fn excluding_is_remembered_and_listed_until_included_again() {
    let (_dir, db) = database();
    let item = ExcludedItem {
        organization_id: "org".into(),
        target: NoteTarget::PullRequest,
        id: 4,
        title: "WIP ranking".into(),
        scope: "search".into(),
        scope_id: "repo-id".into(),
        excluded_at: None,
    };
    set_excluded(
        &db,
        SetExcludedInput {
            item: item.clone(),
            excluded: true,
        },
    )
    .unwrap();
    assert!(excluded_keys(&db).contains(&key("org", NoteTarget::PullRequest, 4)));
    let entries = list(&db).unwrap();
    let listed = entries.iter().find(|e| e.id == 4).unwrap();
    assert!(listed.excluded);
    assert_eq!(
        (listed.status, listed.title.as_str()),
        ("none", "WIP ranking")
    );

    set_excluded(
        &db,
        SetExcludedInput {
            item,
            excluded: false,
        },
    )
    .unwrap();
    assert!(excluded_keys(&db).is_empty());
    assert!(list(&db).unwrap().iter().all(|e| e.id != 4));
}

#[test]
fn a_retry_request_skips_the_backoff_once() {
    let mut history = History::default();
    let now = Utc::now();
    history.begin(None, None, now);
    history.finish(false, Some("offline".into()), None);
    assert!(!history.due(Utc::now()));
    history.retry_requested = true;
    assert!(history.due(Utc::now()));
    history.begin(None, None, Utc::now());
    assert!(!history.retry_requested);
}

#[test]
fn only_a_failed_item_can_be_retried() {
    let (_dir, db) = database();
    let path = state::history_path(&db, "org", "repo-id", NoteTarget::PullRequest, 5);
    let mut history = History::default();
    history.begin(None, Some("a".into()), Utc::now());
    history.finish(true, None, Some(0));
    history.save(&path).unwrap();
    let target = AgentWorkTarget {
        organization_id: "org".into(),
        target: NoteTarget::PullRequest,
        id: 5,
        scope_id: "repo-id".into(),
    };
    assert!(retry(&db, target).is_err());
}

#[test]
fn the_log_tail_is_read_from_the_latest_attempt() {
    let (_dir, db) = database();
    let path = state::history_path(&db, "org", "repo-id", NoteTarget::PullRequest, 6);
    let log = path.with_file_name("pr-6-1.log");
    let mut history = History::default();
    history.begin(None, None, Utc::now());
    history.runs[0].log_path = Some(log.clone());
    history.save(&path).unwrap();
    fs::write(&log, "stderr: context window exceeded").unwrap();
    let target = AgentWorkTarget {
        organization_id: "org".into(),
        target: NoteTarget::PullRequest,
        id: 6,
        scope_id: "repo-id".into(),
    };
    assert_eq!(
        read_log(&db, target).unwrap(),
        "stderr: context window exceeded"
    );
}
