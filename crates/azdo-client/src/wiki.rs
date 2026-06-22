use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiV2 {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub remote_url: Option<String>,
}

/// A page in a project wiki. The pages endpoint returns a tree rooted at `/`,
/// with each node carrying its `path`, optional Markdown `content`, and child
/// `sub_pages`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPage {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub is_parent_page: bool,
    #[serde(default)]
    pub order: Option<i64>,
    #[serde(default)]
    pub remote_url: Option<String>,
    #[serde(default)]
    pub sub_pages: Vec<WikiPage>,
}

impl AdoClient {
    /// Lists the wikis defined in a project.
    pub async fn list_wikis(&self, project_id: &str) -> Result<Vec<WikiV2>> {
        let path = format!("{project_id}/_apis/wiki/wikis");
        let response: ListResponse<WikiV2> =
            self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(response.value)
    }

    /// Fetches the full page tree of a wiki (paths only, no content).
    pub async fn get_wiki_page_tree(&self, project_id: &str, wiki_id: &str) -> Result<WikiPage> {
        let path = format!("{project_id}/_apis/wiki/wikis/{wiki_id}/pages");
        self.get_json(
            &path,
            &[
                ("api-version", "7.1"),
                ("path", "/"),
                ("recursionLevel", "full"),
            ],
        )
        .await
    }

    /// Fetches a single wiki page including its Markdown content.
    pub async fn get_wiki_page(
        &self,
        project_id: &str,
        wiki_id: &str,
        page_path: &str,
    ) -> Result<WikiPage> {
        let path = format!("{project_id}/_apis/wiki/wikis/{wiki_id}/pages");
        self.get_json(
            &path,
            &[
                ("api-version", "7.1"),
                ("path", page_path),
                ("includeContent", "true"),
            ],
        )
        .await
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
    async fn list_wikis_maps_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/wiki/wikis"))
            .and(query_param("api-version", "7.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "value": [{ "id": "wiki-1", "name": "Platform.wiki" }]
            })))
            .mount(&server)
            .await;

        let wikis = test_client(&server)
            .await
            .list_wikis("project-1")
            .await
            .unwrap();
        assert_eq!(wikis.len(), 1);
        assert_eq!(wikis[0].name, "Platform.wiki");
    }

    #[tokio::test]
    async fn get_wiki_page_tree_parses_subpages() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/wiki/wikis/wiki-1/pages"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("path", "/"))
            .and(query_param("recursionLevel", "full"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "path": "/",
                "isParentPage": true,
                "subPages": [
                    { "path": "/Home", "subPages": [] },
                    {
                        "path": "/Guides",
                        "isParentPage": true,
                        "subPages": [{ "path": "/Guides/Setup", "subPages": [] }]
                    }
                ]
            })))
            .mount(&server)
            .await;

        let tree = test_client(&server)
            .await
            .get_wiki_page_tree("project-1", "wiki-1")
            .await
            .unwrap();
        assert_eq!(tree.sub_pages.len(), 2);
        assert_eq!(
            tree.sub_pages[1].sub_pages[0].path.as_deref(),
            Some("/Guides/Setup")
        );
    }

    #[tokio::test]
    async fn get_wiki_page_includes_content() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/wiki/wikis/wiki-1/pages"))
            .and(query_param("api-version", "7.1"))
            .and(query_param("path", "/Home"))
            .and(query_param("includeContent", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "path": "/Home",
                "content": "# Welcome\nHello wiki.",
                "remoteUrl": "https://dev.azure.com/testorg/_wiki/wikis/wiki-1?pagePath=%2FHome"
            })))
            .mount(&server)
            .await;

        let page = test_client(&server)
            .await
            .get_wiki_page("project-1", "wiki-1", "/Home")
            .await
            .unwrap();
        assert_eq!(page.content.as_deref(), Some("# Welcome\nHello wiki."));
    }
}
