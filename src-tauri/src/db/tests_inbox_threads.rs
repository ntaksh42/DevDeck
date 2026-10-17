use rusqlite::params;
use tempfile::NamedTempFile;

use super::test_support::make_org_draft;
use super::*;

fn setup() -> (NamedTempFile, AppDatabase) {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    drop(conn);
    (tf, db)
}

fn comment(kind: &str, pr: i64, thread: i64, comment: i64) -> NewInboxItem {
    NewInboxItem {
        organization_id: "org1".to_string(),
        kind: kind.to_string(),
        subject_id: pr,
        project_id: "proj".to_string(),
        project_name: "Project".to_string(),
        repository_id: "repo".to_string(),
        repository_name: "api".to_string(),
        thread_id: thread,
        comment_id: comment,
        title: format!("PR {pr}"),
        author: Some(format!("author-{comment}")),
        snippet: Some(format!("comment {comment}")),
        web_url: None,
        file_path: None,
        line: None,
    }
}

fn open(db: &AppDatabase) -> Vec<InboxItem> {
    db.list_inbox_items(None, InboxListState::Open, 50).unwrap()
}

#[test]
fn comments_of_one_thread_share_a_row_showing_the_newest() {
    let (_tf, db) = setup();
    let changed = db
        .insert_inbox_items(&[
            comment("pr_reply", 1, 7, 102),
            comment("pr_reply", 1, 7, 101),
            comment("pr_reply", 1, 8, 103),
        ])
        .unwrap();
    assert_eq!(changed, 3);
    let items = open(&db);
    assert_eq!(items.len(), 2);
    let thread = items.iter().find(|i| i.thread_id == 7).unwrap();
    assert_eq!(thread.comment_id, 102);
    assert_eq!(thread.snippet.as_deref(), Some("comment 102"));
    assert_eq!(thread.hit_count, 2);

    // A rescan of comments already folded in changes nothing.
    assert_eq!(
        db.insert_inbox_items(&[comment("pr_reply", 1, 7, 101)])
            .unwrap(),
        0
    );
    assert_eq!(
        open(&db)
            .iter()
            .find(|i| i.thread_id == 7)
            .unwrap()
            .hit_count,
        2
    );
}

#[test]
fn a_new_comment_reopens_a_finished_thread_and_restarts_the_count() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[
        comment("pr_reply", 1, 7, 101),
        comment("pr_reply", 1, 7, 102),
    ])
    .unwrap();
    let id = open(&db)[0].id;
    db.set_inbox_item_state(&[id], "done", None).unwrap();

    db.insert_inbox_items(&[comment("pr_reply", 1, 7, 110)])
        .unwrap();
    let items = open(&db);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, id);
    assert_eq!(items[0].comment_id, 110);
    assert_eq!(items[0].hit_count, 1);
    assert_eq!(items[0].done_at, None);
}

#[test]
fn a_new_comment_wakes_a_snoozed_thread() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[comment("pr_reply", 1, 7, 101)])
        .unwrap();
    let id = open(&db)[0].id;
    let until = (chrono::Utc::now() + chrono::Duration::hours(5)).to_rfc3339();
    db.set_inbox_item_state(&[id], "snoozed", Some(&until))
        .unwrap();
    assert!(open(&db).is_empty());

    db.insert_inbox_items(&[comment("pr_reply", 1, 7, 102)])
        .unwrap();
    let items = open(&db);
    assert_eq!(ids_of(&items), vec![id]);
    assert_eq!(items[0].snoozed_until, None);
    assert_eq!(items[0].hit_count, 2);
}

fn ids_of(items: &[InboxItem]) -> Vec<i64> {
    items.iter().map(|i| i.id).collect()
}

#[test]
fn a_waiting_mention_stays_a_mention_when_a_reply_follows() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[
        comment("pr_mention", 1, 7, 101),
        comment("pr_reply", 1, 7, 102),
    ])
    .unwrap();
    assert_eq!(open(&db)[0].kind, "pr_mention");
}

#[test]
fn a_new_comment_drops_the_notes_written_for_the_earlier_one() {
    let (_tf, db) = setup();
    db.insert_inbox_items(&[comment("pr_reply", 1, 7, 101)])
        .unwrap();
    let id = open(&db)[0].id;
    let ready = InboxInsight {
        status: "ready".into(),
        verdict: Some("reply".into()),
        ..Default::default()
    };
    db.save_inbox_insight(id, &ready).unwrap();

    db.insert_inbox_items(&[comment("pr_reply", 1, 7, 102)])
        .unwrap();
    assert_eq!(open(&db)[0].insight, None);
    let needing = db
        .inbox_items_needing_insight("org1", &PR_INSIGHT_KINDS, 5)
        .unwrap();
    assert_eq!(ids_of(&needing), vec![id]);
}

#[test]
fn work_item_mentions_share_one_row_per_work_item() {
    let (_tf, db) = setup();
    let mut first = comment("wi_mention", 42, 0, 5);
    first.repository_id = String::new();
    let mut second = first.clone();
    second.comment_id = 9;
    db.insert_inbox_items(&[first, second]).unwrap();
    let items = open(&db);
    assert_eq!(items.len(), 1);
    assert_eq!((items[0].comment_id, items[0].hit_count), (9, 2));
}

fn insert_active_pr(db: &AppDatabase, table: &str, pr: i64) {
    let conn = db.open().unwrap();
    let sql = match table {
        "pull_requests" => {
            "INSERT INTO pull_requests(org_id, project_id, project_name, repository_id, \
             repository_name, pull_request_id, title, status, creation_date, source_ref_name, \
             target_ref_name) VALUES ('org1', 'proj', 'Project', 'repo', 'api', ?1, 't', \
             'active', '2026-01-01', 'refs/heads/a', 'refs/heads/main')"
        }
        _ => {
            "INSERT INTO review_pull_requests(org_id, project_id, project_name, repository_id, \
             repository_name, pull_request_id, title, creation_date, target_ref_name) \
             VALUES ('org1', 'proj', 'Project', 'repo', 'api', ?1, 't', '2026-01-01', \
             'refs/heads/main')"
        }
    };
    conn.execute(sql, params![pr]).unwrap();
}

#[test]
fn items_of_prs_missing_from_both_caches_are_finished() {
    let (_tf, db) = setup();
    insert_active_pr(&db, "pull_requests", 1);
    insert_active_pr(&db, "review_pull_requests", 2);
    let mut wi = comment("wi_mention", 3, 0, 300);
    wi.repository_id = String::new();
    db.insert_inbox_items(&[
        comment("pr_reply", 1, 7, 101),
        comment("pr_mention", 2, 7, 201),
        comment("pr_reply", 3, 7, 301),
        wi,
    ])
    .unwrap();

    assert_eq!(db.finish_inbox_items_of_closed_prs("org1").unwrap(), 1);
    let mut left: Vec<(String, i64)> = open(&db)
        .into_iter()
        .map(|i| (i.kind, i.subject_id))
        .collect();
    left.sort();
    assert_eq!(
        left,
        vec![
            ("pr_mention".to_string(), 2),
            ("pr_reply".to_string(), 1),
            ("wi_mention".to_string(), 3)
        ]
    );
}

#[test]
fn migrating_to_v27_folds_existing_rows_per_thread() {
    let (_tf, db) = setup();
    let conn = db.open().unwrap();
    conn.execute_batch("DROP INDEX idx_action_inbox_conversation;")
        .unwrap();
    let insert = |kind: &str, thread: i64, comment: i64, state: &str| {
        conn.execute(
            "INSERT INTO action_inbox_items(org_id, kind, subject_id, project_id, project_name, \
             repository_id, repository_name, thread_id, comment_id, title, state, detected_at, \
             done_at) VALUES ('org1', ?1, 1, 'proj', 'Project', 'repo', 'api', ?2, ?3, 't', ?4, \
             '2026-01-01T00:00:00Z', CASE WHEN ?4 = 'done' THEN '2026-01-02T00:00:00Z' END)",
            params![kind, thread, comment, state],
        )
        .unwrap();
    };
    insert("pr_mention", 7, 101, "open");
    insert("pr_reply", 7, 102, "done");
    insert("pr_reply", 7, 103, "open");
    insert("pr_reply", 8, 201, "done");
    insert("pr_reply", 8, 202, "done");
    conn.execute_batch("PRAGMA user_version = 26;").unwrap();
    migrate(&conn).unwrap();

    let rows: Vec<(i64, i64, String, String, i64)> = conn
        .prepare(
            "SELECT thread_id, comment_id, kind, state, hit_count FROM action_inbox_items \
             ORDER BY thread_id",
        )
        .unwrap()
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (7, 103, "pr_mention".to_string(), "open".to_string(), 2),
            (8, 202, "pr_reply".to_string(), "done".to_string(), 1),
        ]
    );
}
