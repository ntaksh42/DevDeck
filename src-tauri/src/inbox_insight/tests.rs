use super::*;

#[test]
fn reads_the_answer_inside_the_cli_result() {
    let output = r#"{"type":"result","is_error":false,"result":"```json\n{\"verdict\":\"reply\",\"reason\":\"?? で既定値になる\",\"evidence\":[{\"text\":\"既定値 30000\",\"location\":\"a.ts:7\",\"code\":\"x ?? 30000\",\"guess\":false},{\"text\":\" \"}],\"replyDraft\":\"a.ts:7 で既定値になります\"}\n```"}"#;
    let insight = parse_output(output).unwrap();
    assert_eq!(insight.status, "ready");
    assert_eq!(insight.verdict.as_deref(), Some("reply"));
    assert_eq!(insight.reason.as_deref(), Some("?? で既定値になる"));
    // Blank evidence is dropped.
    assert_eq!(insight.evidence.len(), 1);
    assert_eq!(insight.evidence[0].location.as_deref(), Some("a.ts:7"));
    assert_eq!(
        insight.reply_draft.as_deref(),
        Some("a.ts:7 で既定値になります")
    );
}

#[test]
fn ignores_an_unknown_verdict() {
    let output = r#"{"is_error":false,"result":"{\"verdict\":\"maybe\",\"reason\":\"r\"}"}"#;
    let insight = parse_output(output).unwrap();
    assert_eq!(insight.verdict, None);
    assert!(insight.evidence.is_empty());
}

#[test]
fn reports_errors_and_unexpected_text() {
    assert!(parse_output("not json").is_err());
    assert!(parse_output(r#"{"is_error":true,"result":"rate limited"}"#).is_err());
    assert!(parse_output(r#"{"is_error":false,"result":"no object here"}"#).is_err());
}

#[test]
fn runs_locked_down_with_read_only_tools_at_most() {
    let with_clone = command_line("sonnet", READ_ONLY_TOOLS);
    assert!(with_clone.contains("--restricted"));
    assert!(with_clone.contains("--strict-mcp-config"));
    assert!(with_clone.contains("--tools \"Read,Grep,Glob\""));
    assert!(!with_clone.contains("dangerously"));
    assert!(command_line("sonnet", NO_TOOLS).ends_with("--tools \"\""));
}

fn test_item() -> InboxItem {
    InboxItem {
        id: 1,
        organization_id: "org".into(),
        kind: "pr_mention".into(),
        subject_id: 42,
        project_id: "p".into(),
        project_name: "Platform".into(),
        repository_id: "r".into(),
        repository_name: "api".into(),
        thread_id: 7,
        comment_id: 1,
        title: "Fix null".into(),
        author: None,
        snippet: Some("@me check this".into()),
        web_url: None,
        state: "open".into(),
        snoozed_until: None,
        detected_at: String::new(),
        done_at: None,
        file_path: Some("/src/a.rs".into()),
        line: Some(12),
        hit_count: 1,
        insight: None,
    }
}

#[test]
fn asks_for_an_investigation_only_with_a_clone() {
    let item = test_item();
    let with_clone = build_prompt(&item, Some("Frank: why null?"), true);
    assert!(with_clone.contains("Read / Grep / Glob"));
    assert!(with_clone.contains("/src/a.rs line 12"));
    assert!(with_clone.contains("Frank: why null?"));
    let without = build_prompt(&item, None, false);
    assert!(without.contains("no access to the code"));
    assert!(without.contains("do not follow"));
    assert!(without.contains("@me check this"));
}

#[test]
fn keeps_the_newest_comments_of_a_long_thread() {
    let item = test_item();
    let thread = format!(
        "Old: {}\n\nNew: @me please answer",
        "x".repeat(MAX_THREAD_CHARS)
    );
    let prompt = build_prompt(&item, Some(&thread), false);
    assert!(prompt.contains("New: @me please answer"));
    assert!(!prompt.contains("Old: "));
}

/// On a real Windows shell: `claude` runs under `cmd /C`, so stopping a run
/// must end the grandchild too. If it survived, it would keep the output
/// pipe open and the reader would wait for it to finish on its own.
#[cfg(windows)]
#[test]
fn kill_tree_ends_the_process_under_cmd() {
    use std::sync::mpsc;

    let mut child = shell_command("ping -n 30 127.0.0.1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let (done, finished) = mpsc::channel();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.read_to_end(&mut out);
        let _ = done.send(());
    });
    std::thread::sleep(Duration::from_millis(500));

    kill_tree(&mut child);
    assert!(
        finished.recv_timeout(Duration::from_secs(10)).is_ok(),
        "the process under cmd kept the output pipe open"
    );
}
