//! Test Results API: the test runs published by a build and the failed results
//! of a run.

use serde::Deserialize;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunStatistic {
    pub outcome: Option<String>,
    #[serde(default)]
    pub count: i64,
}

/// A test run published by a build (one per test task, typically).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub id: i64,
    pub name: Option<String>,
    #[serde(default)]
    pub total_tests: i64,
    #[serde(default)]
    pub passed_tests: i64,
    /// Per-outcome counts; the failed count lives here, not on the run itself.
    #[serde(default)]
    pub run_statistics: Vec<TestRunStatistic>,
}

impl TestRun {
    pub fn failed_tests(&self) -> i64 {
        self.run_statistics
            .iter()
            .filter(|stat| stat.outcome.as_deref() == Some("Failed"))
            .map(|stat| stat.count)
            .sum()
    }
}

/// One test result (only the fields the failed-test list needs).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseResult {
    pub test_case_title: Option<String>,
    pub automated_test_name: Option<String>,
    pub error_message: Option<String>,
    pub duration_in_ms: Option<f64>,
}

impl AdoClient {
    /// The test runs associated with a build.
    pub async fn list_build_test_runs(
        &self,
        project_id: &str,
        build_id: i64,
    ) -> Result<Vec<TestRun>> {
        let path = format!("{project_id}/_apis/test/runs");
        let build_uri = format!("vstfs:///Build/Build/{build_id}");
        let response: ListResponse<TestRun> = self
            .get_json(&path, &[("api-version", "7.1"), ("buildUri", &build_uri)])
            .await?;
        Ok(response.value)
    }

    /// Up to `top` failed results of one test run.
    pub async fn list_failed_test_results(
        &self,
        project_id: &str,
        run_id: i64,
        top: u32,
    ) -> Result<Vec<TestCaseResult>> {
        let path = format!("{project_id}/_apis/test/runs/{run_id}/results");
        let top = top.to_string();
        let response: ListResponse<TestCaseResult> = self
            .get_json(
                &path,
                &[
                    ("api-version", "7.1"),
                    ("outcomes", "Failed"),
                    ("$top", &top),
                ],
            )
            .await?;
        Ok(response.value)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use url::Url;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::auth::PatProvider;
    use crate::client::AdoClient;

    async fn client(server: &MockServer) -> AdoClient {
        let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
        AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(base_url)
    }

    #[tokio::test]
    async fn runs_are_queried_by_build_uri_and_failed_counts_come_from_statistics() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/proj/_apis/test/runs"))
            .and(query_param("buildUri", "vstfs:///Build/Build/77"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{
                    "id": 5, "name": "Unit", "totalTests": 10, "passedTests": 7,
                    "runStatistics": [
                        { "outcome": "Passed", "count": 7 },
                        { "outcome": "Failed", "count": 2 },
                        { "outcome": "NotExecuted", "count": 1 }
                    ]
                }]
            })))
            .mount(&server)
            .await;

        let runs = client(&server)
            .await
            .list_build_test_runs("proj", 77)
            .await
            .unwrap();

        assert_eq!(runs.len(), 1);
        assert_eq!((runs[0].total_tests, runs[0].passed_tests), (10, 7));
        assert_eq!(runs[0].failed_tests(), 2);
    }

    #[tokio::test]
    async fn failed_results_filter_by_outcome_and_cap_with_top() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/proj/_apis/test/runs/5/results"))
            .and(query_param("outcomes", "Failed"))
            .and(query_param("$top", "25"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{
                    "testCaseTitle": "adds", "automatedTestName": "Calc.adds",
                    "errorMessage": "expected 3", "durationInMs": 12.5
                }]
            })))
            .mount(&server)
            .await;

        let results = client(&server)
            .await
            .list_failed_test_results("proj", 5, 25)
            .await
            .unwrap();

        assert_eq!(results[0].test_case_title.as_deref(), Some("adds"));
        assert_eq!(results[0].error_message.as_deref(), Some("expected 3"));
    }
}
