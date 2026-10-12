use super::*;

fn launch<'a>(
    result: &'a Path,
    workspace: Option<&'a Path>,
    repository: Option<&'a str>,
) -> AgentLaunch<'a> {
    AgentLaunch {
        result_folder: result,
        notes_root: Path::new("C:/data/agent-notes"),
        workspace,
        repository,
        model: None,
    }
}

#[cfg(windows)]
#[test]
fn shell_command_keeps_quoted_arguments_intact() {
    let output = shell_command("echo \"handle 7 in C:\\dir\"")
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        "\"handle 7 in C:\\dir\""
    );
}

#[test]
fn expands_placeholders_and_falls_back_to_the_default_command() {
    let folder = Path::new("C:/r");
    let ctx = launch(folder, None, None);
    let cmd = expand(
        AgentKind::Claude,
        Some(" claude -p \"handle {target} {id} in {notes}\" "),
        &ctx,
        NoteTarget::PullRequest,
        7,
    )
    .unwrap();
    assert!(cmd.starts_with("claude -p \"handle pull-request 7 in C:/data/agent-notes"));
    assert!(cmd.contains("pr-7"));
    let default = expand(AgentKind::Claude, None, &ctx, NoteTarget::WorkItem, 1).unwrap();
    assert!(default.starts_with("claude -p \"Read C:/r"));
    assert!(default.contains("--add-dir \"C:/data/agent-notes"));
    assert!(!default.contains('{'));
    assert_eq!(
        expand(AgentKind::Claude, Some("  "), &ctx, NoteTarget::WorkItem, 1).unwrap(),
        default
    );
    let codex = expand(AgentKind::Codex, None, &ctx, NoteTarget::WorkItem, 1).unwrap();
    assert!(codex.starts_with("codex exec "));
    assert!(codex.contains("--add-dir \"C:/data/agent-notes"));
    assert!(!codex.contains('{'));
}

#[test]
fn appends_the_model_flag_and_refuses_unsafe_model_names() {
    let folder = Path::new("C:/r");
    let mut ctx = launch(folder, None, None);
    ctx.model = Some("opus");
    let claude = expand(
        AgentKind::Claude,
        Some("claude -p x"),
        &ctx,
        NoteTarget::WorkItem,
        1,
    )
    .unwrap();
    assert_eq!(claude, "claude -p x --model \"opus\"");
    ctx.model = Some("gpt-5.1");
    let codex = expand(AgentKind::Codex, None, &ctx, NoteTarget::WorkItem, 1).unwrap();
    assert!(codex.starts_with("codex exec "));
    assert!(codex.ends_with(" -m \"gpt-5.1\""));
    for bad in ["", "opus & calc", "a\"b", "x;y", "m%PATH%"] {
        ctx.model = Some(bad);
        assert!(
            matches!(
                expand(AgentKind::Claude, None, &ctx, NoteTarget::WorkItem, 1),
                Err(AppError::InvalidInput(_))
            ),
            "model {bad:?}"
        );
    }
}

#[test]
fn expands_workspace_repo_and_guide() {
    let result = Path::new("C:/r");
    let workspace = Path::new("C:/ws");
    let ctx = launch(result, Some(workspace), Some("api-gateway"));
    let cmd = expand(
        AgentKind::Claude,
        Some("agent --cwd {workspace} --repo {repo} --guide {guide}"),
        &ctx,
        NoteTarget::PullRequest,
        7,
    )
    .unwrap();
    assert!(cmd.contains("--cwd C:/ws"));
    assert!(cmd.contains("--repo api-gateway"));
    assert!(cmd.contains("--guide C:/r"));
    assert!(cmd.ends_with("AGENTS.md"));

    // Without a workspace or repository the placeholders are empty.
    let bare = launch(result, None, None);
    let cmd = expand(
        AgentKind::Claude,
        Some("a {workspace}|{repo}|"),
        &bare,
        NoteTarget::WorkItem,
        1,
    )
    .unwrap();
    assert_eq!(cmd, "a ||");
}

#[test]
fn work_dir_prefers_the_repository_clone_then_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    let result = root.path().join("results");
    std::fs::create_dir_all(workspace.join("api-gateway")).unwrap();
    std::fs::create_dir_all(&result).unwrap();

    assert_eq!(
        launch(&result, Some(&workspace), Some("api-gateway")).work_dir(),
        workspace.join("api-gateway")
    );
    // No clone of that repository: fall back to the workspace root.
    assert_eq!(
        launch(&result, Some(&workspace), Some("infra")).work_dir(),
        workspace
    );
    assert_eq!(
        launch(&result, Some(&workspace), None).work_dir(),
        workspace
    );
    // No workspace: the result folder, as before.
    assert_eq!(
        launch(&result, None, Some("api-gateway")).work_dir(),
        result
    );
}

#[test]
fn a_repository_name_cannot_leave_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("ws");
    let outside = root.path().join("outside");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let result = root.path().join("results");

    for name in ["..", "../outside", "a/b", "a\\b", "C:", ""] {
        let ctx = launch(&result, Some(&workspace), Some(name));
        assert_eq!(ctx.work_dir(), workspace, "name {name:?}");
        let cmd = expand(
            AgentKind::Claude,
            Some("run {repo}"),
            &ctx,
            NoteTarget::WorkItem,
            1,
        )
        .unwrap();
        assert_eq!(cmd, "run ", "name {name:?}");
    }
}

#[test]
fn the_agent_starts_signed_out_of_azure() {
    let root = tempfile::tempdir().unwrap();
    let result = root.path().join("results");
    std::fs::create_dir_all(&result).unwrap();
    let out = result.join("env.txt");
    let mut ctx = launch(&result, None, None);
    ctx.notes_root = root.path();
    #[cfg(windows)]
    let command = format!("echo %AZURE_CONFIG_DIR%> \"{}\"", out.display());
    #[cfg(not(windows))]
    let command = format!("echo \"$AZURE_CONFIG_DIR\" > '{}'", out.display());
    run_agent(
        &ctx,
        AgentKind::Claude,
        Some(&command),
        NoteTarget::WorkItem,
        9,
    )
    .unwrap();
    for _ in 0..50 {
        if out.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let written = std::fs::read_to_string(&out).unwrap();
    assert_eq!(Path::new(written.trim()), root.path().join(ISOLATED_AZ_DIR));
}

#[test]
fn the_agent_cannot_push_with_git() {
    let root = tempfile::tempdir().unwrap();
    let repo = root.path().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .unwrap()
    };
    if git(&["init", "-q"]).status.code().is_none() {
        return;
    }
    git(&[
        "remote",
        "add",
        "origin",
        "https://dev.azure.com/org/p/_git/r",
    ]);
    let out = repo.join("push.txt");
    let mut ctx = launch(&repo, None, None);
    ctx.notes_root = root.path();
    let command = format!("git remote get-url --push origin > \"{}\"", out.display());
    run_agent(
        &ctx,
        AgentKind::Claude,
        Some(&command),
        NoteTarget::WorkItem,
        11,
    )
    .unwrap();
    for _ in 0..50 {
        if out.exists() && !std::fs::read_to_string(&out).unwrap().is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let push_url = std::fs::read_to_string(&out).unwrap();
    assert!(
        push_url.trim().starts_with(BLOCKED_PUSH_URL),
        "push url: {push_url}"
    );
}

#[test]
fn a_second_agent_in_the_same_folder_is_refused_until_the_first_exits() {
    let root = tempfile::tempdir().unwrap();
    let result = root.path().join("results");
    std::fs::create_dir_all(&result).unwrap();
    let ctx = launch(&result, None, None);

    // A long-lived command keeps the folder busy.
    #[cfg(windows)]
    let slow = "ping -n 4 127.0.0.1 > NUL";
    #[cfg(not(windows))]
    let slow = "sleep 3";

    run_agent(&ctx, AgentKind::Claude, Some(slow), NoteTarget::WorkItem, 1).unwrap();
    let second = run_agent(&ctx, AgentKind::Claude, Some(slow), NoteTarget::WorkItem, 2);
    assert!(
        matches!(second, Err(AppError::InvalidInput(message)) if message.contains("already running"))
    );

    // Another folder is independent.
    let other = root.path().join("other");
    std::fs::create_dir_all(&other).unwrap();
    run_agent(
        &launch(&other, None, None),
        AgentKind::Claude,
        Some(slow),
        NoteTarget::WorkItem,
        3,
    )
    .unwrap();
}
