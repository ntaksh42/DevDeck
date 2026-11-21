use azdo_client::{GitFilePosition, GitThread, GitThreadComment, GitThreadContext, IdentityRef};
use tempfile::NamedTempFile;

use super::*;
use crate::db::{
    AppDatabase, CachedReviewPr, InboxListState, OpenInboxRef, Organization, OrganizationDraft,
};

const ME: &str = "me-guid";

fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
    GitThreadComment {
        id,
        parent_comment_id: None,
        content: Some(content.into()),
        comment_type: Some("text".into()),
        author: Some(IdentityRef {
            id: Some(author_id.into()),
            display_name: Some(format!("{author_id}-name")),
            unique_name: None,
        }),
        published_date: None,
        is_deleted: false,
    }
}

fn thread(id: i64, status: &str, comments: Vec<GitThreadComment>) -> GitThread {
    GitThread {
        id,
        status: Some(status.into()),
        is_deleted: false,
        comments: Some(comments),
        thread_context: None,
    }
}

fn review_pr(pull_request_id: i64) -> CachedReviewPr {
    CachedReviewPr {
        org_id: "org1".into(),
        project_id: "proj".into(),
        project_name: "Project".into(),
        repository_id: "repo".into(),
        repository_name: "api".into(),
        pull_request_id,
        title: format!("PR {pull_request_id}"),
        created_by: Some("Tanaka".into()),
        creation_date: "2026-10-01T00:00:00Z".into(),
        target_ref_name: "refs/heads/main".into(),
        web_url: Some(format!(
            "https://dev.azure.com/org1/Project/_git/api/pullrequest/{pull_request_id}"
        )),
        my_vote: 0,
        my_vote_label: "No vote".into(),
        my_is_required: false,
        is_draft: false,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn setup() -> (NamedTempFile, AppDatabase, Organization) {
    let tf = NamedTempFile::new().unwrap();
    let db = AppDatabase::new(tf.path().to_path_buf());
    db.initialize().unwrap();
    let mut org = db
        .upsert_organization(OrganizationDraft {
            id: "org1".into(),
            name: "org1".into(),
            display_name: None,
            base_url: "https://dev.azure.com/org1".into(),
            auth_provider: "pat".into(),
            credential_key: "azdodeck:org:org1:pat".into(),
            authenticated_user_id: Some(ME.into()),
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
    org.authenticated_user_id = Some(ME.into());
    (tf, db, org)
}

fn scan(pr: i64, threads: Vec<GitThread>) -> Vec<ScannedPr> {
    vec![ScannedPr {
        pr: review_pr(pr).into(),
        authored: false,
        threads,
    }]
}

#[test]
fn mention_tokens_become_readable() {
    assert_eq!(
        clean_mentions("hi @<ME-GUID> and @<other> ok", "me-guid"),
        "hi @you and @mention ok"
    );
    assert_eq!(clean_mentions("no tokens", "me"), "no tokens");
    // An unterminated token is left as written.
    assert_eq!(clean_mentions("broken @<abc", "me"), "broken @<abc");
}

#[test]
fn first_scan_keeps_only_mentions_still_waiting() {
    let (_tf, db, org) = setup();
    let threads = vec![
        // Waiting: active and not answered.
        thread(
            1,
            "active",
            vec![comment(10, "other", &format!("@<{ME}> please look"))],
        ),
        // Answered by the user afterwards.
        thread(
            2,
            "active",
            vec![
                comment(11, "other", &format!("@<{ME}> and this")),
                comment(12, ME, "done"),
            ],
        ),
        // Resolved.
        thread(
            3,
            "fixed",
            vec![comment(13, "other", &format!("@<{ME}> old"))],
        ),
        // A plain reply is history, not a request.
        thread(4, "active", vec![comment(14, "other", "plain")]),
    ];
    let update = update_action_inbox(&db, &org, &scan(5, threads), &Default::default());
    assert_eq!(update.added, 1);
    assert_eq!(
        db.get_inbox_comment_cursor("org1", "repo", 5).unwrap(),
        Some(14)
    );
    let items = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        (items[0].thread_id, items[0].kind.as_str()),
        (1, "pr_mention")
    );
}

#[test]
fn a_new_mention_and_a_new_reply_are_stored_with_their_kind() {
    let (_tf, db, org) = setup();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    let threads = vec![
        thread(
            1,
            "active",
            vec![comment(
                20,
                "tanaka",
                &format!("@<{ME}>  ここの null\n扱いを確認してください"),
            )],
        ),
        thread(
            2,
            "active",
            vec![
                comment(11, ME, "question"),
                comment(21, "suzuki", "done, thanks"),
            ],
        ),
    ];
    let update = update_action_inbox(&db, &org, &scan(5, threads), &Default::default());
    assert_eq!(update.added, 2);

    let mut items = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    items.sort_by_key(|i| i.comment_id);
    assert_eq!(items[0].kind, "pr_mention");
    assert_eq!(items[0].thread_id, 1);
    assert_eq!(
        items[0].snippet.as_deref(),
        Some("@you ここの null 扱いを確認してください")
    );
    assert_eq!(items[0].author.as_deref(), Some("tanaka-name"));
    assert_eq!(items[0].subject_id, 5);
    assert_eq!(items[1].kind, "pr_reply");
    assert_eq!(items[1].thread_id, 2);
}

#[test]
fn rescanning_does_not_duplicate_items() {
    let (_tf, db, org) = setup();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    let threads = || {
        vec![thread(
            1,
            "active",
            vec![comment(20, "tanaka", &format!("@<{ME}> hi"))],
        )]
    };
    assert_eq!(
        update_action_inbox(&db, &org, &scan(5, threads()), &Default::default()).added,
        1
    );
    assert_eq!(
        update_action_inbox(&db, &org, &scan(5, threads()), &Default::default()).added,
        0
    );
    assert_eq!(
        db.list_inbox_items(None, InboxListState::Open, 50)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn inbox_does_not_depend_on_the_notification_cursor() {
    let (_tf, db, org) = setup();
    // The notification pass already consumed this comment.
    db.set_pr_comment_seen("org1", "repo", 5, 99).unwrap();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    let threads = vec![thread(
        1,
        "active",
        vec![comment(20, "tanaka", &format!("@<{ME}> hi"))],
    )];
    assert_eq!(
        update_action_inbox(&db, &org, &scan(5, threads), &Default::default()).added,
        1
    );
}

#[test]
fn a_resolved_thread_closes_its_items() {
    let (_tf, db, org) = setup();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    let active = vec![thread(
        1,
        "active",
        vec![comment(20, "tanaka", &format!("@<{ME}> hi"))],
    )];
    update_action_inbox(&db, &org, &scan(5, active), &Default::default());

    let resolved = vec![thread(
        1,
        "closed",
        vec![comment(20, "tanaka", &format!("@<{ME}> hi"))],
    )];
    let update = update_action_inbox(&db, &org, &scan(5, resolved), &Default::default());
    assert_eq!(update.resolved, 1);
    assert!(db
        .list_inbox_items(None, InboxListState::Open, 50)
        .unwrap()
        .is_empty());
    assert_eq!(
        db.list_inbox_items(None, InboxListState::Done, 50)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn replying_in_the_thread_closes_the_item() {
    let open = [OpenInboxRef {
        id: 1,
        thread_id: 1,
        comment_id: 20,
    }];
    let before = vec![thread(1, "active", vec![comment(20, "tanaka", "ping")])];
    assert!(resolved_inbox_ids(&before, Some(ME), &open).is_empty());

    let answered = vec![thread(
        1,
        "active",
        vec![comment(20, "tanaka", "ping"), comment(21, ME, "on it")],
    )];
    assert_eq!(resolved_inbox_ids(&answered, Some(ME), &open), vec![1]);

    // Someone else answering does not count.
    let other = vec![thread(
        1,
        "active",
        vec![
            comment(20, "tanaka", "ping"),
            comment(21, "suzuki", "me too"),
        ],
    )];
    assert!(resolved_inbox_ids(&other, Some(ME), &open).is_empty());
}

#[test]
fn deleted_threads_and_comments_close_the_item() {
    let open = [OpenInboxRef {
        id: 7,
        thread_id: 1,
        comment_id: 20,
    }];
    // The thread is no longer returned.
    assert_eq!(resolved_inbox_ids(&[], Some(ME), &open), vec![7]);

    let mut deleted_comment = comment(20, "tanaka", "ping");
    deleted_comment.is_deleted = true;
    let threads = vec![thread(1, "active", vec![deleted_comment])];
    assert_eq!(resolved_inbox_ids(&threads, Some(ME), &open), vec![7]);

    let mut gone = thread(1, "active", vec![comment(20, "tanaka", "ping")]);
    gone.is_deleted = true;
    assert_eq!(resolved_inbox_ids(&[gone], Some(ME), &open), vec![7]);
}

#[test]
fn any_new_comment_on_my_own_pr_is_reported_but_not_on_a_review_pr() {
    let (_tf, db, org) = setup();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    db.set_inbox_comment_cursor("org1", "repo", 6, 10).unwrap();
    // Someone else opens a new thread; the user is not in it and is not
    // mentioned, so only the user's own PR counts it.
    let threads = || {
        vec![thread(
            1,
            "active",
            vec![comment(20, "tanaka", "this looks wrong")],
        )]
    };
    let reviewing = scan(5, threads());
    assert_eq!(
        update_action_inbox(&db, &org, &reviewing, &Default::default()),
        InboxUpdate::default()
    );

    let mut own = scan(6, threads());
    own[0].authored = true;
    let update = update_action_inbox(&db, &org, &own, &Default::default());
    assert_eq!(update.added, 1);
    let item = db
        .list_inbox_items(None, InboxListState::Open, 10)
        .unwrap()
        .remove(0);
    assert_eq!(item.subject_id, 6);
    assert_eq!(item.kind, "pr_reply");
}

#[test]
fn without_a_known_user_nothing_is_detected() {
    let (_tf, db, mut org) = setup();
    org.authenticated_user_id = None;
    let threads = vec![thread(
        1,
        "active",
        vec![comment(20, "tanaka", &format!("@<{ME}> hi"))],
    )];
    assert_eq!(
        update_action_inbox(&db, &org, &scan(5, threads), &Default::default()),
        InboxUpdate::default()
    );
}

fn on_line(mut thread: GitThread, path: &str, right: Option<i64>, left: Option<i64>) -> GitThread {
    thread.thread_context = Some(GitThreadContext {
        file_path: Some(path.into()),
        right_file_start: right.map(|line| GitFilePosition { line }),
        left_file_start: left.map(|line| GitFilePosition { line }),
    });
    thread
}

#[test]
fn thread_location_prefers_the_new_side_and_skips_pr_wide_threads() {
    let base = || thread(1, "active", vec![]);
    assert_eq!(
        thread_location(&on_line(base(), "/src/a.rs", Some(42), Some(40))),
        Some(("/src/a.rs".to_string(), Some(42)))
    );
    assert_eq!(
        thread_location(&on_line(base(), "/src/a.rs", None, Some(7))),
        Some(("/src/a.rs".to_string(), Some(7)))
    );
    assert_eq!(thread_location(&base()), None);
    assert_eq!(thread_location(&on_line(base(), "", Some(1), None)), None);
}

#[test]
fn a_new_item_keeps_its_thread_location_and_older_open_items_are_backfilled() {
    let (_tf, db, org) = setup();
    db.set_inbox_comment_cursor("org1", "repo", 5, 10).unwrap();
    // An item stored before v25 recorded locations.
    db.insert_inbox_items(&[crate::db::NewInboxItem {
        organization_id: "org1".into(),
        kind: KIND_PR_MENTION.into(),
        subject_id: 5,
        project_id: "proj".into(),
        project_name: "Project".into(),
        repository_id: "repo".into(),
        repository_name: "api".into(),
        thread_id: 2,
        comment_id: 9,
        title: "PR 5".into(),
        author: None,
        snippet: None,
        web_url: None,
        file_path: None,
        line: None,
    }])
    .unwrap();
    let threads = vec![
        on_line(
            thread(
                1,
                "active",
                vec![comment(20, "tanaka", &format!("@<{ME}> null?"))],
            ),
            "/src/Retry.cs",
            Some(42),
            None,
        ),
        on_line(
            thread(
                2,
                "active",
                vec![comment(9, "sato", &format!("@<{ME}> old"))],
            ),
            "/src/Old.cs",
            Some(3),
            None,
        ),
    ];
    update_action_inbox(&db, &org, &scan(5, threads), &Default::default());
    let items = db.list_inbox_items(None, InboxListState::Open, 50).unwrap();
    let new_item = items.iter().find(|item| item.comment_id == 20).unwrap();
    assert_eq!(new_item.file_path.as_deref(), Some("/src/Retry.cs"));
    assert_eq!(new_item.line, Some(42));
    let old_item = items.iter().find(|item| item.comment_id == 9).unwrap();
    assert_eq!(old_item.file_path.as_deref(), Some("/src/Old.cs"));
    assert_eq!(old_item.line, Some(3));
}
