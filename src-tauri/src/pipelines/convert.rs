use azdo_client::{
    Approval, Build, BuildDefinitionDetail, BuildDefinitionRepository, DefinitionTrigger,
    DefinitionVariable, TestCaseResult, TestRun, Timeline,
};

use crate::commits::encode_path_segment;
use crate::db::Organization;
use crate::error::{AppError, Result};

use super::types::*;

/// Longest error message kept per failed test; stack traces can be huge.
const MAX_ERROR_MESSAGE_CHARS: usize = 2000;

/// Totals over `runs` plus the failed tests, where `failed_by_run[i]` holds the
/// failed results fetched for `runs[i]` (possibly fewer than that run's failed
/// count, because fetching stops at a cap).
pub(super) fn summarize_test_results(
    runs: &[TestRun],
    failed_by_run: Vec<Vec<TestCaseResult>>,
) -> PipelineTestResults {
    let total: i64 = runs.iter().map(|run| run.total_tests).sum();
    let passed: i64 = runs.iter().map(|run| run.passed_tests).sum();
    let failed: i64 = runs.iter().map(TestRun::failed_tests).sum();
    let mut failed_tests = Vec::new();
    for (run, results) in runs.iter().zip(failed_by_run) {
        for result in results {
            let name = result
                .test_case_title
                .filter(|title| !title.trim().is_empty())
                .or(result.automated_test_name)
                .unwrap_or_else(|| "(unnamed test)".to_string());
            failed_tests.push(PipelineFailedTest {
                name,
                run_name: run.name.clone(),
                error_message: result
                    .error_message
                    .filter(|message| !message.trim().is_empty())
                    .map(|message| message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect()),
                duration_ms: result.duration_in_ms.map(|ms| ms.round() as i64),
            });
        }
    }
    PipelineTestResults {
        total,
        passed,
        failed,
        other: (total - passed - failed).max(0),
        truncated: (failed_tests.len() as i64) < failed,
        failed_tests,
    }
}

/// Stage identifiers are plain names; anything else could alter the request path.
pub(super) fn is_valid_stage_identifier(stage: &str) -> bool {
    !stage.is_empty()
        && stage
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

pub(super) fn approval_to_summary(approval: Approval) -> PipelineApprovalSummary {
    let assigned_approvers = approval
        .steps
        .iter()
        .filter_map(|step| step.assigned_approver.as_ref())
        .filter_map(|approver| {
            approver
                .display_name
                .clone()
                .or_else(|| approver.unique_name.clone())
        })
        .collect();
    PipelineApprovalSummary {
        id: approval.id,
        status: approval.status.unwrap_or_default(),
        instructions: approval.instructions,
        min_required_approvers: approval.min_required_approvers,
        execution_order: approval.execution_order,
        created_on: approval.created_on.map(|date| date.to_rfc3339()),
        assigned_approvers,
    }
}

/// Resolves the `requestedFor` filter for a run listing.
///
/// When `requested_for_me` is set the caller wants to see only their own runs,
/// so an absent authenticated user id is an error: silently dropping the filter
/// would return every user's runs instead of none.
pub(super) fn resolve_requested_for(
    requested_for_me: bool,
    authenticated_user_id: Option<&str>,
) -> Result<Option<String>> {
    if !requested_for_me {
        return Ok(None);
    }
    authenticated_user_id
        .map(|id| Some(id.to_string()))
        .ok_or_else(|| {
            AppError::InvalidInput(
                "organization has no authenticated user id; re-add the organization".to_string(),
            )
        })
}

pub(super) fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_web_url(organization: &Organization, project_name: &str, build_id: i64) -> String {
    format!(
        "{}/{}/_build/results?buildId={}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        build_id
    )
}

pub(super) fn build_to_summary(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    build: Build,
) -> PipelineRunSummary {
    let web_url = build_web_url(organization, project_name, build.id);
    let (definition_id, definition_name) = match build.definition {
        Some(def) => (Some(def.id), Some(def.name)),
        None => (None, None),
    };
    PipelineRunSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        build_id: build.id,
        build_number: build.build_number,
        definition_id,
        definition_name,
        status: build.status,
        result: build.result,
        source_branch: build.source_branch,
        reason: build.reason,
        requested_for: build.requested_for.and_then(|r| r.display_name),
        queue_time: build.queue_time.map(|t| t.to_rfc3339()),
        start_time: build.start_time.map(|t| t.to_rfc3339()),
        finish_time: build.finish_time.map(|t| t.to_rfc3339()),
        web_url,
    }
}

pub(super) fn definition_to_detail(definition: BuildDefinitionDetail) -> PipelineDefinitionDetail {
    PipelineDefinitionDetail {
        definition_id: definition.id,
        name: definition.name,
        triggers: definition
            .triggers
            .into_iter()
            .map(trigger_to_ipc)
            .collect(),
        variables: definition
            .variables
            .into_iter()
            .map(variable_to_ipc)
            .collect(),
        repository: definition.repository.map(repository_to_ipc),
    }
}

fn repository_to_ipc(repository: BuildDefinitionRepository) -> PipelineDefinitionRepository {
    PipelineDefinitionRepository {
        id: repository.id,
        name: repository.name,
        repository_type: repository.repository_type,
    }
}

fn trigger_to_ipc(trigger: DefinitionTrigger) -> PipelineTrigger {
    PipelineTrigger {
        trigger_type: trigger.trigger_type,
        branch_filters: trigger.branch_filters,
        path_filters: trigger.path_filters,
    }
}

fn variable_to_ipc(variable: DefinitionVariable) -> PipelineVariable {
    PipelineVariable {
        name: variable.name,
        value: variable.value,
        is_secret: variable.is_secret,
        allow_override: variable.allow_override,
    }
}

pub(super) fn timeline_to_nodes(timeline: Timeline) -> Vec<TimelineNode> {
    timeline
        .records
        .into_iter()
        .map(|record| TimelineNode {
            id: record.id,
            parent_id: record.parent_id,
            node_type: record.record_type,
            name: record.name,
            identifier: record.identifier,
            state: record.state,
            result: record.result,
            start_time: record.start_time.map(|t| t.to_rfc3339()),
            finish_time: record.finish_time.map(|t| t.to_rfc3339()),
            log_id: record.log.map(|l| l.id),
            error_count: record.error_count,
            warning_count: record.warning_count,
            order: record.order,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Organization {
        Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso/".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            created_at: "2026-06-13T00:00:00Z".to_string(),
            updated_at: "2026-06-13T00:00:00Z".to_string(),
            provider_kind: "azdo".to_string(),
        }
    }

    #[test]
    fn build_web_url_encodes_project_and_trims_slash() {
        assert_eq!(
            build_web_url(&org(), "Platform Team", 101),
            "https://dev.azure.com/contoso/Platform%20Team/_build/results?buildId=101"
        );
    }

    #[test]
    fn normalize_optional_drops_blank() {
        assert_eq!(normalize_optional(Some("  ".to_string())), None);
        assert_eq!(
            normalize_optional(Some(" failed ".to_string())),
            Some("failed".to_string())
        );
    }

    #[test]
    fn definition_to_detail_maps_triggers_and_variables() {
        let detail = definition_to_detail(BuildDefinitionDetail {
            id: 12,
            name: "CI".to_string(),
            triggers: vec![DefinitionTrigger {
                trigger_type: Some("continuousIntegration".to_string()),
                branch_filters: vec!["+refs/heads/main".to_string()],
                path_filters: vec![],
            }],
            variables: vec![
                DefinitionVariable {
                    name: "Alpha".to_string(),
                    value: Some("first".to_string()),
                    is_secret: false,
                    allow_override: true,
                },
                DefinitionVariable {
                    name: "ApiKey".to_string(),
                    value: None,
                    is_secret: true,
                    allow_override: false,
                },
            ],
            repository: Some(BuildDefinitionRepository {
                id: "repo-1".to_string(),
                name: "MyRepo".to_string(),
                repository_type: "TfsGit".to_string(),
            }),
        });

        assert_eq!(detail.definition_id, 12);
        assert_eq!(detail.triggers.len(), 1);
        assert_eq!(
            detail.triggers[0].trigger_type.as_deref(),
            Some("continuousIntegration")
        );
        // Secret variables carry no value through the mapping.
        let secret = detail
            .variables
            .iter()
            .find(|v| v.name == "ApiKey")
            .unwrap();
        assert!(secret.is_secret);
        assert_eq!(secret.value, None);
        let repository = detail.repository.as_ref().unwrap();
        assert_eq!(repository.id, "repo-1");
        assert_eq!(repository.repository_type, "TfsGit");
    }

    fn test_run(json: serde_json::Value) -> TestRun {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn test_results_sum_runs_and_flag_a_capped_failed_list() {
        let runs = vec![
            test_run(serde_json::json!({
                "id": 1, "name": "Unit", "totalTests": 10, "passedTests": 6,
                "runStatistics": [{ "outcome": "Failed", "count": 3 }]
            })),
            test_run(serde_json::json!({
                "id": 2, "name": "Api", "totalTests": 4, "passedTests": 4
            })),
        ];
        let results = vec![
            vec![serde_json::from_value(serde_json::json!({
                "testCaseTitle": " ", "automatedTestName": "Calc.adds",
                "errorMessage": "boom", "durationInMs": 12.6
            }))
            .unwrap()],
            vec![],
        ];

        let summary = summarize_test_results(&runs, results);

        assert_eq!(
            (summary.total, summary.passed, summary.failed, summary.other),
            (14, 10, 3, 1)
        );
        assert_eq!(summary.failed_tests.len(), 1);
        assert_eq!(summary.failed_tests[0].name, "Calc.adds");
        assert_eq!(summary.failed_tests[0].run_name.as_deref(), Some("Unit"));
        assert_eq!(summary.failed_tests[0].duration_ms, Some(13));
        assert!(summary.truncated);
    }

    #[test]
    fn long_error_messages_are_cut() {
        let runs = vec![test_run(serde_json::json!({
            "id": 1, "totalTests": 1, "passedTests": 0,
            "runStatistics": [{ "outcome": "Failed", "count": 1 }]
        }))];
        let long = "x".repeat(MAX_ERROR_MESSAGE_CHARS + 50);
        let results = vec![vec![serde_json::from_value(serde_json::json!({
            "testCaseTitle": "t", "errorMessage": long
        }))
        .unwrap()]];

        let summary = summarize_test_results(&runs, results);

        assert_eq!(
            summary.failed_tests[0]
                .error_message
                .as_ref()
                .unwrap()
                .len(),
            MAX_ERROR_MESSAGE_CHARS
        );
        assert!(!summary.truncated);
    }

    #[test]
    fn stage_identifiers_reject_path_altering_characters() {
        assert!(is_valid_stage_identifier("Deploy_Prod-2.0"));
        assert!(!is_valid_stage_identifier(""));
        assert!(!is_valid_stage_identifier("a/b"));
        assert!(!is_valid_stage_identifier("a?x=1"));
        assert!(!is_valid_stage_identifier("../x"));
    }

    #[test]
    fn resolve_requested_for_without_flag_is_none() {
        assert_eq!(resolve_requested_for(false, None).unwrap(), None);
        assert_eq!(resolve_requested_for(false, Some("user-1")).unwrap(), None);
    }

    #[test]
    fn resolve_requested_for_uses_authenticated_user_id() {
        assert_eq!(
            resolve_requested_for(true, Some("user-1")).unwrap(),
            Some("user-1".to_string())
        );
    }

    #[test]
    fn resolve_requested_for_errors_when_user_id_missing() {
        let err = resolve_requested_for(true, None).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }
}
