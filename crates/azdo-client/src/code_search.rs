use serde::Deserialize;
use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;

#[derive(Debug, Clone, Default)]
pub struct CodeSearchRequest {
    pub search_text: String,
    pub top: u32,
    pub skip: u32,
    /// Optional filters by name. Empty lists are omitted. Branch is a short
    /// name (e.g. "main").
    pub project: Vec<String>,
    pub repository: Vec<String>,
    pub branch: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchNameId {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchVersion {
    pub branch_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchResult {
    pub file_name: String,
    pub path: String,
    pub project: CodeSearchNameId,
    pub repository: CodeSearchNameId,
    #[serde(default)]
    pub versions: Vec<CodeSearchVersion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchResponse {
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub results: Vec<CodeSearchResult>,
    /// Non-zero when results are partial/unavailable (e.g. indexing in progress).
    #[serde(default)]
    pub info_code: Option<i64>,
}

impl AdoClient {
    pub async fn search_code(&self, request: CodeSearchRequest) -> Result<CodeSearchResponse> {
        let mut body = json!({
            "searchText": request.search_text,
            "$top": request.top,
            "$skip": request.skip,
        });
        let mut filters = serde_json::Map::new();
        for (key, values) in [
            ("Project", request.project),
            ("Repository", request.repository),
        ] {
            let values: Vec<String> = values
                .into_iter()
                .filter(|value| !value.trim().is_empty())
                .collect();
            if !values.is_empty() {
                filters.insert(key.to_string(), json!(values));
            }
        }
        for (key, value) in [("Branch", request.branch), ("Path", request.path)] {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                filters.insert(key.to_string(), json!([value]));
            }
        }
        if !filters.is_empty() {
            body["filters"] = serde_json::Value::Object(filters);
        }
        self.post_json_almsearch(
            "_apis/search/codesearchresults",
            &[("api-version", "7.1")],
            &body,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::auth::PatProvider;

    async fn test_client(server: &MockServer) -> AdoClient {
        // almsearch_base_url only rewrites the dev.azure.com host, so a mock
        // base URL is used as-is and the POST lands on the mock server.
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn search_code_maps_results() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/search/codesearchresults"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 1,
                "results": [{
                    "fileName": "main.rs",
                    "path": "/src/main.rs",
                    "project": { "name": "Platform", "id": "p1" },
                    "repository": { "name": "azdo-dashboard", "id": "r1" },
                    "versions": [{ "branchName": "main", "changeId": "abc" }]
                }]
            })))
            .mount(&server)
            .await;

        let response = test_client(&server)
            .await
            .search_code(CodeSearchRequest {
                search_text: "AdoClient".to_string(),
                top: 50,
                skip: 0,
                ..Default::default()
            })
            .await
            .unwrap();

        assert_eq!(response.count, 1);
        assert_eq!(response.results[0].file_name, "main.rs");
        assert_eq!(response.results[0].repository.name, "azdo-dashboard");
        assert_eq!(
            response.results[0].versions[0].branch_name.as_deref(),
            Some("main")
        );
    }

    #[tokio::test]
    async fn search_code_sends_filters_and_reads_info_code() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/search/codesearchresults"))
            .and(body_partial_json(serde_json::json!({
                "filters": {
                    "Project": ["Platform"],
                    "Repository": ["azdo-dashboard"],
                    "Branch": ["main"]
                }
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
            .search_code(CodeSearchRequest {
                search_text: "AdoClient".to_string(),
                top: 50,
                skip: 0,
                project: vec!["Platform".to_string()],
                repository: vec!["azdo-dashboard".to_string()],
                branch: Some("main".to_string()),
                path: None,
            })
            .await
            .unwrap();

        assert_eq!(response.count, 0);
        assert_eq!(response.info_code, Some(1));
    }
}
