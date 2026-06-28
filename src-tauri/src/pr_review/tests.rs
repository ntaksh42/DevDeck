use azdo_client::GitThread;

use super::helpers::{
    map_threads, root_comment_id, thread_resolved, validate_merge_strategy, validate_thread_status,
    validate_vote, ChangeFlags,
};

#[test]
fn map_threads_skips_deleted_and_flags_system_comments() {
    let threads: Vec<GitThread> = serde_json::from_value(serde_json::json!([
        { "id": 1, "isDeleted": true, "comments": [{ "id": 1, "content": "gone" }] },
        {
            "id": 2,
            "status": "active",
            "threadContext": {
                "filePath": "/src/app.ts",
                "rightFileStart": { "line": 12, "offset": 1 }
            },
            "comments": [
                { "id": 1, "content": "real", "commentType": "text", "author": { "id": "me-1" } },
                { "id": 2, "content": "voted", "commentType": "system" },
                { "id": 3, "content": "deleted", "commentType": "text", "isDeleted": true }
            ]
        }
    ]))
    .unwrap();

    let mapped = map_threads(threads, Some("me-1"));
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped[0].file_path.as_deref(), Some("/src/app.ts"));
    assert_eq!(mapped[0].right_line, Some(12));
    assert_eq!(mapped[0].left_line, None);
    assert_eq!(mapped[0].comments.len(), 2);
    assert!(!mapped[0].comments[0].is_system);
    assert!(mapped[0].comments[0].is_mine);
    assert!(mapped[0].comments[1].is_system);
}

#[test]
fn map_threads_reads_left_side_anchor() {
    let threads: Vec<GitThread> = serde_json::from_value(serde_json::json!([
        {
            "id": 3,
            "status": "active",
            "threadContext": {
                "filePath": "/src/app.ts",
                "leftFileStart": { "line": 8, "offset": 1 }
            },
            "comments": [{ "id": 1, "content": "on the old line" }]
        }
    ]))
    .unwrap();

    let mapped = map_threads(threads, None);
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped[0].left_line, Some(8));
    assert_eq!(mapped[0].right_line, None);
}

#[test]
fn validate_vote_accepts_only_known_values() {
    assert!(validate_vote(10).is_ok());
    assert!(validate_vote(5).is_ok());
    assert!(validate_vote(0).is_ok());
    assert!(validate_vote(-5).is_ok());
    assert!(validate_vote(-10).is_ok());
    assert!(validate_vote(3).is_err());
}

#[test]
fn validate_thread_status_accepts_active_and_closed() {
    assert!(validate_thread_status("active").is_ok());
    assert!(validate_thread_status("closed").is_ok());
    assert!(validate_thread_status("fixed").is_err());
}

#[test]
fn validate_merge_strategy_accepts_known_strategies() {
    for strategy in ["noFastForward", "squash", "rebase", "rebaseMerge"] {
        assert!(validate_merge_strategy(strategy).is_ok());
    }
    assert!(validate_merge_strategy("ff").is_err());
    assert!(validate_merge_strategy("").is_err());
}

#[test]
fn change_flags_parse_handles_undelete_and_combined_tokens() {
    let undelete = ChangeFlags::parse("undelete");
    assert!(undelete.is_add);
    assert!(!undelete.is_delete);

    let edit_rename = ChangeFlags::parse("edit, rename");
    assert!(!edit_rename.is_add);
    assert!(!edit_rename.is_delete);

    let delete = ChangeFlags::parse("delete");
    assert!(delete.is_delete);
    assert!(!delete.is_add);
}

#[test]
fn thread_resolved_treats_unknown_as_open() {
    assert!(thread_resolved(Some("closed")));
    assert!(thread_resolved(Some("fixed")));
    assert!(!thread_resolved(Some("active")));
    assert!(!thread_resolved(Some("pending")));
    assert!(!thread_resolved(Some("unknown")));
    assert!(!thread_resolved(None));
}

#[test]
fn root_comment_id_picks_the_thread_root_not_first_visible() {
    let thread: GitThread = serde_json::from_value(serde_json::json!({
        "id": 5,
        "comments": [
            { "id": 10, "parentCommentId": 0, "content": "root" },
            { "id": 11, "parentCommentId": 10, "content": "reply" }
        ]
    }))
    .unwrap();
    assert_eq!(root_comment_id(&thread), 10);
}
