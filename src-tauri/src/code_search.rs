use azdo_client::CodeSearchRequest;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const CODE_SEARCH_TOP: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCodeInput {
    pub organization_id: Option<String>,
    pub query: String,
    pub project: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub path: Option<String>,
    /// Optional id for cooperative cancellation via `cancel_operation`.
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchHit {
    pub file_name: String,
    pub path: String,
    pub project_name: String,
    pub repository_name: String,
    pub branch: Option<String>,
    pub web_url: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchResults {
    pub count: i64,
    pub results: Vec<CodeSearchHit>,
    /// Set when Azure DevOps could not return full results, e.g. the
    /// organization is still being indexed after enabling Code Search.
    pub notice: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CodeSearchService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl CodeSearchService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn search(&self, input: SearchCodeInput) -> Result<CodeSearchResults> {
        let query = input.query.trim();
        if query.is_empty() {
            return Ok(CodeSearchResults {
                count: 0,
                results: vec![],
                notice: None,
            });
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let response = client
            .search_code(CodeSearchRequest {
                search_text: query.to_string(),
                top: CODE_SEARCH_TOP,
                skip: 0,
                project: normalize(input.project),
                repository: normalize(input.repository),
                branch: normalize(input.branch),
                path: normalize(input.path),
            })
            .await
            .map_err(|error| match error {
                // The Code Search extension is optional; a 404 means it is not
                // installed for this organization.
                azdo_client::AdoError::Api { status: 404, .. } => AppError::InvalidInput(
                    "Code Search is not enabled for this organization. Install the Code Search \
                     extension in Azure DevOps to use it."
                        .to_string(),
                ),
                other => other.into(),
            })?;

        let results = response
            .results
            .into_iter()
            .map(|result| {
                let branch = result
                    .versions
                    .into_iter()
                    .find_map(|version| version.branch_name);
                let web_url = code_file_web_url(
                    &organization,
                    &result.project.name,
                    &result.repository.name,
                    &result.path,
                    branch.as_deref(),
                );
                CodeSearchHit {
                    file_name: result.file_name,
                    path: result.path,
                    project_name: result.project.name,
                    repository_name: result.repository.name,
                    branch,
                    web_url,
                }
            })
            .collect();

        Ok(CodeSearchResults {
            count: response.count,
            results,
            notice: index_notice(response.info_code),
        })
    }
}

fn normalize(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Maps a non-zero Code Search `infoCode` to a user-facing notice. The common
/// case right after enabling Code Search is that the org is still indexing.
fn index_notice(info_code: Option<i64>) -> Option<String> {
    match info_code {
        None | Some(0) => None,
        Some(_) => Some(
            "Azure DevOps could not return full code results — your organization may still be \
             indexing after enabling Code Search. Try again shortly."
                .to_string(),
        ),
    }
}

fn code_file_web_url(
    organization: &Organization,
    project_name: &str,
    repository_name: &str,
    path: &str,
    branch: Option<&str>,
) -> String {
    let base = format!(
        "{}/{}/_git/{}?path={}&_a=contents",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        encode_path_segment(repository_name),
        encode_query_value(path),
    );
    match branch {
        Some(branch) => format!("{base}&version=GB{}", encode_query_value(branch)),
        None => base,
    }
}

/// Percent-encodes a query value while keeping path separators readable.
fn encode_query_value(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Organization {
        Organization {
            id: "contoso".to_string(),
            name: "contoso".to_string(),
            display_name: None,
            base_url: "https://dev.azure.com/contoso/".to_string(),
            auth_provider: "pat".to_string(),
            credential_key: "azdodeck:org:contoso:pat".to_string(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            created_at: "2026-06-14T00:00:00Z".to_string(),
            updated_at: "2026-06-14T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn code_file_web_url_builds_contents_link() {
        assert_eq!(
            code_file_web_url(&org(), "Platform", "azdo dashboard", "/src/main.rs", Some("main")),
            "https://dev.azure.com/contoso/Platform/_git/azdo%20dashboard?path=/src/main.rs&_a=contents&version=GBmain"
        );
    }

    #[test]
    fn index_notice_only_for_nonzero_info_code() {
        assert!(index_notice(None).is_none());
        assert!(index_notice(Some(0)).is_none());
        assert!(index_notice(Some(1)).is_some());
    }
}
