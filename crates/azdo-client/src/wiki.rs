use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;

/// A keyword search across wiki pages in the organization. Mirrors
/// `CodeSearchRequest` (`code_search.rs`), but the Wiki Search API has no
/// repository/branch/path filters, so this stays smaller.
#[derive(Debug, Clone, Default)]
pub struct WikiSearchRequest {
    pub search_text: String,
    pub top: u32,
    pub skip: u32,
    /// Project names to scope the search to. Empty means all projects.
    pub project: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchProjectReference {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WikiSearchWikiReference {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchHit {
    #[serde(default)]
    pub field_reference_name: String,
    #[serde(default)]
    pub highlights: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResult {
    pub file_name: String,
    pub path: String,
    pub project: WikiSearchProjectReference,
    pub wiki: WikiSearchWikiReference,
    #[serde(default)]
    pub hits: Vec<WikiSearchHit>,
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

/// A wiki page, as returned by the Wiki Pages "Get" API with
/// `includeContent=true`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPage {
    pub path: String,
    #[serde(default)]
    pub content: String,
    /// Documented as a web link to the page (unlike `url`, which is an API
    /// endpoint), so it is safe to surface directly to the user.
    #[serde(default)]
    pub remote_url: Option<String>,
}

impl AdoClient {
    /// Searches wiki pages across the organization (or a set of projects) by
    /// keyword, via the Search service's wiki index.
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

    /// Fetches a wiki page's content by path. `$format=json` forces a JSON
    /// response instead of the Accept-negotiated default (the same trick
    /// `get_item_content_at_branch` uses for git items).
    pub async fn get_wiki_page(
        &self,
        project: &str,
        wiki_id: &str,
        path: &str,
    ) -> Result<WikiPage> {
        let request_path = format!("{project}/_apis/wiki/wikis/{wiki_id}/pages");
        self.get_json(
            &request_path,
            &[
                ("api-version", "7.1"),
                ("path", path),
                ("includeContent", "true"),
                ("$format", "json"),
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
    async fn search_wiki_maps_results() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/search/wikisearchresults"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "results": [{
                    "fileName": "Hello-world.md",
                    "path": "/Hello-world.md",
                    "collection": { "name": "test" },
                    "project": { "id": "p1", "name": "Release", "visibility": null },
                    "wiki": { "id": "w1", "mappedPath": "/", "name": "Release.wiki", "version": "wikiMaster" },
                    "contentId": "abc",
                    "hits": [{
                        "fieldReferenceName": "content",
                        "highlights": ["<highlighthit>Hello</highlighthit> world"]
                    }]
                }],
                "infoCode": 0
            })))
            .mount(&server)
            .await;

        let response = test_client(&server)
            .await
            .search_wiki(WikiSearchRequest {
                search_text: "Hello".to_string(),
                top: 25,
                skip: 0,
                project: vec![],
            })
            .await
            .unwrap();

        assert_eq!(response.count, 1);
        assert_eq!(response.results[0].file_name, "Hello-world.md");
        assert_eq!(response.results[0].wiki.id, "w1");
        assert_eq!(response.results[0].project.name, "Release");
        assert_eq!(
            response.results[0].hits[0].highlights[0],
            "<highlighthit>Hello</highlighthit> world"
        );
    }

    #[tokio::test]
    async fn search_wiki_sends_project_filter_and_reads_info_code() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/search/wikisearchresults"))
            .and(body_partial_json(serde_json::json!({
                "filters": { "Project": ["Release"] }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 0,
                "results": [],
                "infoCode": 1
            })))
            .mount(&server)
            .await;

        let response = test_client(&server)
            .await
            .search_wiki(WikiSearchRequest {
                search_text: "Hello".to_string(),
                top: 25,
                skip: 0,
                project: vec!["Release".to_string()],
            })
            .await
            .unwrap();

        assert_eq!(response.count, 0);
        assert_eq!(response.info_code, Some(1));
    }

    #[tokio::test]
    async fn get_wiki_page_requests_json_format_with_content() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/Release/_apis/wiki/wikis/w1/pages"))
            .and(query_param("includeContent", "true"))
            .and(query_param("$format", "json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "path": "/Hello-world",
                "content": "Hello world",
                "remoteUrl": "https://dev.azure.com/testorg/Release/_wiki/wikis/w1?pagePath=%2FHello-world"
            })))
            .mount(&server)
            .await;

        let page = test_client(&server)
            .await
            .get_wiki_page("Release", "w1", "/Hello-world")
            .await
            .unwrap();

        assert_eq!(page.content, "Hello world");
        assert_eq!(
            page.remote_url.as_deref(),
            Some("https://dev.azure.com/testorg/Release/_wiki/wikis/w1?pagePath=%2FHello-world")
        );
    }
}
