use super::context::html_to_text;
use super::diffs::changed_region;
use super::{claim_check, is_due, pick, AutoItem};
use crate::agent_notes::NoteTarget;
use crate::db::{CachedReviewPr, CachedWorkItem};
use chrono::{DateTime, Utc};
use std::time::{Duration, Instant};

#[test]
fn an_item_with_a_notes_folder_or_result_html_is_handled() {
    let root = tempfile::tempdir().unwrap();
    let review = tempfile::tempdir().unwrap();
    let work_items = tempfile::tempdir().unwrap();
    let handled = super::handled_check(root.path(), Some(review.path()), Some(work_items.path()));
    assert!(!handled(NoteTarget::PullRequest, 7));

    std::fs::create_dir(root.path().join("pr-7")).unwrap();
    assert!(handled(NoteTarget::PullRequest, 7));
    assert!(!handled(NoteTarget::WorkItem, 7));
    // No result folder for a type: nothing is started blind.
    let without_folder = super::handled_check(root.path(), None, None);
    assert!(without_folder(NoteTarget::WorkItem, 8));
}

#[test]
fn a_check_is_due_only_after_the_interval() {
    let start = Instant::now();
    assert!(is_due(None, start, 15));
    assert!(!is_due(
        Some(start),
        start + Duration::from_secs(14 * 60),
        15
    ));
    assert!(is_due(
        Some(start),
        start + Duration::from_secs(15 * 60),
        15
    ));
}

#[test]
fn claiming_a_check_blocks_the_next_one_within_the_interval() {
    let start = Instant::now();
    assert!(claim_check("claim-test-org", 15, start));
    assert!(!claim_check(
        "claim-test-org",
        15,
        start + Duration::from_secs(60)
    ));
    assert!(claim_check(
        "claim-test-org",
        15,
        start + Duration::from_secs(15 * 60)
    ));
    // Another organization has its own clock.
    assert!(claim_check(
        "claim-test-other",
        15,
        start + Duration::from_secs(60)
    ));
}

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-11-07T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

fn pr(id: i64, is_draft: bool) -> CachedReviewPr {
    CachedReviewPr {
        org_id: "org".into(),
        project_id: "p".into(),
        project_name: "P".into(),
        repository_id: "r".into(),
        repository_name: "repo".into(),
        pull_request_id: id,
        title: format!("PR {id}"),
        created_by: None,
        creation_date: String::new(),
        target_ref_name: "refs/heads/main".into(),
        web_url: None,
        my_vote: 0,
        my_vote_label: "No vote".into(),
        my_is_required: false,
        is_draft,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn wi(id: i64) -> CachedWorkItem {
    CachedWorkItem {
        org_id: "org".into(),
        project_id: "p".into(),
        project_name: "P".into(),
        id,
        title: format!("WI {id}"),
        work_item_type: None,
        state: Some("Active".into()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: None,
        web_url: None,
        tags: None,
    }
}

fn ids(items: &[AutoItem]) -> Vec<(NoteTarget, i64)> {
    items
        .iter()
        .map(|item| (item.target(), item.id()))
        .collect()
}

#[test]
fn picks_unhandled_non_draft_items_pull_requests_first() {
    let picked = pick(
        vec![pr(1, false), pr(2, false), pr(3, true)],
        vec![wi(10), wi(11)],
        3,
        now(),
        |target, id| target == NoteTarget::PullRequest && id == 1,
    );
    assert_eq!(
        ids(&picked),
        vec![
            (NoteTarget::PullRequest, 2),
            (NoteTarget::WorkItem, 10),
            (NoteTarget::WorkItem, 11)
        ]
    );
}

#[test]
fn work_items_must_be_new_or_active_and_changed_within_30_days() {
    let with = |id, state: Option<&str>, changed: Option<&str>| CachedWorkItem {
        state: state.map(str::to_string),
        changed_date: changed.map(str::to_string),
        ..wi(id)
    };
    let picked = pick(
        Vec::new(),
        vec![
            with(1, Some("New"), Some("2026-11-01T00:00:00Z")),
            with(2, Some("active"), Some("2026-10-09T00:00:00Z")),
            with(3, Some("Active"), Some("2026-10-07T00:00:00Z")),
            with(4, Some("Doing"), Some("2026-11-01T00:00:00Z")),
            with(5, Some("Closed"), Some("2026-11-01T00:00:00Z")),
            with(6, None, Some("2026-11-01T00:00:00Z")),
            with(7, Some("Active"), None),
        ],
        10,
        now(),
        |_, _| false,
    );
    assert_eq!(
        ids(&picked),
        vec![
            (NoteTarget::WorkItem, 1),
            (NoteTarget::WorkItem, 2),
            (NoteTarget::WorkItem, 7)
        ]
    );
}

#[test]
fn caps_items_per_sync_leaving_the_rest_queued() {
    let picked = pick(
        vec![pr(1, false), pr(2, false)],
        vec![wi(10), wi(11)],
        3,
        now(),
        |_, _| false,
    );
    assert_eq!(
        ids(&picked),
        vec![
            (NoteTarget::PullRequest, 1),
            (NoteTarget::PullRequest, 2),
            (NoteTarget::WorkItem, 10)
        ]
    );
    // Once those have notes, the next sync takes the rest.
    let next = pick(
        vec![pr(1, false), pr(2, false)],
        vec![wi(10), wi(11)],
        3,
        now(),
        |target, id| target == NoteTarget::PullRequest || id == 10,
    );
    assert_eq!(ids(&next), vec![(NoteTarget::WorkItem, 11)]);
}

#[test]
fn the_limit_comes_from_the_caller() {
    let picked = pick(
        vec![pr(1, false), pr(2, false)],
        vec![],
        1,
        now(),
        |_, _| false,
    );
    assert_eq!(ids(&picked), vec![(NoteTarget::PullRequest, 1)]);
}

#[test]
fn leaves_out_pull_requests_i_voted_on_and_old_ones() {
    let mut voted = pr(1, false);
    voted.my_vote = 10;
    let mut old = pr(2, false);
    old.creation_date = "2026-09-01T00:00:00Z".into();
    let mut recent = pr(3, false);
    recent.creation_date = "2026-10-20T00:00:00Z".into();
    let picked = pick(vec![voted, old, recent], vec![], 3, now(), |_, _| false);
    assert_eq!(ids(&picked), vec![(NoteTarget::PullRequest, 3)]);
}

#[test]
fn html_to_text_keeps_line_breaks_and_decodes_entities() {
    assert_eq!(
        html_to_text("<div>a &amp; b</div><p>c<br/>d</p>\n\n\n<span>&lt;e&gt;</span>"),
        "a & b\nc\nd\n\n<e>"
    );
}

#[test]
fn changed_region_keeps_the_differing_lines_with_context() {
    let (before, after) = changed_region("a\nb\nc\nd\ne\nf\ng\nh\ni", "a\nb\nc\nd\nE\nf\ng\nh\ni");
    assert_eq!(before, "b\nc\nd\ne\nf\ng\nh");
    assert_eq!(after, "b\nc\nd\nE\nf\ng\nh");
}

#[test]
fn changed_region_of_an_added_file_is_the_whole_file() {
    let (before, after) = changed_region("", "x\ny");
    assert_eq!(before, "");
    assert_eq!(after, "x\ny");
}
