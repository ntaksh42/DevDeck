use std::collections::HashSet;

use super::context::html_to_text;
use super::{pick, AutoItem, Before};
use crate::agent_notes::NoteTarget;
use crate::db::{CachedReviewPr, CachedWorkItem};

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
        state: None,
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: None,
        web_url: None,
        tags: None,
    }
}

fn before(prs: Option<&[i64]>, wis: Option<&[i64]>) -> Before {
    let set = |ids: &[i64]| ids.iter().copied().collect::<HashSet<_>>();
    Before {
        prs: prs.map(set),
        work_items: wis.map(set),
    }
}

fn ids(items: &[AutoItem]) -> Vec<(NoteTarget, i64)> {
    items
        .iter()
        .map(|item| (item.target(), item.id()))
        .collect()
}

#[test]
fn picks_only_new_non_draft_items_pull_requests_first() {
    let picked = pick(
        &before(Some(&[1]), Some(&[10])),
        vec![pr(1, false), pr(2, false), pr(3, true)],
        vec![wi(10), wi(11)],
        |_, _| false,
    );
    assert_eq!(
        ids(&picked),
        vec![(NoteTarget::PullRequest, 2), (NoteTarget::WorkItem, 11)]
    );
}

#[test]
fn caps_items_per_sync_and_skips_items_with_notes() {
    let picked = pick(
        &before(Some(&[]), Some(&[])),
        vec![pr(1, false), pr(2, false)],
        vec![wi(10), wi(11), wi(12)],
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
fn starts_nothing_without_an_earlier_sync() {
    let picked = pick(
        &before(None, None),
        vec![pr(1, false)],
        vec![wi(10)],
        |_, _| false,
    );
    assert!(picked.is_empty());
}

#[test]
fn html_to_text_keeps_line_breaks_and_decodes_entities() {
    assert_eq!(
        html_to_text("<div>a &amp; b</div><p>c<br/>d</p>\n\n\n<span>&lt;e&gt;</span>"),
        "a & b\nc\nd\n\n<e>"
    );
}
