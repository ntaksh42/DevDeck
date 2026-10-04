use serde::Deserialize;
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Clone, Default)]
pub struct WikiSearchRequest {
    pub search_text: String,
    pub top: u32,
    pub skip: u32,
    /// Optional project-name filters. Empty lists are omitted.
    pub project: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchWiki {
    pub id: String,
    pub name: String,
    /// Repository folder a code wiki is published from (e.g. "/docs"); absent
    /// for project wikis.
    #[serde(default)]
    pub mapped_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResult {
    pub file_name: String,
    /// File path inside the wiki's backing repository, e.g. "/Home-Page.md".
    pub path: String,
    pub project: WikiSearchProject,
    pub wiki: WikiSearchWiki,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResponse {
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub results: Vec<WikiSearchResult>,
    /// Non-zero when results are partial/unavailable (e.g. indexing in progress).
    #[serde(default)]
    pub info_code: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPage {
    pub path: String,
    #[serde(default)]
    pub content: Option<String>,
}

impl AdoClient {
    pub async fn search_wiki(&self, request: WikiSearchRequest) -> Result<WikiSearchResponse> {
        let mut body = json!({
            "searchText": request.search_text,
            "$top": request.top,
            "$skip": request.skip,
        });
        let projects: Vec<String> = request
            .project
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect();
        if !projects.is_empty() {
            body["filters"] = json!({ "Project": projects });
        }
        self.post_json_almsearch(
            "_apis/search/wikisearchresults",
            &[("api-version", "7.1")],
            &body,
        )
        .await
    }

    /// Fetches one wiki page with its Markdown body. `wiki_id` may be the wiki's
    /// GUID or name; `page_path` is the wiki page path (e.g. "/Home/Sub Page").
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
                ("path", page_path),
                ("includeContent", "true"),
                ("api-version", "7.1"),
            ],
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_partial_json, method, path, query_param};
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
    async fn search_wiki_maps_results_and_sends_project_filter() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/search/wikisearchresults"))
            .and(body_partial_json(serde_json::json!({
                "searchText": "deploy",
                "filters": { "Project": ["Platform"] }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "results": [{
                    "fileName": "Deploy-Guide.md",
                    "path": "/Deploy-Guide.md",
                    "project": { "id": "p-1", "name": "Platform" },
                    "wiki": { "id": "w-1", "name": "Platform.wiki" }
                }]
            })))
            .mount(&server)
            .await;

        let response = test_client(&server)
            .await
            .search_wiki(WikiSearchRequest {
                search_text: "deploy".to_string(),
                top: 50,
                skip: 0,
                project: vec!["Platform".to_string(), " ".to_string()],
            })
            .await
            .unwrap();

        assert_eq!(response.count, 1);
        assert_eq!(response.results[0].wiki.name, "Platform.wiki");
        assert!(response.results[0].wiki.mapped_path.is_none());
    }

    #[tokio::test]
    async fn get_wiki_page_requests_content() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p-1/_apis/wiki/wikis/w-1/pages"))
            .and(query_param("path", "/Deploy Guide"))
            .and(query_param("includeContent", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "path": "/Deploy Guide",
                "content": "# Deploy\n\nRun the pipeline."
            })))
            .mount(&server)
            .await;

        let page = test_client(&server)
            .await
            .get_wiki_page("p-1", "w-1", "/Deploy Guide")
            .await
            .unwrap();

        assert_eq!(page.path, "/Deploy Guide");
        assert_eq!(
            page.content.as_deref(),
            Some("# Deploy\n\nRun the pipeline.")
        );
    }
}
