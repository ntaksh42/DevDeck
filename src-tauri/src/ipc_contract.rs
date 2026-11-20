use std::path::Path;

use serde_json::{json, Value};

use crate::auto_agent::work::AgentWorkEntry;
use crate::db::AppDatabase;
use crate::home_bot::{
    HomeBotSettings, HomeBotView, HomeChatMessage, HomeChatView, HomeLookState, HomeSuggestion,
    HomeWorker,
};
use crate::pipelines::PipelineRunSummary;
use crate::prs::{MyCreatedPullRequestSummary, MyCreatedPullRequestsResult};
use crate::work_items::{WorkItemCustomField, WorkItemSummary};

const ORG: &str = "fixture-org";
const PROJECT: &str = "fixture-project";
const PROJECT_NAME: &str = "Platform";
const TIMESTAMP: &str = "2026-10-01T12:00:00Z";

#[test]
fn ipc_response_contract() {
    let directory = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(directory.path().join("test.sqlite3"));
    db.initialize().unwrap();
    let settings = db.get_app_settings().unwrap();

    let pull_requests = MyCreatedPullRequestsResult {
        pull_requests: vec![MyCreatedPullRequestSummary {
            organization_id: ORG.into(),
            project_id: PROJECT.into(),
            project_name: PROJECT_NAME.into(),
            repository_id: "fixture-repo".into(),
            repository_name: "Service".into(),
            pull_request_id: 101,
            title: "Add a release check".into(),
            creation_date: TIMESTAMP.into(),
            source_ref_name: "feature".into(),
            target_ref_name: "main".into(),
            web_url: None,
            is_draft: false,
            approvals: 1,
            reviewer_count: 2,
            ready_to_merge: false,
        }],
        warnings: Vec::new(),
    };

    let work_item = WorkItemSummary {
        organization_id: ORG.into(),
        project_id: PROJECT.into(),
        project_name: PROJECT_NAME.into(),
        id: 121,
        title: "Update the release process".into(),
        work_item_type: Some("Task".into()),
        state: Some("Active".into()),
        assigned_to: None,
        changed_date: Some(TIMESTAMP.into()),
        web_url: None,
        tags: Some("release; docs".into()),
        extra_fields: vec![WorkItemCustomField {
            reference_name: "Custom.Risk".into(),
            value: Some("Low".into()),
        }],
        depth: Some(1),
        has_active_pull_request: true,
        has_draft_pull_request: false,
    };

    let pipeline = PipelineRunSummary {
        organization_id: ORG.into(),
        project_id: PROJECT.into(),
        project_name: PROJECT_NAME.into(),
        build_id: 42,
        build_number: Some("20261001.1".into()),
        definition_id: Some(4),
        definition_name: Some("CI".into()),
        status: Some("completed".into()),
        result: Some("failed".into()),
        source_branch: Some("refs/heads/main".into()),
        reason: None,
        requested_for: None,
        queue_time: None,
        start_time: Some(TIMESTAMP.into()),
        finish_time: Some(TIMESTAMP.into()),
        web_url: "https://dev.azure.com/fixture-org/Platform/_build/results?buildId=42".into(),
    };

    let agent_work = AgentWorkEntry {
        organization_id: ORG.into(),
        organization_name: "Fixture organization".into(),
        target: "pipeline",
        id: pipeline.build_id,
        scope_id: PROJECT.into(),
        title: "CI investigation".into(),
        scope: PROJECT_NAME.into(),
        project_id: Some(PROJECT.into()),
        web_url: Some(pipeline.web_url.clone()),
        status: "failed",
        excluded: false,
        started_at: Some(TIMESTAMP.parse().unwrap()),
        finished_at: Some(TIMESTAMP.parse().unwrap()),
        failures: 1,
        next_retry_at: None,
        error: Some("Agent did not finish the investigation note.".into()),
        exit_code: None,
        has_log: true,
        ask_id: Some(1_790_856_000_000),
    };

    let at = || TIMESTAMP.parse().unwrap();
    let home_bot = HomeBotView {
        settings: HomeBotSettings::default(),
        look: HomeLookState {
            running: false,
            last_looked_at: Some(at()),
            took_ms: Some(48_000),
            next_at: Some(at()),
            error: None,
            failures_in_a_row: 0,
        },
        brief: vec!["Two reviews wait on you.".into()],
        suggestions: vec![HomeSuggestion {
            id: "s-1".into(),
            title: "Review !101".into(),
            why: "Requested three days ago.".into(),
            ask: "Summarize the diff of !101.".into(),
            target: Some(format!("pr:{ORG}/fixture-repo/101")),
            target_label: Some("!101".into()),
            web_url: None,
            kind: "pr".into(),
            is_new: true,
            created_at: at(),
        }],
        new_count: 1,
    };
    let home_chat = HomeChatView {
        chat_id: "chat-20261001120000000".into(),
        messages: vec![HomeChatMessage {
            id: 1,
            author: "orchestrator".into(),
            body: "Started a worker on !101.".into(),
            worker_ids: vec!["d-1".into()],
            created_at: at(),
        }],
        workers: vec![HomeWorker {
            id: "d-1".into(),
            target_label: "!101".into(),
            title: "Summarize the diff".into(),
            agent: "codex".into(),
            model: None,
            status: "running".into(),
            ask_id: 1_790_856_000_000,
            note_target: "ask".into(),
            subject: None,
            created_at: at(),
            started_at: Some(at()),
            ended_at: None,
        }],
        state: "waiting".into(),
        waiting_on: 1,
        error: None,
    };

    let actual = json!({
        "get_app_settings": settings,
        "list_my_created_pull_requests": pull_requests,
        "run_work_item_query": [work_item],
        "list_pipeline_runs": [pipeline],
        "list_agent_work": [agent_work],
        "get_home_bot": home_bot,
        "get_home_chat": home_chat,
    });
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ipc-responses.json");
    // Use this only after reviewing an intentional IPC response change.
    if std::env::var("DEVDECK_UPDATE_IPC_FIXTURE").as_deref() == Ok("1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let formatted = serde_json::to_string_pretty(&actual).unwrap();
        std::fs::write(&path, formatted + "\n").unwrap();
    }
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        actual, expected,
        "IPC response changed. Review the frontend schema, then regenerate with DEVDECK_UPDATE_IPC_FIXTURE=1."
    );
}
