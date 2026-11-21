use super::*;
use crate::agent_notes::{AgentNote, NoteReply};

fn bot() -> (tempfile::TempDir, HomeBot) {
    let dir = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(dir.path().join("t.sqlite3"));
    db.initialize().unwrap();
    (dir, HomeBot::new(db, None))
}

#[test]
fn opening_home_arms_the_schedule() {
    let (_d, bot) = bot();
    let conn = bot.db.open().unwrap();
    let view = bot.view().unwrap();
    assert!(store::get_kv_ms(&conn, ARMED_KEY).unwrap().is_none());
    bot.mark_seen().unwrap();
    assert!(store::get_kv_ms(&conn, ARMED_KEY).unwrap().is_some());
    assert!(view.suggestions.is_empty());
    assert_eq!(view.settings.agent, "claude");
}

#[test]
fn settings_are_checked_and_codex_can_be_chosen() {
    let (_d, bot) = bot();
    let bad = HomeBotSettings {
        every: "hourly".into(),
        ..HomeBotSettings::default()
    };
    assert!(bot.save_settings(bad).is_err());
    let bad_model = HomeBotSettings {
        model: "x & del".into(),
        ..HomeBotSettings::default()
    };
    assert!(bot.save_settings(bad_model).is_err());
    let codex = HomeBotSettings {
        agent: "codex".into(),
        model: " gpt-5.1 ".into(),
        focus: "f".repeat(900),
        ..HomeBotSettings::default()
    };
    let saved = bot.save_settings(codex).unwrap();
    assert_eq!(saved.agent, "codex");
    assert_eq!(saved.model, "gpt-5.1");
    assert_eq!(saved.focus.chars().count(), FOCUS_MAX_CHARS);
    assert_eq!(bot.view().unwrap().settings.agent, "codex");
}

#[test]
fn an_empty_message_is_refused_and_a_new_chat_starts_empty() {
    let (_d, bot) = bot();
    let input = SendHomeMessageInput {
        text: "  ".into(),
        target: None,
        suggestion_id: None,
        agent: None,
        model: None,
    };
    assert!(bot.send_message(input).is_err());
    let first = bot.chat_view().unwrap();
    assert_eq!(first.state, "idle");
    std::thread::sleep(std::time::Duration::from_millis(5));
    let next = bot.new_chat().unwrap();
    assert_ne!(first.chat_id, next);
    assert!(bot.chat_view().unwrap().messages.is_empty());
}

fn note(status: &str, last_author: Option<&str>) -> AgentNote {
    AgentNote {
        id: "n".into(),
        status: status.into(),
        created_at: String::new(),
        modified_at: None,
        body: "b".into(),
        quote: None,
        quote_prefix: None,
        quote_suffix: None,
        quote_offset: None,
        result_file: None,
        result_hash: None,
        kind: None,
        context: None,
        context_file: None,
        resolved: None,
        replies: last_author
            .map(|author| {
                vec![NoteReply {
                    author: author.into(),
                    created_at: String::new(),
                    body: "r".into(),
                    kind: "reply".into(),
                    posted_at: None,
                    posted_ref: None,
                    file_path: None,
                    line: None,
                }]
            })
            .unwrap_or_default(),
        file_path: String::new(),
    }
}

#[test]
fn a_worker_ends_done_needs_you_or_failed() {
    assert_eq!(
        dispatch::finished_status(&note("done", Some("claude"))),
        "done"
    );
    assert_eq!(
        dispatch::finished_status(&note("open", Some("codex"))),
        "needs_you"
    );
    assert_eq!(
        dispatch::finished_status(&note("open", Some("user"))),
        "failed"
    );
    assert_eq!(dispatch::finished_status(&note("open", None)), "failed");
}

/// Runs a real look and a real chat turn with the installed CLIs.
/// `DEVDECK_HOME_BOT_AGENT=codex cargo test -p azdo-dashboard real_agent -- --ignored`
#[test]
#[ignore]
fn real_agent_look_and_turn() {
    let (_d, bot) = bot();
    let agent = std::env::var("DEVDECK_HOME_BOT_AGENT").unwrap_or_else(|_| "claude".into());
    let model = if agent == "claude" {
        "sonnet".to_string()
    } else {
        String::new()
    };
    bot.save_settings(HomeBotSettings {
        agent: agent.clone(),
        model,
        ..HomeBotSettings::default()
    })
    .unwrap();
    bot.run_look("manual", None).unwrap();
    let runs = store::recent_runs(&bot.db.open().unwrap(), 1).unwrap();
    assert_eq!(
        runs[0].outcome.as_deref(),
        Some("ok"),
        "look failed: {:?}",
        runs[0].error
    );
    bot.send_message(SendHomeMessageInput {
        text: "今日は何から手を付けるべき？".into(),
        target: None,
        suggestion_id: None,
        agent: Some(agent),
        model: None,
    })
    .unwrap();
    for _ in 0..300 {
        if !bot.lock().turn_running {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    let view = bot.chat_view().unwrap();
    assert_eq!(view.error, None);
    let reply = view
        .messages
        .iter()
        .find(|m| m.author == "orchestrator")
        .expect("an Orchestrator reply");
    println!("brief: {:?}\nreply: {}", runs[0].brief, reply.body);
}

/// A real worker: the Orchestrator starts one, it replies in its note, and the
/// Orchestrator summarizes it. `cargo test -p azdo-dashboard real_worker -- --ignored`
#[test]
#[ignore]
fn real_worker_round_trip() {
    let (_d, bot) = bot();
    bot.send_message(SendHomeMessageInput {
        text:
            "worker を 1 つ起動して、1+1 の答えだけをメモに返信させて。対象はなし (target null)。"
                .into(),
        target: None,
        suggestion_id: None,
        agent: Some("claude".into()),
        model: Some("sonnet".into()),
    })
    .unwrap();
    let mut summarized = false;
    for _ in 0..600 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let view = bot.chat_view().unwrap();
        let done = view
            .workers
            .iter()
            .any(|w| matches!(w.status.as_str(), "done" | "needs_you" | "failed"));
        if done
            && view.state == "idle"
            && view
                .messages
                .iter()
                .filter(|m| m.author == "orchestrator")
                .count()
                >= 2
        {
            summarized = true;
            for m in &view.messages {
                println!("[{}] {} {:?}", m.author, m.body, m.worker_ids);
            }
            println!(
                "workers: {:?}",
                view.workers
                    .iter()
                    .map(|w| (&w.status, &w.title))
                    .collect::<Vec<_>>()
            );
            break;
        }
    }
    assert!(summarized, "no summary: {:?}", bot.chat_view().unwrap());
}

#[test]
fn a_worker_without_a_result_folder_says_where_it_runs() {
    let (_d, bot) = bot();
    let target = |key: &str| snapshot::Target {
        key: key.into(),
        label: "!798".into(),
        title: "t".into(),
        repository: None,
        web_url: None,
    };
    let pr = dispatch::fallback_note(&bot, Some(&target("pr:o/r/798"))).unwrap();
    assert!(pr.contains("Review result folder"));
    let wi = dispatch::fallback_note(&bot, Some(&target("wi:o/4521"))).unwrap();
    assert!(wi.contains("Work item result folder"));
    assert!(dispatch::fallback_note(&bot, None).is_none());
}
