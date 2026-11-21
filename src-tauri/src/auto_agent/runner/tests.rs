use super::*;
use crate::db::CachedReviewPr;

fn item() -> AutoItem {
    AutoItem::PullRequest(CachedReviewPr {
        org_id: "o".into(),
        project_id: "p".into(),
        project_name: "P".into(),
        repository_id: "r".into(),
        repository_name: "repo".into(),
        pull_request_id: 7,
        title: "PR".into(),
        created_by: None,
        creation_date: String::new(),
        target_ref_name: "refs/heads/main".into(),
        web_url: None,
        my_vote: 0,
        my_vote_label: "No vote".into(),
        my_is_required: false,
        is_draft: false,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    })
}

fn setup(root: &Path, command: String) -> (AppDatabase, PathBuf) {
    let folder = root.join("results");
    std::fs::create_dir_all(&folder).unwrap();
    let db = AppDatabase::new(root.join("db.sqlite3"));
    db.initialize().unwrap();
    let settings = AppSettings {
        review_result_folder_path: Some(folder.display().to_string()),
        agent_command: Some(command),
        ..AppSettings::default()
    };
    db.update_app_settings(settings).unwrap();
    (db, folder)
}

fn material(folder: &Path, base: Option<&str>, head: &str, complete: bool) -> Material {
    Material {
        document: format!(
            "Base commit: {}\nHead commit: {head}\nnew changes",
            base.unwrap_or("initial")
        ),
        label: "!7 PR".into(),
        repository: None,
        folder: folder.into(),
        base: base.map(str::to_string),
        head: Some(head.into()),
        complete,
        has_content: true,
        agent: None,
        focus: None,
    }
}

#[tokio::test]
async fn failed_process_keeps_baseline_and_records_error_and_log() {
    let root = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let command = "echo model-error & exit /b 7";
    #[cfg(not(windows))]
    let command = "echo model-error; exit 7";
    let (db, folder) = setup(root.path(), command.into());
    let path = root.path().join("runs/pr-7.json");
    let mut history = History {
        reviewed_commit: Some("a".into()),
        ..History::default()
    };
    assert!(execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, Some("a"), "b", true),
        5
    )
    .await
    .is_err());
    let saved = History::read(&path).unwrap();
    assert_eq!(saved.reviewed_commit.as_deref(), Some("a"));
    assert_eq!(saved.runs[0].status, Status::Failed);
    assert_eq!(saved.runs[0].exit_code, Some(7));
    assert!(
        std::fs::read_to_string(saved.runs[0].log_path.as_ref().unwrap())
            .unwrap()
            .contains("model-error")
    );
    let notes = AgentNoteService::new(db)
        .list(ListAgentNotesInput {
            target: NoteTarget::PullRequest,
            item_id: 7,
        })
        .unwrap();
    assert!(notes[0].replies.last().unwrap().body.contains("retry"));
}

#[tokio::test]
async fn successful_exit_without_result_does_not_mark_commit_reviewed() {
    let root = tempfile::tempdir().unwrap();
    let (db, folder) = setup(root.path(), "echo done".into());
    let path = root.path().join("runs/pr-7.json");
    let mut history = History::default();
    assert!(execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, None, "b", true),
        5
    )
    .await
    .is_err());
    assert_eq!(history.reviewed_commit, None);
    assert!(history.runs[0]
        .error
        .as_ref()
        .unwrap()
        .contains("result HTML"));
}

#[tokio::test]
async fn requester_focus_points_reach_the_agent_note() {
    let root = tempfile::tempdir().unwrap();
    let (db, folder) = setup(root.path(), "echo done".into());
    let path = root.path().join("runs/pr-7.json");
    let mut history = History::default();
    let mut material = material(&folder, None, "b", true);
    material.focus = Some(
        "Is the retry safe?
Check the null case"
            .into(),
    );
    let _ = execute(&db, &item(), &path, &mut history, material, 5).await;
    let notes = AgentNoteService::new(db)
        .list(ListAgentNotesInput {
            target: NoteTarget::PullRequest,
            item_id: 7,
        })
        .unwrap();
    assert!(notes[0].body.contains(
        "  > Is the retry safe?
  > Check the null case"
    ));
}

#[tokio::test]
#[cfg(windows)]
async fn successful_result_advances_only_complete_snapshot_and_preserves_history() {
    let root = tempfile::tempdir().unwrap();
    // This is a fake local agent; no network or model is invoked.
    let script = root.path().join("fake.ps1");
    std::fs::write(
        &script,
        r#"param($notes,$results)
$note=Get-ChildItem -LiteralPath $notes -Filter '*.md' | Select-Object -First 1
New-Item -ItemType Directory -Force -Path (Join-Path $notes '_done') | Out-Null
Set-Content -LiteralPath (Join-Path $results 'PR7.html') -Value '<html>reviewed</html>'
Move-Item -LiteralPath $note.FullName -Destination (Join-Path $notes '_done')
"#,
    )
    .unwrap();
    let command = format!(
        "pwsh -NoProfile -File \"{}\" \"{{notes}}\" \"{{results}}\"",
        script.display()
    );
    let (db, folder) = setup(root.path(), command);
    let path = root.path().join("runs/pr-7.json");
    let mut history = History::default();
    execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, None, "a", true),
        20,
    )
    .await
    .unwrap();
    assert_eq!(history.reviewed_commit.as_deref(), Some("a"));
    execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, Some("a"), "b", false),
        20,
    )
    .await
    .unwrap();
    let saved = History::read(&path).unwrap();
    assert_eq!(saved.reviewed_commit.as_deref(), Some("a"));
    assert_eq!(saved.runs.len(), 2);
    assert_eq!(saved.runs[1].base_commit.as_deref(), Some("a"));
    assert_eq!(saved.runs[1].head_commit.as_deref(), Some("b"));
    assert_eq!(saved.runs[1].status, Status::Partial);
    assert!(!saved.needs_review("b"));
    assert!(saved.needs_review("c"));
}

#[tokio::test]
async fn unreadable_material_never_starts_model_or_advances_baseline() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("started.txt");
    let (db, folder) = setup(
        root.path(),
        format!("echo started > \"{}\"", marker.display()),
    );
    let path = root.path().join("runs/pr-7.json");
    let mut history = History::default();
    let mut data = material(&folder, None, "b", false);
    data.has_content = false;
    execute(&db, &item(), &path, &mut history, data, 5)
        .await
        .unwrap();
    assert!(!marker.exists());
    assert_eq!(history.reviewed_commit, None);
    assert_eq!(history.runs[0].status, Status::Partial);
}

#[test]
fn timeout_terminates_process_and_is_retryable_failure() {
    #[cfg(windows)]
    let command = "ping -n 5 127.0.0.1 > NUL";
    #[cfg(not(windows))]
    let command = "sleep 4";
    let child = crate::agent_notes::launch::shell_command(command)
        .spawn()
        .unwrap();
    let child = crate::agent_notes::launch::TrackedChild::new(child).unwrap();
    assert!(wait_child(child, 0)
        .unwrap_err()
        .to_string()
        .contains("timed out"));
}

#[tokio::test]
async fn human_reply_on_automatic_note_pauses_automation_without_archiving() {
    let root = tempfile::tempdir().unwrap();
    let (db, _) = setup(root.path(), "echo should-not-run".into());
    let service = AgentNoteService::new(db.clone());
    let item = item();
    let note = create_note(
        &service,
        &item,
        "DevDeck automatic review: investigate",
        None,
    )
    .unwrap();
    service
        .reply(crate::agent_notes::ReplyAgentNoteInput {
            target: item.target(),
            item_id: item.id(),
            note_id: note.id.clone(),
            body: "Please check this first".into(),
        })
        .unwrap();
    let settings = db.get_app_settings().unwrap();
    let org = Organization {
        id: "o".into(),
        name: "org".into(),
        display_name: None,
        base_url: "https://dev.azure.com/org".into(),
        auth_provider: "pat".into(),
        credential_key: "unused".into(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: String::new(),
        updated_at: String::new(),
        provider_kind: "azdo".into(),
    };
    assert!(!process_item(&db, &settings, &org, &item, None, None)
        .await
        .unwrap());
    let notes = service
        .list(ListAgentNotesInput {
            target: item.target(),
            item_id: item.id(),
        })
        .unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].status, "open");
    assert_eq!(notes[0].replies.last().unwrap().author, "user");
    assert!(!item.history_path(&db, &org).exists());
}

#[tokio::test]
#[cfg(windows)]
async fn pushes_after_restart_and_failure_keep_the_last_successful_range() {
    let root = tempfile::tempdir().unwrap();
    let script = root.path().join("agent.ps1");
    std::fs::write(
        &script,
        r#"param($notes,$results)
$note=Get-ChildItem -LiteralPath $notes -Filter '*.md' | Select-Object -First 1
$context=Get-Content -Raw -LiteralPath (Join-Path (Join-Path $notes '_context') $note.Name)
New-Item -ItemType Directory -Force -Path (Join-Path $notes '_done') | Out-Null
Set-Content -LiteralPath (Join-Path $results 'PR7.html') -Value "<html>$context</html>"
Move-Item -LiteralPath $note.FullName -Destination (Join-Path $notes '_done')
"#,
    )
    .unwrap();
    let command = format!(
        "pwsh -NoProfile -File \"{}\" \"{{notes}}\" \"{{results}}\"",
        script.display()
    );
    let (db, folder) = setup(root.path(), command.clone());
    let path = root.path().join("runs/pr-7.json");
    let mut history = History::default();
    execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, None, "a", true),
        20,
    )
    .await
    .unwrap();
    let mut history = History::read(&path).unwrap();
    execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, Some("a"), "b", true),
        20,
    )
    .await
    .unwrap();
    assert_eq!(history.reviewed_commit.as_deref(), Some("b"));
    let html = std::fs::read_to_string(folder.join("PR7.html")).unwrap();
    assert!(html.contains("Base commit: a\nHead commit: b"));
    assert!(!html.contains("initial"));
    assert!(!history.needs_review("b"));
    let mut settings = db.get_app_settings().unwrap();
    settings.agent_command = Some("exit /b 7".into());
    db.update_app_settings(settings.clone()).unwrap();
    assert!(execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, Some("b"), "c", true),
        5
    )
    .await
    .is_err());
    settings.agent_command = Some(command);
    db.update_app_settings(settings).unwrap();
    let mut history = History::read(&path).unwrap();
    assert_eq!(history.reviewed_commit.as_deref(), Some("b"));
    execute(
        &db,
        &item(),
        &path,
        &mut history,
        material(&folder, Some("b"), "d", true),
        20,
    )
    .await
    .unwrap();
    assert_eq!(history.reviewed_commit.as_deref(), Some("d"));
    assert_eq!(history.runs[3].base_commit.as_deref(), Some("b"));
    assert_eq!(history.runs[3].head_commit.as_deref(), Some("d"));
    let html = std::fs::read_to_string(folder.join("PR7.html")).unwrap();
    assert!(html.contains("Base commit: b\nHead commit: d"));
}
