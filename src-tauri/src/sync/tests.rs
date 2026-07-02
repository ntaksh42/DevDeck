use super::notifications::{
    notification_allowed, pr_review_notification_items, work_item_notification_items,
    WorkItemNotificationKind,
};
use super::*;
use crate::db::{
    AppSettings, CachedReviewPr, CachedWorkItem, NotificationRule, MY_WORK_ITEMS_LIMIT,
};

fn rule(types: &[&str], projects: &[&str], repositories: &[&str]) -> NotificationRule {
    NotificationRule {
        types: types.iter().map(|s| s.to_string()).collect(),
        projects: projects.iter().map(|s| s.to_string()).collect(),
        repositories: repositories.iter().map(|s| s.to_string()).collect(),
        mute: false,
    }
}

fn mute_rule(types: &[&str], projects: &[&str], repositories: &[&str]) -> NotificationRule {
    NotificationRule {
        mute: true,
        ..rule(types, projects, repositories)
    }
}

#[test]
fn notification_allowed_passes_everything_with_no_rules() {
    assert!(notification_allowed(
        &[],
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
    assert!(notification_allowed(&[], "assigned", "Platform", None));
}

#[test]
fn notification_allowed_requires_a_matching_rule() {
    let rules = vec![rule(&["reviewRequested"], &["Platform"], &[])];
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
    // Wrong kind.
    assert!(!notification_allowed(
        &rules,
        "voteReset",
        "Platform",
        Some("Web")
    ));
    // Wrong project.
    assert!(!notification_allowed(
        &rules,
        "reviewRequested",
        "Other",
        Some("Web")
    ));
}

#[test]
fn notification_allowed_empty_field_means_any() {
    let rules = vec![rule(&[], &["Platform"], &[])];
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
    assert!(notification_allowed(&rules, "assigned", "Platform", None));
    assert!(!notification_allowed(&rules, "assigned", "Other", None));
}

#[test]
fn notification_allowed_repository_filter_is_pr_only() {
    let rules = vec![rule(&[], &[], &["Web"])];
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
    assert!(!notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Api")
    ));
    // Work items have no repository, so a repository rule never matches them.
    assert!(!notification_allowed(&rules, "assigned", "Platform", None));
}

#[test]
fn notification_allowed_matches_any_of_several_rules() {
    let rules = vec![
        rule(&["reviewRequested"], &[], &[]),
        rule(&["assigned"], &["Platform"], &[]),
    ];
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Other",
        Some("Web")
    ));
    assert!(notification_allowed(&rules, "assigned", "Platform", None));
    assert!(!notification_allowed(
        &rules,
        "stateChanged",
        "Platform",
        None
    ));
}

#[test]
fn notification_allowed_mute_rule_suppresses_matching_scope() {
    // With only a mute rule, everything else still passes (mute is a deny
    // list, not an allow list).
    let rules = vec![mute_rule(&[], &["Noisy"], &[])];
    assert!(!notification_allowed(&rules, "assigned", "Noisy", None));
    assert!(notification_allowed(&rules, "assigned", "Platform", None));
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
}

#[test]
fn notification_allowed_mute_takes_precedence_over_allow() {
    // An allow rule would admit the notification, but a matching mute rule
    // for one repository wins.
    let rules = vec![
        rule(&["reviewRequested"], &["Platform"], &[]),
        mute_rule(&[], &[], &["Noisy"]),
    ];
    assert!(notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Web")
    ));
    assert!(!notification_allowed(
        &rules,
        "reviewRequested",
        "Platform",
        Some("Noisy")
    ));
}

#[test]
fn backoff_grows_exponentially_and_caps() {
    assert_eq!(backoff_secs(0), BASE_INTERVAL_SECS);
    assert_eq!(backoff_secs(1), 300);
    assert_eq!(backoff_secs(2), 600);
    assert_eq!(backoff_secs(3), 1200);
    // 4th failure would be 2400s, clamped to the 1800s ceiling.
    assert_eq!(backoff_secs(4), MAX_BACKOFF_SECS);
    assert_eq!(backoff_secs(50), MAX_BACKOFF_SECS);
}

#[test]
fn pass_is_failure_only_when_no_success() {
    let mut all_failed = SyncPassOutcome::default();
    all_failed.record_failure();
    assert!(all_failed.is_failure());

    let mut mixed = SyncPassOutcome::default();
    mixed.record_failure();
    mixed.record_success();
    assert!(
        !mixed.is_failure(),
        "a partial success should not trip backoff"
    );

    // A pass that attempted nothing is not a failure.
    assert!(!SyncPassOutcome::default().is_failure());
}

#[test]
fn work_item_notification_items_skips_assignment_on_first_snapshot() {
    let settings = AppSettings {
        desktop_notifications_enabled: true,
        ..AppSettings::default()
    };
    let current = vec![work_item(1, "New item", Some("To Do"))];

    assert!(work_item_notification_items(&[], &current, &settings).is_empty());
}

fn review_pr(pr_id: i64, my_vote: i32) -> CachedReviewPr {
    CachedReviewPr {
        org_id: "o".into(),
        project_id: "p".into(),
        project_name: "Proj".into(),
        repository_id: "r".into(),
        repository_name: "Repo".into(),
        pull_request_id: pr_id,
        title: format!("PR {pr_id}"),
        created_by: None,
        creation_date: "2026-06-01T00:00:00Z".into(),
        target_ref_name: "main".into(),
        web_url: Some("https://x/pr".into()),
        my_vote,
        my_vote_label: String::new(),
        my_is_required: true,
        is_draft: false,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn pr_settings(review: bool, reset: bool) -> AppSettings {
    AppSettings {
        desktop_notifications_enabled: true,
        notify_pr_review_requests: review,
        notify_pr_vote_resets: reset,
        ..AppSettings::default()
    }
}

#[test]
fn pr_review_items_flags_new_review_and_vote_reset() {
    let prev = vec![review_pr(1, 10), review_pr(2, 0)];
    let curr = vec![review_pr(1, 0), review_pr(2, 0), review_pr(3, 0)];
    let items = pr_review_notification_items(&prev, &curr, &pr_settings(true, true));
    assert!(items
        .iter()
        .any(|i| i.pull_request_id == 1 && i.kind == PrNotificationKind::VoteReset));
    assert!(items
        .iter()
        .any(|i| i.pull_request_id == 3 && i.kind == PrNotificationKind::ReviewRequested));
    assert_eq!(items.len(), 2);
}

#[test]
fn pr_review_items_distinguish_same_pr_id_across_repos() {
    // Two repos can both expose pull request id 1. The snapshot diff must key
    // by (repository_id, pull_request_id) so a vote reset on one repo does not
    // mask or borrow the previous vote of the other.
    let mut prev_a = review_pr(1, 10);
    prev_a.repository_id = "repo-a".into();
    let mut prev_b = review_pr(1, 0);
    prev_b.repository_id = "repo-b".into();

    let mut curr_a = review_pr(1, 0);
    curr_a.repository_id = "repo-a".into();
    let mut curr_b = review_pr(1, 0);
    curr_b.repository_id = "repo-b".into();

    let items = pr_review_notification_items(
        &[prev_a, prev_b],
        &[curr_a, curr_b],
        &pr_settings(true, true),
    );
    // Only repo-a transitioned from approved to no-vote.
    assert_eq!(items.len(), 1);
    assert!(items.iter().any(|i| i.repository_id == "repo-a"
        && i.pull_request_id == 1
        && i.kind == PrNotificationKind::VoteReset));
}

#[test]
fn pr_review_items_suppressed_on_first_snapshot() {
    let curr = vec![review_pr(1, 0), review_pr(2, 0)];
    let items = pr_review_notification_items(&[], &curr, &pr_settings(true, true));
    assert!(items.is_empty());
}

#[test]
fn pr_review_items_respect_toggles() {
    let prev = vec![review_pr(1, 10)];
    let curr = vec![review_pr(1, 0), review_pr(2, 0)];
    let items = pr_review_notification_items(&prev, &curr, &pr_settings(false, false));
    assert!(items.is_empty());
}

#[test]
fn work_item_notification_items_reports_assignment_and_state_changes() {
    let settings = AppSettings {
        desktop_notifications_enabled: true,
        ..AppSettings::default()
    };
    let previous = vec![
        work_item(1, "Existing", Some("To Do")),
        work_item(2, "Unchanged", Some("Doing")),
    ];
    let current = vec![
        work_item(1, "Existing", Some("Done")),
        work_item(2, "Unchanged", Some("Doing")),
        work_item(3, "Assigned", Some("To Do")),
    ];

    let notifications = work_item_notification_items(&previous, &current, &settings);

    assert_eq!(notifications.len(), 2);
    assert_eq!(
        notifications[0].kind,
        WorkItemNotificationKind::StateChanged
    );
    assert_eq!(notifications[0].previous_state.as_deref(), Some("To Do"));
    assert_eq!(notifications[0].state.as_deref(), Some("Done"));
    assert_eq!(notifications[1].kind, WorkItemNotificationKind::Assigned);
    assert_eq!(notifications[1].id, 3);
}

#[test]
fn work_item_notification_items_skips_items_reentering_full_window() {
    let settings = AppSettings {
        desktop_notifications_enabled: true,
        ..AppSettings::default()
    };
    // Previous snapshot is at the cap; its oldest change is 2026-06-02.
    let previous: Vec<CachedWorkItem> = (1..=MY_WORK_ITEMS_LIMIT as i64)
        .map(|id| work_item_changed(id, "Existing", Some("To Do"), "2026-06-02T00:00:00Z"))
        .collect();
    let mut current = previous.clone();
    current.pop();
    // Older than the window edge: re-entered, not newly assigned.
    current.push(work_item_changed(
        9001,
        "Re-entered",
        Some("To Do"),
        "2026-06-01T00:00:00Z",
    ));
    // Exactly at the window edge: also treated as re-entered.
    current.push(work_item_changed(
        9003,
        "At edge",
        Some("To Do"),
        "2026-06-02T00:00:00Z",
    ));
    // Newer than the window edge: genuinely new assignment.
    current.push(work_item_changed(
        9002,
        "Fresh",
        Some("To Do"),
        "2026-06-03T00:00:00Z",
    ));

    let notifications = work_item_notification_items(&previous, &current, &settings);

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].id, 9002);
}

fn work_item_changed(
    id: i64,
    title: &str,
    state: Option<&str>,
    changed_date: &str,
) -> CachedWorkItem {
    CachedWorkItem {
        changed_date: Some(changed_date.to_string()),
        ..work_item(id, title, state)
    }
}

fn work_item(id: i64, title: &str, state: Option<&str>) -> CachedWorkItem {
    CachedWorkItem {
        org_id: "org".to_string(),
        project_id: "project".to_string(),
        project_name: "Project".to_string(),
        id,
        title: title.to_string(),
        work_item_type: Some("Issue".to_string()),
        state: state.map(str::to_string),
        assigned_to: Some("Test User".to_string()),
        assigned_to_unique_name: None,
        changed_date: Some("2026-06-03T00:00:00Z".to_string()),
        web_url: Some(format!(
            "https://dev.azure.com/org/project/_workitems/edit/{id}"
        )),
        tags: None,
    }
}
