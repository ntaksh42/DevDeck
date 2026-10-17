use serde::Deserialize;

use crate::{AdoClient, GitPullRequest, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evaluation {
    status: String,
    configuration: Configuration,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    is_enabled: bool,
    is_blocking: bool,
    #[serde(default)]
    is_deleted: bool,
}

#[derive(Deserialize)]
struct Evaluations {
    value: Vec<Evaluation>,
}

fn ready(pr: &GitPullRequest, policies: &[Evaluation]) -> bool {
    pr.status == "active"
        && !pr.is_draft.unwrap_or(false)
        && pr.merge_status.as_deref() == Some("succeeded")
        && pr.reviewers.as_ref().is_some_and(|reviewers| {
            reviewers
                .iter()
                .filter(|r| r.is_required)
                .all(|r| matches!(r.vote, 5 | 10))
        })
        && policies.iter().all(|p| {
            !p.configuration.is_enabled
                || !p.configuration.is_blocking
                || p.configuration.is_deleted
                || matches!(p.status.as_str(), "approved" | "notApplicable")
        })
}

impl AdoClient {
    /// Fresh PR state plus all applicable policy evaluations, including CI.
    /// Unknown/missing merge state never counts as mergeable.
    pub async fn is_pull_request_ready_to_merge(
        &self,
        project_id: &str,
        repository_id: &str,
        pull_request_id: i64,
    ) -> Result<bool> {
        let pr: GitPullRequest = self.get_json(
            &format!("{project_id}/_apis/git/repositories/{repository_id}/pullrequests/{pull_request_id}"),
            &[("api-version", "7.1")],
        ).await?;
        let artifact = format!("vstfs:///CodeReview/CodeReviewId/{project_id}/{pull_request_id}");
        let mut policies = Vec::new();
        loop {
            let skip = policies.len().to_string();
            let page: Evaluations = self
                .get_json(
                    &format!("{project_id}/_apis/policy/evaluations"),
                    &[
                        ("artifactId", &artifact),
                        ("$top", "100"),
                        ("$skip", &skip),
                        ("api-version", "7.1-preview.1"),
                    ],
                )
                .await?;
            let done = page.value.len() < 100;
            policies.extend(page.value);
            if done {
                break;
            }
        }
        Ok(ready(&pr, &policies))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use wiremock::{
        matchers::{method, path, query_param},
        Mock, MockServer, ResponseTemplate,
    };

    fn pr() -> Value {
        json!({"pullRequestId": 42, "title": "Ready", "status": "active",
            "creationDate": "2026-01-01T00:00:00Z", "sourceRefName": "refs/heads/topic",
            "targetRefName": "refs/heads/main", "isDraft": false,
            "mergeStatus": "succeeded", "reviewers": [{"id": "required", "vote": 10, "isRequired": true}]})
    }

    fn policy(status: &str, blocking: bool) -> Value {
        json!({"status": status, "configuration": {"isEnabled": true, "isBlocking": blocking}})
    }

    #[test]
    fn readiness_requires_every_gate_and_ignores_optional_policies() {
        let approved: Vec<Evaluation> =
            serde_json::from_value(json!([policy("approved", true), policy("rejected", false)]))
                .unwrap();
        let base = pr();
        assert!(ready(
            &serde_json::from_value(base.clone()).unwrap(),
            &approved
        ));
        for (field, value) in [
            ("isDraft", json!(true)),
            ("status", json!("completed")),
            ("mergeStatus", json!("conflicts")),
            ("mergeStatus", json!("queued")),
            ("mergeStatus", Value::Null),
            ("reviewers", Value::Null),
            ("reviewers", json!([{"vote": 0, "isRequired": true}])),
        ] {
            let mut blocked = base.clone();
            blocked[field] = value;
            assert!(
                !ready(&serde_json::from_value(blocked).unwrap(), &approved),
                "{field}"
            );
        }
        let pr: GitPullRequest = serde_json::from_value(base).unwrap();
        let mut suggestions = self::pr();
        suggestions["reviewers"][0]["vote"] = json!(5);
        assert!(ready(
            &serde_json::from_value(suggestions).unwrap(),
            &approved
        ));
        for status in ["queued", "running", "rejected", "broken", "unknown"] {
            let policies: Vec<Evaluation> =
                serde_json::from_value(json!([policy(status, true)])).unwrap();
            assert!(!ready(&pr, &policies));
        }
        assert!(ready(&pr, &[]));
    }

    #[tokio::test]
    async fn fetches_all_policy_pages_before_deciding() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p/_apis/git/repositories/r/pullrequests/42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(pr()))
            .mount(&server)
            .await;
        for (skip, values) in [
            ("0", vec![policy("approved", true); 100]),
            ("100", vec![policy("running", true)]),
        ] {
            Mock::given(method("GET"))
                .and(path("/p/_apis/policy/evaluations"))
                .and(query_param(
                    "artifactId",
                    "vstfs:///CodeReview/CodeReviewId/p/42",
                ))
                .and(query_param("api-version", "7.1-preview.1"))
                .and(query_param("$skip", skip))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value": values})))
                .expect(1)
                .mount(&server)
                .await;
        }
        let client = AdoClient::new("org", Arc::new(crate::PatProvider::new("test")))
            .unwrap()
            .with_base_url(url::Url::parse(&format!("{}/", server.uri())).unwrap());
        assert!(!client
            .is_pull_request_ready_to_merge("p", "r", 42)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn policy_permission_failure_is_not_treated_as_no_policies() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/p/_apis/git/repositories/r/pullrequests/42"))
            .respond_with(ResponseTemplate::new(200).set_body_json(pr()))
            .mount(&server)
            .await;
        Mock::given(path("/p/_apis/policy/evaluations"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let client = AdoClient::new("org", Arc::new(crate::PatProvider::new("test")))
            .unwrap()
            .with_base_url(url::Url::parse(&format!("{}/", server.uri())).unwrap());
        assert!(client
            .is_pull_request_ready_to_merge("p", "r", 42)
            .await
            .is_err());
    }
}
