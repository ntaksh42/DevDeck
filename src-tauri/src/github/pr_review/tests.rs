use serde_json::json;

use super::*;

fn detail() -> PullRequestDetail {
    serde_json::from_value(json!({
        "number": 1,
        "title": "t",
        "state": "open",
        "html_url": "https://github.com/o/r/pull/1",
        "created_at": "2026-10-01T00:00:00Z",
        "head": { "ref": "feature", "sha": "a" },
        "base": { "ref": "main", "sha": "b" },
    }))
    .unwrap()
}

fn review(login: &str, state: &str, at: &str) -> ReviewItem {
    serde_json::from_value(json!({
        "id": 1,
        "user": { "login": login },
        "state": state,
        "submitted_at": at,
    }))
    .unwrap()
}

#[test]
fn a_later_comment_keeps_the_approval() {
    let reviews = [
        review("Alice", "APPROVED", "2026-10-01T00:00:00Z"),
        review("Alice", "COMMENTED", "2026-10-02T00:00:00Z"),
        review("Bob", "COMMENTED", "2026-10-01T00:00:00Z"),
        review("Bob", "CHANGES_REQUESTED", "2026-10-02T00:00:00Z"),
        review("Bob", "APPROVED", "2026-10-03T00:00:00Z"),
    ];
    let reviewers = build_reviewers(&detail(), &reviews, "carol");
    let votes: Vec<(&str, i32)> = reviewers
        .iter()
        .map(|r| (r.display_name.as_str(), r.vote))
        .collect();
    assert_eq!(votes, vec![("Alice", 10), ("Bob", 10)]);
}

#[test]
fn recognises_the_user_whatever_the_login_case() {
    let reviewers = build_reviewers(
        &detail(),
        &[review("OctoCat", "APPROVED", "2026-10-01T00:00:00Z")],
        "octocat",
    );
    assert!(reviewers[0].is_me);
    assert!(!is_me(Some("octocat"), ""));
}
