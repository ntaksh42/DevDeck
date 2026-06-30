use azdo_client::{
    Approval, Build, BuildDefinitionDetail, DefinitionTrigger, DefinitionVariable, TestCaseResult,
    TestRun, Timeline,
};

use crate::commits::encode_path_segment;
use crate::db::Organization;
use crate::error::{AppError, Result};

use super::types::*;

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
            identifier: record.identifier,
            node_type: record.record_type,
            name: record.name,
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

/// A run has failures when not every counted test passed (excluding the
/// not-applicable/not-executed buckets that are not real failures).
pub(super) fn run_has_failures(run: &TestRun) -> bool {
    run.unanalyzed_tests > 0
        || run.total_tests > run.passed_tests + run.not_applicable_tests + run.incomplete_tests
}

pub(super) fn failed_test_from(run: &TestRun, result: TestCaseResult) -> FailedTest {
    let title = result
        .test_case_title
        .or(result.automated_test_name)
        .unwrap_or_else(|| "(unnamed test)".to_string());
    FailedTest {
        run_name: run.name.clone(),
        title,
        error_message: result.error_message,
        duration_ms: result.duration_in_ms,
    }
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

    fn test_run(total: i64, passed: i64, unanalyzed: i64) -> TestRun {
        TestRun {
            id: 9,
            name: Some("VSTest".to_string()),
            state: Some("Completed".to_string()),
            total_tests: total,
            passed_tests: passed,
            unanalyzed_tests: unanalyzed,
            not_applicable_tests: 0,
            incomplete_tests: 0,
        }
    }

    #[test]
    fn run_has_failures_true_when_unanalyzed_present() {
        assert!(run_has_failures(&test_run(10, 8, 2)));
    }

    #[test]
    fn run_has_failures_false_when_all_passed() {
        assert!(!run_has_failures(&test_run(10, 10, 0)));
    }

    #[test]
    fn failed_test_from_prefers_test_case_title() {
        let failed = failed_test_from(
            &test_run(10, 8, 2),
            TestCaseResult {
                test_case_title: Some("PaymentFlowTests.Refund".to_string()),
                automated_test_name: Some("Ns.PaymentFlowTests.Refund".to_string()),
                outcome: Some("Failed".to_string()),
                error_message: Some("Assert.Fail".to_string()),
                duration_in_ms: 412.0,
            },
        );
        assert_eq!(failed.title, "PaymentFlowTests.Refund");
        assert_eq!(failed.run_name.as_deref(), Some("VSTest"));
        assert_eq!(failed.duration_ms, 412.0);
    }

    #[test]
    fn failed_test_from_falls_back_to_automated_test_name() {
        let failed = failed_test_from(
            &test_run(10, 8, 2),
            TestCaseResult {
                test_case_title: None,
                automated_test_name: Some("Ns.PaymentFlowTests.Refund".to_string()),
                outcome: Some("Failed".to_string()),
                error_message: None,
                duration_in_ms: 1.0,
            },
        );
        assert_eq!(failed.title, "Ns.PaymentFlowTests.Refund");
    }
}
