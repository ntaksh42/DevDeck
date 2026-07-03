use serde_json::json;

use crate::client::AdoClient;
use crate::error::Result;
use crate::git::ListResponse;

use super::types::{
    build_definition_detail, Approval, Build, BuildArtifact, BuildDefinitionDetail,
    BuildDefinitionRef, BuildListCriteria, BuildLogTail, RawBuildDefinition, Timeline,
};

impl AdoClient {
    pub async fn list_builds(
        &self,
        project_id: &str,
        criteria: BuildListCriteria,
    ) -> Result<Vec<Build>> {
        let path = format!("{project_id}/_apis/build/builds");
        let mut query: Vec<(&str, String)> = vec![
            ("api-version", "7.1".to_string()),
            ("queryOrder", "queueTimeDescending".to_string()),
            ("$top", criteria.top.unwrap_or(50).to_string()),
        ];
        if let Some(definition_id) = criteria.definition_id {
            query.push(("definitions", definition_id.to_string()));
        }
        if let Some(branch) = criteria.branch.filter(|v| !v.trim().is_empty()) {
            let branch = branch.trim();
            let full = if branch.starts_with("refs/") {
                branch.to_string()
            } else {
                format!("refs/heads/{branch}")
            };
            query.push(("branchName", full));
        }
        if let Some(result) = criteria.result_filter.filter(|v| !v.trim().is_empty()) {
            query.push(("resultFilter", result));
        }
        if let Some(status) = criteria.status_filter.filter(|v| !v.trim().is_empty()) {
            query.push(("statusFilter", status));
        }
        if let Some(requested_for) = criteria.requested_for.filter(|v| !v.trim().is_empty()) {
            query.push(("requestedFor", requested_for));
        }

        let query_refs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let response: ListResponse<Build> = self.get_json(&path, &query_refs).await?;
        Ok(response.value)
    }

    pub async fn get_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    pub async fn list_build_artifacts(
        &self,
        project_id: &str,
        build_id: i64,
    ) -> Result<Vec<BuildArtifact>> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/artifacts");
        let response: ListResponse<BuildArtifact> =
            self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(response.value)
    }

    pub async fn get_build_timeline(&self, project_id: &str, build_id: i64) -> Result<Timeline> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/Timeline");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    pub async fn list_build_definitions(
        &self,
        project_id: &str,
        name_filter: Option<&str>,
        top: u32,
    ) -> Result<Vec<BuildDefinitionRef>> {
        let path = format!("{project_id}/_apis/build/definitions");
        let top = top.to_string();
        let mut query = vec![("api-version", "7.1"), ("$top", top.as_str())];
        let name;
        if let Some(filter) = name_filter.map(str::trim).filter(|v| !v.is_empty()) {
            name = format!("*{filter}*");
            query.push(("name", name.as_str()));
        }
        let response: ListResponse<BuildDefinitionRef> = self.get_json(&path, &query).await?;
        Ok(response.value)
    }

    pub async fn get_build_definition(
        &self,
        project_id: &str,
        definition_id: i64,
    ) -> Result<BuildDefinitionDetail> {
        let path = format!("{project_id}/_apis/build/definitions/{definition_id}");
        let raw: RawBuildDefinition = self.get_json(&path, &[("api-version", "7.1")]).await?;
        Ok(build_definition_detail(raw))
    }

    /// Fetches a build definition as raw JSON. Updating a definition requires
    /// PUTting back the full document (including fields this client does not
    /// model), so callers that need to mutate a definition start from this raw
    /// form rather than the typed `BuildDefinitionDetail`.
    pub async fn get_build_definition_raw(
        &self,
        project_id: &str,
        definition_id: i64,
    ) -> Result<serde_json::Value> {
        let path = format!("{project_id}/_apis/build/definitions/{definition_id}");
        self.get_json(&path, &[("api-version", "7.1")]).await
    }

    /// PUTs a full build definition document back (typically fetched via
    /// `get_build_definition_raw` and mutated in place, `revision` included
    /// for the API's optimistic-concurrency check).
    pub async fn update_build_definition(
        &self,
        project_id: &str,
        definition_id: i64,
        body: &serde_json::Value,
    ) -> Result<BuildDefinitionDetail> {
        let path = format!("{project_id}/_apis/build/definitions/{definition_id}");
        let raw: RawBuildDefinition = self
            .put_json(&path, &[("api-version", "7.1")], body)
            .await?;
        Ok(build_definition_detail(raw))
    }

    pub async fn get_build_log_tail(
        &self,
        project_id: &str,
        build_id: i64,
        log_id: i64,
        max_lines: usize,
    ) -> Result<BuildLogTail> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}/logs/{log_id}");
        let body = self.get_text(&path, &[("api-version", "7.1")]).await?;
        let all: Vec<&str> = body.lines().collect();
        let truncated = all.len() > max_lines;
        let start = all.len().saturating_sub(max_lines);
        let lines = all[start..].iter().map(|s| s.to_string()).collect();
        Ok(BuildLogTail { lines, truncated })
    }

    pub async fn queue_build(
        &self,
        project_id: &str,
        definition_id: i64,
        source_branch: &str,
        parameters: Option<&serde_json::Value>,
    ) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds");
        let mut body = json!({
            "definition": { "id": definition_id },
            "sourceBranch": source_branch,
        });
        // `parameters` is a JSON string of build/runtime parameter values, which
        // is how the Builds API accepts them.
        if let Some(parameters) = parameters {
            body["parameters"] = json!(parameters.to_string());
        }
        self.post_json(&path, &[("api-version", "7.1")], &body)
            .await
    }

    pub async fn cancel_build(&self, project_id: &str, build_id: i64) -> Result<Build> {
        let path = format!("{project_id}/_apis/build/builds/{build_id}");
        let body = json!({ "status": "cancelling" });
        self.patch_json(&path, &[("api-version", "7.1")], "application/json", &body)
            .await
    }

    /// Lists pipeline approvals (manual approval checks) for a project, filtered
    /// by `state` (e.g. `"pending"`) and, when non-empty, by the approver
    /// `user_ids` the approval is assigned to.
    pub async fn list_pipeline_approvals(
        &self,
        project_id: &str,
        user_ids: &[String],
        state: &str,
    ) -> Result<Vec<Approval>> {
        let path = format!("{project_id}/_apis/pipelines/approvals");
        let joined = user_ids.join(",");
        let mut query: Vec<(&str, &str)> = vec![
            ("api-version", "7.1"),
            ("$expand", "steps"),
            ("state", state),
        ];
        if !joined.is_empty() {
            query.push(("userIds", joined.as_str()));
        }
        let response: ListResponse<Approval> = self.get_json(&path, &query).await?;
        Ok(response.value)
    }

    /// Approves or rejects a single pipeline approval. `status` is `"approved"`
    /// or `"rejected"`; returns the updated approval objects.
    pub async fn update_pipeline_approval(
        &self,
        project_id: &str,
        approval_id: &str,
        status: &str,
        comment: &str,
    ) -> Result<Vec<Approval>> {
        let path = format!("{project_id}/_apis/pipelines/approvals");
        let body = json!([{
            "approvalId": approval_id,
            "status": status,
            "comment": comment,
        }]);
        let response: ListResponse<Approval> = self
            .patch_json(&path, &[("api-version", "7.1")], "application/json", &body)
            .await?;
        Ok(response.value)
    }
}
