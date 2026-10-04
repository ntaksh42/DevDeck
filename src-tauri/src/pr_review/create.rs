//! Creating a pull request from a source branch into a target branch.

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::error::{AppError, Result};

use super::types::*;

/// `feature/x` and `refs/heads/feature/x` both become `refs/heads/feature/x`.
fn full_branch_ref(branch: &str) -> String {
    let branch = branch.trim();
    if branch.starts_with("refs/") {
        branch.to_string()
    } else {
        format!("refs/heads/{branch}")
    }
}

/// The Pull Request body, after checking the input a user can get wrong.
fn creation_body(input: &CreatePullRequestInput) -> Result<serde_json::Value> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput(
            "pull request title cannot be empty".to_string(),
        ));
    }
    let source = full_branch_ref(&input.source_branch);
    let target = full_branch_ref(&input.target_branch);
    if source == "refs/heads/" || target == "refs/heads/" {
        return Err(AppError::InvalidInput(
            "source and target branches are required".to_string(),
        ));
    }
    if source == target {
        return Err(AppError::InvalidInput(
            "source and target branches must differ".to_string(),
        ));
    }
    let mut body = serde_json::json!({
        "sourceRefName": source,
        "targetRefName": target,
        "title": title,
        "isDraft": input.is_draft,
    });
    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["description"] = serde_json::Value::String(description.to_string());
    }
    Ok(body)
}

impl PrReviewService {
    /// Opens a pull request (issue #387).
    pub async fn create_pull_request(
        &self,
        input: CreatePullRequestInput,
    ) -> Result<CreatedPullRequest> {
        let body = creation_body(&input)?;
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let created = client
            .create_pull_request(&input.project_id, &input.repository_id, &body)
            .await?;
        // Built from trusted fields; the repository GUID resolves in `_git/{repo}`.
        let web_url = format!(
            "{}/{}/_git/{}/pullrequest/{}",
            organization.base_url.trim_end_matches('/'),
            encode_path_segment(&input.project_id),
            encode_path_segment(&input.repository_id),
            created.pull_request_id
        );
        Ok(CreatedPullRequest {
            pull_request_id: created.pull_request_id,
            title: created.title,
            web_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(source: &str, target: &str, title: &str) -> CreatePullRequestInput {
        CreatePullRequestInput {
            organization_id: None,
            project_id: "p".to_string(),
            repository_id: "r".to_string(),
            source_branch: source.to_string(),
            target_branch: target.to_string(),
            title: title.to_string(),
            description: None,
            is_draft: false,
        }
    }

    #[test]
    fn body_uses_full_refs_and_omits_a_blank_description() {
        let mut request = input("feature/x", "refs/heads/main", "  Add x  ");
        request.description = Some("   ".to_string());
        request.is_draft = true;
        let body = creation_body(&request).unwrap();
        assert_eq!(body["sourceRefName"], "refs/heads/feature/x");
        assert_eq!(body["targetRefName"], "refs/heads/main");
        assert_eq!(body["title"], "Add x");
        assert_eq!(body["isDraft"], true);
        assert!(body.get("description").is_none());
    }

    #[test]
    fn body_keeps_a_trimmed_description() {
        let mut request = input("a", "b", "t");
        request.description = Some("  why  ".to_string());
        assert_eq!(creation_body(&request).unwrap()["description"], "why");
    }

    #[test]
    fn invalid_input_is_rejected() {
        assert!(creation_body(&input("a", "b", "  ")).is_err());
        assert!(creation_body(&input("", "b", "t")).is_err());
        assert!(creation_body(&input("a", " ", "t")).is_err());
        assert!(creation_body(&input("main", "refs/heads/main", "t")).is_err());
    }
}
