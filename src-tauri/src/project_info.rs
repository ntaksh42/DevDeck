//! Read-only project information for Settings: teams with their members,
//! service connections, and the service hook subscriptions of one project
//! (issue #541). Nothing here edits project configuration.

use azdo_client::{ProjectTeam, ServiceHookSubscription, TeamMember};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::AppDatabase;
use crate::error::Result;
use crate::secrets::SecretStore;

/// Teams whose members are fetched; a project with more teams is truncated
/// (each team costs one request).
const MAX_TEAMS: usize = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfoInput {
    pub organization_id: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberInfo {
    pub display_name: String,
    pub unique_name: Option<String>,
    pub is_team_admin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTeamInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub members: Vec<TeamMemberInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTeams {
    pub teams: Vec<ProjectTeamInfo>,
    /// True when the project has more teams than `MAX_TEAMS`.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConnectionInfo {
    pub id: String,
    pub name: String,
    pub endpoint_type: Option<String>,
    pub description: Option<String>,
    pub is_ready: bool,
    pub is_shared: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHookInfo {
    pub id: String,
    pub status: Option<String>,
    pub publisher: Option<String>,
    pub event_type: Option<String>,
    pub consumer: Option<String>,
    pub consumer_action: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProjectInfoService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl ProjectInfoService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn list_teams(&self, input: ProjectInfoInput) -> Result<ProjectTeams> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let all_teams = client.list_project_teams(&input.project_id).await?;
        let truncated = all_teams.len() > MAX_TEAMS;
        let mut teams = Vec::new();
        for team in all_teams.into_iter().take(MAX_TEAMS) {
            let members = client
                .list_team_members(&input.project_id, &team.id)
                .await?;
            teams.push(build_team(team, members));
        }
        teams.sort_by_key(|team| team.name.to_lowercase());
        Ok(ProjectTeams { teams, truncated })
    }

    pub async fn list_service_connections(
        &self,
        input: ProjectInfoInput,
    ) -> Result<Vec<ServiceConnectionInfo>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut connections: Vec<ServiceConnectionInfo> = client
            .list_service_endpoints(&input.project_id)
            .await?
            .into_iter()
            .map(|endpoint| ServiceConnectionInfo {
                id: endpoint.id,
                name: endpoint.name,
                endpoint_type: endpoint.endpoint_type,
                description: endpoint.description.filter(|text| !text.trim().is_empty()),
                is_ready: endpoint.is_ready,
                is_shared: endpoint.is_shared,
            })
            .collect();
        connections.sort_by_key(|connection| connection.name.to_lowercase());
        Ok(connections)
    }

    pub async fn list_service_hooks(
        &self,
        input: ProjectInfoInput,
    ) -> Result<Vec<ServiceHookInfo>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let subscriptions = client.list_service_hook_subscriptions().await?;
        Ok(project_hooks(subscriptions, &input.project_id))
    }
}

fn build_team(team: ProjectTeam, members: Vec<TeamMember>) -> ProjectTeamInfo {
    let mut members: Vec<TeamMemberInfo> = members
        .into_iter()
        .map(|member| {
            let unique_name = member.identity.unique_name.filter(|name| !name.is_empty());
            TeamMemberInfo {
                display_name: member
                    .identity
                    .display_name
                    .filter(|name| !name.is_empty())
                    .or_else(|| unique_name.clone())
                    .unwrap_or_else(|| "(unknown)".to_string()),
                unique_name,
                is_team_admin: member.is_team_admin,
            }
        })
        .collect();
    // Admins first, then by name.
    members.sort_by(|a, b| {
        b.is_team_admin.cmp(&a.is_team_admin).then_with(|| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        })
    });
    ProjectTeamInfo {
        id: team.id,
        name: team.name,
        description: team.description.filter(|text| !text.trim().is_empty()),
        members,
    }
}

/// Keeps the subscriptions that fire for `project_id`: those filtered to it,
/// plus organization-wide ones with no project filter. Webhook URLs and other
/// consumer inputs are never read, so nothing secret leaves this function.
fn project_hooks(
    subscriptions: Vec<ServiceHookSubscription>,
    project_id: &str,
) -> Vec<ServiceHookInfo> {
    let mut hooks: Vec<ServiceHookInfo> = subscriptions
        .into_iter()
        .filter(|subscription| {
            match subscription
                .publisher_inputs
                .get("projectId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
            {
                Some(scoped) => scoped.eq_ignore_ascii_case(project_id),
                None => true,
            }
        })
        .map(|subscription| ServiceHookInfo {
            id: subscription.id,
            status: subscription.status,
            publisher: subscription.publisher_id,
            event_type: subscription.event_type,
            consumer: subscription.consumer_id,
            consumer_action: subscription.consumer_action_id,
        })
        .collect();
    hooks.sort_by(|a, b| {
        a.event_type
            .cmp(&b.event_type)
            .then_with(|| a.consumer.cmp(&b.consumer))
            .then_with(|| a.id.cmp(&b.id))
    });
    hooks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook(json: serde_json::Value) -> ServiceHookSubscription {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn hooks_are_narrowed_to_the_project_and_never_expose_consumer_inputs() {
        let hooks = project_hooks(
            vec![
                hook(serde_json::json!({
                    "id": "b", "eventType": "git.push", "consumerId": "slack",
                    "publisherInputs": { "projectId": "P-1" },
                    "consumerInputs": { "url": "https://hooks.example/secret" }
                })),
                hook(serde_json::json!({
                    "id": "a", "eventType": "build.complete", "consumerId": "webHooks",
                    "publisherInputs": { "projectId": "other" }
                })),
                hook(serde_json::json!({
                    "id": "c", "eventType": "git.pullrequest.created", "consumerId": "teams",
                    "publisherInputs": {}
                })),
            ],
            "p-1",
        );

        assert_eq!(
            hooks
                .iter()
                .map(|hook| hook.id.as_str())
                .collect::<Vec<_>>(),
            ["c", "b"]
        );
        // Sorted by event type, so the pull request hook precedes the push hook.
        assert!(!format!("{hooks:?}").contains("secret"));
    }

    #[test]
    fn team_members_list_admins_first_and_fall_back_to_the_unique_name() {
        let team: ProjectTeam = serde_json::from_value(serde_json::json!({
            "id": "t", "name": "Core", "description": "  "
        }))
        .unwrap();
        let members: Vec<TeamMember> = serde_json::from_value(serde_json::json!([
            { "identity": { "displayName": "Zed" } },
            { "identity": { "uniqueName": "amy@contoso.com" } },
            { "identity": { "displayName": "Bob" }, "isTeamAdmin": true }
        ]))
        .unwrap();

        let info = build_team(team, members);

        assert_eq!(info.description, None);
        assert_eq!(
            info.members
                .iter()
                .map(|member| member.display_name.as_str())
                .collect::<Vec<_>>(),
            ["Bob", "amy@contoso.com", "Zed"]
        );
        assert!(info.members[0].is_team_admin);
    }
}
