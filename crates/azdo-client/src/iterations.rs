//! Team iteration (sprint) REST surface.
//!
//! Used to render the current sprint's date window and item counts. All three
//! endpoints are read-only and project/team scoped.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

/// A team reference, as returned in a project's `defaultTeam` field.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWithDefaultTeam {
    default_team: Option<TeamRef>,
}

/// A team iteration (sprint) with its scheduling window.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamIteration {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub attributes: TeamIterationAttributes,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamIterationAttributes {
    pub start_date: Option<DateTime<Utc>>,
    pub finish_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IterationWorkItemsResponse {
    #[serde(default)]
    work_item_relations: Vec<IterationWorkItemRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IterationWorkItemRelation {
    target: Option<IterationWorkItemTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IterationWorkItemTarget {
    id: i64,
}

impl AdoClient {
    /// Returns the project's default team, if one is configured.
    pub async fn get_project_default_team(&self, project_id: &str) -> Result<Option<TeamRef>> {
        let path = format!("_apis/projects/{project_id}");
        let project: ProjectWithDefaultTeam = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(project.default_team)
    }

    /// Returns the team's current iteration, if any is in progress.
    pub async fn get_current_iteration(
        &self,
        project_id: &str,
        team_id: &str,
    ) -> Result<Option<TeamIteration>> {
        let path = format!("{project_id}/{team_id}/_apis/work/teamsettings/iterations");
        let response: ListResponse<TeamIteration> = self
            .get_json(
                &path,
                &[("api-version", "7.1-preview"), ("$timeframe", "current")],
            )
            .await?;
        Ok(response.value.into_iter().next())
    }

    /// Returns the work item ids assigned to an iteration for a team.
    pub async fn list_iteration_work_item_ids(
        &self,
        project_id: &str,
        team_id: &str,
        iteration_id: &str,
    ) -> Result<Vec<i64>> {
        let path = format!(
            "{project_id}/{team_id}/_apis/work/teamsettings/iterations/{iteration_id}/workitems"
        );
        let response: IterationWorkItemsResponse = self
            .get_json(&path, &[("api-version", "7.1-preview")])
            .await?;
        Ok(response
            .work_item_relations
            .into_iter()
            .filter_map(|relation| relation.target.map(|target| target.id))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn get_project_default_team_extracts_team() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/_apis/projects/project-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "project-1",
                "name": "Platform",
                "defaultTeam": { "id": "team-1", "name": "Platform Team" }
            })))
            .mount(&server)
            .await;

        let team = test_client(&server)
            .await
            .get_project_default_team("project-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(team.id, "team-1");
        assert_eq!(team.name, "Platform Team");
    }

    #[tokio::test]
    async fn get_current_iteration_returns_first() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/team-1/_apis/work/teamsettings/iterations"))
            .and(query_param("$timeframe", "current"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{
                    "id": "iter-1",
                    "name": "Sprint 42",
                    "path": "Platform\\Sprint 42",
                    "attributes": {
                        "startDate": "2026-06-15T00:00:00Z",
                        "finishDate": "2026-06-26T00:00:00Z"
                    }
                }]
            })))
            .mount(&server)
            .await;

        let iteration = test_client(&server)
            .await
            .get_current_iteration("project-1", "team-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(iteration.id, "iter-1");
        assert_eq!(iteration.name, "Sprint 42");
        assert_eq!(iteration.path, "Platform\\Sprint 42");
        assert!(iteration.attributes.finish_date.is_some());
    }

    #[tokio::test]
    async fn get_current_iteration_empty_is_none() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/team-1/_apis/work/teamsettings/iterations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 0,
                "value": []
            })))
            .mount(&server)
            .await;

        let iteration = test_client(&server)
            .await
            .get_current_iteration("project-1", "team-1")
            .await
            .unwrap();
        assert!(iteration.is_none());
    }

    #[tokio::test]
    async fn list_iteration_work_item_ids_maps_targets() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/project-1/team-1/_apis/work/teamsettings/iterations/iter-1/workitems",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "workItemRelations": [
                    { "target": { "id": 101 } },
                    { "target": { "id": 102 } },
                    { "rel": null }
                ]
            })))
            .mount(&server)
            .await;

        let ids = test_client(&server)
            .await
            .list_iteration_work_item_ids("project-1", "team-1", "iter-1")
            .await
            .unwrap();
        assert_eq!(ids, vec![101, 102]);
    }
}
