use super::*;
use crate::db::AppDatabase;

fn conn() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(dir.path().join("t.sqlite3"));
    db.initialize().unwrap();
    let conn = db.open().unwrap();
    (dir, conn)
}

fn s(title: &str, target: Option<&str>) -> NewSuggestion {
    NewSuggestion {
        title: title.into(),
        why: "w".into(),
        ask: "a".into(),
        target: target.map(str::to_string),
        target_label: None,
        web_url: None,
        urgency: "today".into(),
    }
}

#[test]
fn a_repeated_suggestion_updates_the_open_row() {
    let (_d, conn) = conn();
    let run = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    assert!(matches!(
        suggest(&conn, run, &s("Fix CI", Some("pr:o/r/1")), 10).unwrap(),
        SuggestOutcome::Added
    ));
    let run2 = begin_run(&conn, "manual", None, "claude", None, 2).unwrap();
    assert!(matches!(
        suggest(&conn, run2, &s("Fix CI now", Some("pr:o/r/1")), 20).unwrap(),
        SuggestOutcome::Updated
    ));
    let open = open_suggestions(&conn, 0).unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].title, "Fix CI now");
    assert_eq!(open[0].kind, "pr");
    // Still new: it was first made after seen_at 5.
    assert!(open_suggestions(&conn, 5).unwrap()[0].is_new);
    assert!(!open_suggestions(&conn, 50).unwrap()[0].is_new);
}

#[test]
fn a_dismissed_suggestion_is_not_made_again_for_a_week() {
    let (_d, conn) = conn();
    let run = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    suggest(&conn, run, &s("Review  !812", None), 10).unwrap();
    let id = open_suggestions(&conn, 0).unwrap()[0].id.clone();
    assert!(resolve(&conn, &id, "dismissed", 20).unwrap());
    assert!(!resolve(&conn, &id, "started", 21).unwrap());
    assert!(matches!(
        suggest(&conn, run, &s("review !812", None), 30).unwrap(),
        SuggestOutcome::Dismissed
    ));
    assert!(matches!(
        suggest(
            &conn,
            run,
            &s("review !812", None),
            20 + DISMISSED_FOR_MS + 1
        )
        .unwrap(),
        SuggestOutcome::Added
    ));
}

#[test]
fn dismissing_one_suggestion_keeps_others_about_the_same_target() {
    let (_d, conn) = conn();
    let run = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    suggest(&conn, run, &s("Review !798", Some("pr:o/r/798")), 10).unwrap();
    let id = open_suggestions(&conn, 0).unwrap()[0].id.clone();
    resolve(&conn, &id, "dismissed", 20).unwrap();
    assert!(matches!(
        suggest(&conn, run, &s("review  !798", Some("pr:o/r/798")), 30).unwrap(),
        SuggestOutcome::Dismissed
    ));
    assert!(matches!(
        suggest(&conn, run, &s("Fix CI on !798", Some("pr:o/r/798")), 40).unwrap(),
        SuggestOutcome::Added
    ));
}

#[test]
fn urgent_suggestions_come_first() {
    let (_d, conn) = conn();
    let run = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    for (title, urgency) in [("a", "later"), ("b", "today"), ("c", "now")] {
        let mut input = s(title, None);
        input.urgency = urgency.into();
        suggest(&conn, run, &input, 10).unwrap();
    }
    let open = open_suggestions(&conn, 0).unwrap();
    assert_eq!(
        open.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(),
        vec!["c", "b", "a"]
    );
    assert_eq!(open[0].urgency, "now");
}

#[test]
fn suggestions_about_items_the_cache_dropped_are_closed() {
    let (_d, conn) = conn();
    let run = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    suggest(&conn, run, &s("merged", Some("pr:o/r/1")), 10).unwrap();
    suggest(&conn, run, &s("still open", Some("pr:o/r/2")), 10).unwrap();
    suggest(&conn, run, &s("closed", Some("wi:o/5")), 10).unwrap();
    suggest(&conn, run, &s("pipeline", Some("pipe:o/p/3")), 10).unwrap();
    suggest(&conn, run, &s("no target", None), 10).unwrap();
    let live = ["pr:o/r/2".to_string()].into_iter().collect();
    assert_eq!(close_gone(&conn, &live, 20).unwrap(), 2);
    let open = open_suggestions(&conn, 0).unwrap();
    assert_eq!(
        open.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(),
        vec!["still open", "pipeline", "no target"]
    );
    assert_eq!(open[1].kind, "pipe");
}

#[test]
fn a_successful_look_replaces_what_it_did_not_repeat() {
    let (_d, conn) = conn();
    let first = begin_run(&conn, "manual", None, "claude", None, 1).unwrap();
    suggest(&conn, first, &s("old", None), 10).unwrap();
    let second = begin_run(&conn, "manual", None, "claude", None, 2).unwrap();
    suggest(&conn, second, &s("new", None), 20).unwrap();
    settle_after_look(&conn, second, 30).unwrap();
    let open = open_suggestions(&conn, 0).unwrap();
    assert_eq!(
        open.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(),
        vec!["new"]
    );
    let (listed, _, _) = history_titles(&conn, 40).unwrap();
    assert_eq!(listed, vec!["new"]);
}

#[test]
fn counts_failures_since_the_last_success() {
    let (_d, conn) = conn();
    for (i, outcome) in ["ok", "failed", "usage_limited", "failed"]
        .iter()
        .enumerate()
    {
        let id = begin_run(&conn, "manual", None, "claude", None, i as i64).unwrap();
        end_run(&conn, id, outcome, None, &[], i as i64 + 1).unwrap();
    }
    assert_eq!(failures_in_a_row(&recent_runs(&conn, 20).unwrap()), 2);
}

#[test]
fn settings_round_trip_with_defaults() {
    let (_d, conn) = conn();
    assert_eq!(load_settings(&conn).unwrap(), HomeBotSettings::default());
    let changed = HomeBotSettings {
        agent: "codex".into(),
        model: String::new(),
        ..HomeBotSettings::default()
    };
    save_settings(&conn, &changed).unwrap();
    assert_eq!(load_settings(&conn).unwrap(), changed);
}
