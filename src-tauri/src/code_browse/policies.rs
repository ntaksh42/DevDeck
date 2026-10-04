//! Files > Branches > Policies: a read-only view of the branch policies that
//! apply to one branch (issue #536). Editing policies stays in Azure DevOps.

use azdo_client::PolicyConfiguration;
use serde::{Deserialize, Serialize};

use super::CodeBrowseService;
use crate::auth::client_for_organization;
use crate::error::Result;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBranchPoliciesInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    /// Short branch name, e.g. `main`.
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPolicyItem {
    pub id: i64,
    pub name: String,
    pub is_enabled: bool,
    /// A blocking policy must pass to complete a pull request; otherwise it is
    /// only advisory ("optional").
    pub is_blocking: bool,
    /// A short, type-specific summary of the settings (e.g. "2 approvers").
    pub detail: Option<String>,
}

impl CodeBrowseService {
    pub async fn list_branch_policies(
        &self,
        input: ListBranchPoliciesInput,
    ) -> Result<Vec<BranchPolicyItem>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let policies = client
            .list_branch_policies(
                &input.project,
                &input.repository,
                &format!("refs/heads/{}", input.branch.trim()),
            )
            .await?;
        Ok(build_policy_items(policies))
    }
}

fn build_policy_items(policies: Vec<PolicyConfiguration>) -> Vec<BranchPolicyItem> {
    let mut items: Vec<BranchPolicyItem> = policies
        .into_iter()
        .filter(|policy| !policy.is_deleted)
        .map(|policy| BranchPolicyItem {
            id: policy.id,
            detail: policy_detail(&policy.settings),
            name: policy
                .policy_type
                .display_name
                .unwrap_or_else(|| policy.policy_type.id.clone()),
            is_enabled: policy.is_enabled,
            is_blocking: policy.is_blocking,
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    items
}

/// Summarizes the settings every policy type shares in a way worth reading:
/// approver counts, a named build/status check, and required-reviewer count.
fn policy_detail(settings: &serde_json::Value) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(count) = settings
        .get("minimumApproverCount")
        .and_then(|value| value.as_i64())
    {
        parts.push(format!(
            "{count} approver{}",
            if count == 1 { "" } else { "s" }
        ));
    }
    if let Some(name) = settings
        .get("displayName")
        .and_then(|value| value.as_str())
        .filter(|name| !name.is_empty())
    {
        parts.push(name.to_string());
    }
    if let Some(count) = settings
        .get("requiredReviewerIds")
        .and_then(|value| value.as_array())
        .map(Vec::len)
        .filter(|count| *count > 0)
    {
        parts.push(format!(
            "{count} required reviewer{}",
            if count == 1 { "" } else { "s" }
        ));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(json: serde_json::Value) -> PolicyConfiguration {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn deleted_policies_are_dropped_and_the_rest_sorted_by_name() {
        let items = build_policy_items(vec![
            policy(serde_json::json!({
                "id": 2, "isEnabled": true, "isBlocking": false,
                "type": { "id": "b", "displayName": "Work item linking" }
            })),
            policy(serde_json::json!({
                "id": 3, "isDeleted": true, "isEnabled": true, "isBlocking": true,
                "type": { "id": "c", "displayName": "Gone" }
            })),
            policy(serde_json::json!({
                "id": 1, "isEnabled": true, "isBlocking": true,
                "type": { "id": "a", "displayName": "Minimum number of reviewers" },
                "settings": { "minimumApproverCount": 2 }
            })),
        ]);

        assert_eq!(
            items
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["Minimum number of reviewers", "Work item linking"]
        );
        assert!(items[0].is_blocking);
        assert_eq!(items[0].detail.as_deref(), Some("2 approvers"));
        assert_eq!(items[1].detail, None);
    }

    #[test]
    fn detail_combines_approvers_check_name_and_required_reviewers() {
        let settings = serde_json::json!({
            "minimumApproverCount": 1,
            "displayName": "CI build",
            "requiredReviewerIds": ["u1", "u2"]
        });
        assert_eq!(
            policy_detail(&settings).as_deref(),
            Some("1 approver · CI build · 2 required reviewers")
        );
        assert_eq!(policy_detail(&serde_json::Value::Null), None);
    }

    #[test]
    fn a_type_without_a_display_name_falls_back_to_its_id() {
        let items = build_policy_items(vec![policy(serde_json::json!({
            "id": 5, "isEnabled": false, "isBlocking": false, "type": { "id": "type-guid" }
        }))]);
        assert_eq!(items[0].name, "type-guid");
        assert!(!items[0].is_enabled);
    }
}
