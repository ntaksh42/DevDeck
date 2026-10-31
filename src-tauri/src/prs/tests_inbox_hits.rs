use std::collections::HashSet;

use azdo_client::{GitThread, GitThreadComment, IdentityRef};

use super::inbox_hits::{inbox_comment_hits, KIND_PR_GROUP_MENTION};
use super::scan_limit_warning;

const ME: &str = "me-guid";
const TEAM: &str = "team-guid";

fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
    GitThreadComment {
        id,
        parent_comment_id: None,
        content: Some(content.into()),
        comment_type: Some("text".into()),
        author: Some(IdentityRef {
            id: Some(author_id.into()),
            display_name: Some(author_id.into()),
            unique_name: None,
        }),
        published_date: None,
        is_deleted: false,
    }
}

fn thread(id: i64, comments: Vec<GitThreadComment>) -> GitThread {
    GitThread {
        id,
        status: Some("active".into()),
        is_deleted: false,
        comments: Some(comments),
        thread_context: None,
    }
}

fn kinds(
    threads: &[GitThread],
    last_seen: Option<i64>,
    authored: bool,
) -> Vec<(i64, &'static str)> {
    let groups: HashSet<String> = [TEAM.to_string()].into();
    inbox_comment_hits(threads, ME, &groups, last_seen, authored)
        .0
        .into_iter()
        .map(|hit| (hit.comment_id, hit.kind))
        .collect()
}

#[test]
fn a_team_mention_is_its_own_kind_and_a_direct_mention_wins() {
    let threads = [
        thread(
            1,
            vec![comment(10, "tanaka", &format!("@<{TEAM}> review please"))],
        ),
        thread(
            2,
            vec![comment(11, "tanaka", &format!("@<{TEAM}> and @<{ME}>"))],
        ),
    ];
    assert_eq!(
        kinds(&threads, Some(0), false),
        vec![(10, KIND_PR_GROUP_MENTION), (11, "pr_mention")]
    );
}

#[test]
fn a_waiting_team_mention_is_kept_on_the_first_scan() {
    let threads = [thread(
        1,
        vec![comment(10, "tanaka", &format!("@<{TEAM}> review please"))],
    )];
    assert_eq!(
        kinds(&threads, None, false),
        vec![(10, KIND_PR_GROUP_MENTION)]
    );
}

#[test]
fn on_my_own_pr_a_thread_without_me_counts_only_its_first_comment() {
    let threads = [
        thread(
            1,
            vec![
                comment(10, "tanaka", "this looks wrong"),
                comment(11, "suzuki", "agreed"),
                comment(12, "tanaka", "fixing the test"),
            ],
        ),
        // Once the user joins, every later comment is a reply again.
        thread(
            2,
            vec![
                comment(20, "tanaka", "question"),
                comment(21, ME, "answer"),
                comment(22, "tanaka", "thanks"),
            ],
        ),
    ];
    assert_eq!(
        kinds(&threads, Some(0), true),
        vec![(10, "pr_reply"), (20, "pr_reply"), (22, "pr_reply")]
    );
    // Later comments of the thread without the user add nothing.
    assert_eq!(kinds(&threads[..1], Some(10), true), Vec::new());
}

#[test]
fn the_scan_cap_warning_names_what_was_left_out() {
    assert_eq!(scan_limit_warning(0, 0), None);
    let warning = scan_limit_warning(3, 2).unwrap();
    assert!(warning.contains("3 older review PR(s)"), "{warning}");
    assert!(warning.contains("2 older PR(s) of yours"), "{warning}");
}
