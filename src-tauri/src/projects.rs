use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use azdo_client::{AdoClient, TeamProject};
use tokio::sync::Mutex;

use crate::error::{AppError, Result};

const PROJECT_CACHE_TTL: Duration = Duration::from_secs(300);

/// Organization-wide project directory with a short TTL.
///
/// Almost every work item command needs `GET _apis/projects` only to resolve
/// a project id to its name; the list changes rarely, so paying a REST round
/// trip per command is wasted latency. Sync paths keep calling the API
/// directly because they want a fresh list.
///
/// The lock is held across the fetch on purpose: concurrent commands for the
/// same organization then share one request instead of racing.
#[derive(Debug, Clone, Default)]
pub struct ProjectDirectory {
    cache: Arc<Mutex<HashMap<String, CachedProjects>>>,
}

#[derive(Debug)]
struct CachedProjects {
    fetched_at: Instant,
    projects: Vec<TeamProject>,
}

impl ProjectDirectory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Lists the organization's projects, served from cache when fresh.
    pub async fn list(&self, client: &AdoClient, org_id: &str) -> Result<Vec<TeamProject>> {
        Ok(self.list_with_origin(client, org_id).await?.0)
    }

    /// Resolves one project by id. When a fresh cache does not contain the
    /// id, the list is refetched once so newly created projects resolve.
    pub async fn project(
        &self,
        client: &AdoClient,
        org_id: &str,
        project_id: &str,
    ) -> Result<TeamProject> {
        let (projects, from_cache) = self.list_with_origin(client, org_id).await?;
        if let Some(project) = projects
            .into_iter()
            .find(|project| project.id == project_id)
        {
            return Ok(project);
        }
        if from_cache {
            let projects = self.refresh(client, org_id).await?;
            if let Some(project) = projects
                .into_iter()
                .find(|project| project.id == project_id)
            {
                return Ok(project);
            }
        }
        Err(AppError::InvalidInput(format!(
            "project not found: {project_id}"
        )))
    }

    async fn list_with_origin(
        &self,
        client: &AdoClient,
        org_id: &str,
    ) -> Result<(Vec<TeamProject>, bool)> {
        let mut cache = self.cache.lock().await;
        if let Some(entry) = cache.get(org_id) {
            if entry.fetched_at.elapsed() < PROJECT_CACHE_TTL {
                return Ok((entry.projects.clone(), true));
            }
        }
        let projects = client.list_projects().await?;
        cache.insert(
            org_id.to_string(),
            CachedProjects {
                fetched_at: Instant::now(),
                projects: projects.clone(),
            },
        );
        Ok((projects, false))
    }

    async fn refresh(&self, client: &AdoClient, org_id: &str) -> Result<Vec<TeamProject>> {
        let mut cache = self.cache.lock().await;
        let projects = client.list_projects().await?;
        cache.insert(
            org_id.to_string(),
            CachedProjects {
                fetched_at: Instant::now(),
                projects: projects.clone(),
            },
        );
        Ok(projects)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use azdo_client::PatProvider;
    use url::Url;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    async fn test_client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/testorg/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    fn projects_body() -> serde_json::Value {
        serde_json::json!({
            "count": 2,
            "value": [
                { "id": "p1", "name": "Platform" },
                { "id": "p2", "name": "Tools" }
            ]
        })
    }

    #[tokio::test]
    async fn project_serves_repeat_lookups_from_cache() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(projects_body()))
            .expect(1)
            .mount(&server)
            .await;

        let directory = ProjectDirectory::new();
        let client = test_client(&server).await;

        let first = directory.project(&client, "org1", "p1").await.unwrap();
        assert_eq!(first.name, "Platform");
        let second = directory.project(&client, "org1", "p2").await.unwrap();
        assert_eq!(second.name, "Tools");
        let list = directory.list(&client, "org1").await.unwrap();
        assert_eq!(list.len(), 2);
    }

    #[tokio::test]
    async fn project_refreshes_once_when_id_is_missing_from_cache() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(projects_body()))
            .expect(2)
            .mount(&server)
            .await;

        let directory = ProjectDirectory::new();
        let client = test_client(&server).await;

        // Warm the cache, then look up an unknown id: one refresh, then error.
        directory.list(&client, "org1").await.unwrap();
        let error = directory.project(&client, "org1", "missing").await;
        assert!(error.is_err());
    }

    #[tokio::test]
    async fn cache_is_scoped_per_organization() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/testorg/_apis/projects"))
            .respond_with(ResponseTemplate::new(200).set_body_json(projects_body()))
            .expect(2)
            .mount(&server)
            .await;

        let directory = ProjectDirectory::new();
        let client = test_client(&server).await;

        directory.list(&client, "org1").await.unwrap();
        directory.list(&client, "org2").await.unwrap();
        directory.list(&client, "org1").await.unwrap();
    }
}
