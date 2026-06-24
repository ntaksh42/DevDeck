use azdo_client::CodeSearchRequest;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const CODE_SEARCH_TOP: u32 = 50;
// Context preview bounds: at most this many matched lines, each with up to this
// many lines of surrounding context, to keep one file's preview small.
const CODE_CONTEXT_MAX_MATCHES: usize = 25;
const CODE_CONTEXT_DEFAULT_LINES: usize = 3;
const CODE_CONTEXT_MAX_LINES: usize = 8;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetCodeContextInput {
    pub organization_id: Option<String>,
    pub project: String,
    pub repository: String,
    pub branch: String,
    pub path: String,
    /// The search text whose occurrences are highlighted; lines containing it
    /// (case-insensitive) anchor each context block.
    pub query: String,
    pub context_lines: Option<usize>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeContextLine {
    pub line_number: usize,
    pub text: String,
    pub is_match: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeContextBlock {
    pub lines: Vec<CodeContextLine>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeContextResult {
    pub blocks: Vec<CodeContextBlock>,
    pub total_matches: usize,
    /// True when more matches existed than were rendered.
    pub truncated: bool,
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

    /// Fetches a code-search hit's file content and returns the lines matching
    /// the query, each with surrounding context. Used for the inline preview.
    pub async fn get_context(&self, input: GetCodeContextInput) -> Result<CodeContextResult> {
        let query = input.query.trim();
        if query.is_empty() {
            return Err(AppError::InvalidInput("query is required".to_string()));
        }
        let context_lines = input
            .context_lines
            .unwrap_or(CODE_CONTEXT_DEFAULT_LINES)
            .min(CODE_CONTEXT_MAX_LINES);
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let item = client
            .get_item_content_at_branch(
                &input.project,
                &input.repository,
                &input.path,
                &input.branch,
            )
            .await?;
        let content = item.content.unwrap_or_default();
        Ok(build_code_context(&content, query, context_lines))
    }
}

/// Extracts context blocks around lines containing `query` (case-insensitive),
/// merging overlapping/adjacent regions so neighbouring matches share a block.
fn build_code_context(content: &str, query: &str, context_lines: usize) -> CodeContextResult {
    let lines: Vec<&str> = content.lines().collect();
    let needle = query.to_lowercase();
    let match_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(&needle))
        .map(|(index, _)| index)
        .collect();

    let total_matches = match_indices.len();
    let truncated = total_matches > CODE_CONTEXT_MAX_MATCHES;
    let capped = &match_indices[..total_matches.min(CODE_CONTEXT_MAX_MATCHES)];

    // Merge each match's [i-ctx, i+ctx] window into non-overlapping ranges.
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for &index in capped {
        let start = index.saturating_sub(context_lines);
        let end = (index + context_lines).min(lines.len().saturating_sub(1));
        match ranges.last_mut() {
            Some(last) if start <= last.1 + 1 => last.1 = last.1.max(end),
            _ => ranges.push((start, end)),
        }
    }

    let blocks = ranges
        .into_iter()
        .map(|(start, end)| CodeContextBlock {
            lines: (start..=end)
                .map(|index| CodeContextLine {
                    line_number: index + 1,
                    text: lines[index].to_string(),
                    is_match: lines[index].to_lowercase().contains(&needle),
                })
                .collect(),
        })
        .collect();

    CodeContextResult {
        blocks,
        total_matches,
        truncated,
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

    #[test]
    fn build_code_context_returns_matches_with_surrounding_lines() {
        // Matches at lines 2 and 7 with ctx=1 leave a gap, so they stay separate.
        let content = "a\nb TODO\nc\nd\ne\nf\ng TODO\nh\n";
        let result = build_code_context(content, "todo", 1);
        assert_eq!(result.total_matches, 2);
        assert!(!result.truncated);
        assert_eq!(result.blocks.len(), 2);
        // First block: lines 1..=3 (a / b TODO / c).
        let first = &result.blocks[0];
        assert_eq!(first.lines[0].line_number, 1);
        assert_eq!(first.lines[1].text, "b TODO");
        assert!(first.lines[1].is_match);
        assert!(!first.lines[0].is_match);
    }

    #[test]
    fn build_code_context_merges_adjacent_matches() {
        let content = "TODO a\nTODO b\nc\n";
        let result = build_code_context(content, "todo", 1);
        assert_eq!(result.total_matches, 2);
        // Overlapping windows merge into a single block covering lines 1..=3.
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].lines.len(), 3);
    }
}
