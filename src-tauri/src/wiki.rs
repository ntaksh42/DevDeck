use azdo_client::WikiSearchRequest;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::db::{AppDatabase, Organization};
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;

const WIKI_SEARCH_TOP: u32 = 50;
// Upper bound on a single page; the Wiki Search API caps results per request.
const WIKI_SEARCH_MAX_TOP: u32 = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWikiInput {
    pub organization_id: Option<String>,
    pub query: String,
    /// Page size; defaults to `WIKI_SEARCH_TOP` when omitted or zero.
    pub top: Option<u32>,
    /// Number of leading results to skip, for "load more" paging.
    #[serde(default)]
    pub skip: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchHit {
    pub file_name: String,
    /// Wiki page path (e.g. "/Deploy Guide"), derived from the backing file.
    pub page_path: String,
    pub project_id: String,
    pub project_name: String,
    pub wiki_id: String,
    pub wiki_name: String,
    pub web_url: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchResults {
    pub count: i64,
    pub results: Vec<WikiSearchHit>,
    /// Set when Azure DevOps could not return full results, e.g. the
    /// organization is still being indexed.
    pub notice: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWikiPageInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub project_name: String,
    pub wiki_id: String,
    pub wiki_name: String,
    pub page_path: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageContent {
    pub page_path: String,
    pub content: String,
    pub web_url: String,
}

#[derive(Debug, Clone)]
pub struct WikiService {
    db: AppDatabase,
    secrets: SecretStore,
}

impl WikiService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self { db, secrets }
    }

    pub async fn search(&self, input: SearchWikiInput) -> Result<WikiSearchResults> {
        let query = input.query.trim();
        if query.is_empty() {
            return Ok(WikiSearchResults {
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
            .search_wiki(WikiSearchRequest {
                search_text: query.to_string(),
                top: resolve_top(input.top),
                skip: input.skip.unwrap_or(0),
                project: vec![],
            })
            .await
            .map_err(|error| match error {
                // The Search extension is optional; a 404 means it is not
                // installed for this organization.
                azdo_client::AdoError::Api { status: 404, .. } => AppError::InvalidInput(
                    "Wiki Search is not enabled for this organization. Install the Search \
                     extension in Azure DevOps to use it."
                        .to_string(),
                ),
                other => other.into(),
            })?;

        let results = response
            .results
            .into_iter()
            .map(|result| {
                let page_path = wiki_page_path(&result.path, result.wiki.mapped_path.as_deref());
                let web_url = wiki_web_url(
                    &organization,
                    &result.project.name,
                    &result.wiki.name,
                    &page_path,
                );
                WikiSearchHit {
                    file_name: result.file_name,
                    page_path,
                    project_id: result.project.id,
                    project_name: result.project.name,
                    wiki_id: result.wiki.id,
                    wiki_name: result.wiki.name,
                    web_url,
                }
            })
            .collect();

        Ok(WikiSearchResults {
            count: response.count,
            results,
            notice: index_notice(response.info_code),
        })
    }

    /// Fetches a wiki page's Markdown body for the in-app preview.
    pub async fn get_page(&self, input: GetWikiPageInput) -> Result<WikiPageContent> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let page = client
            .get_wiki_page(&input.project_id, &input.wiki_id, &input.page_path)
            .await?;
        let web_url = wiki_web_url(
            &organization,
            &input.project_name,
            &input.wiki_name,
            &input.page_path,
        );
        Ok(WikiPageContent {
            page_path: page.path,
            content: page.content.unwrap_or_default(),
            web_url,
        })
    }
}

/// Resolves the requested page size: defaults when omitted/zero, capped at the
/// API's per-request maximum.
fn resolve_top(requested: Option<u32>) -> u32 {
    match requested {
        Some(value) if value > 0 => value.min(WIKI_SEARCH_MAX_TOP),
        _ => WIKI_SEARCH_TOP,
    }
}

fn index_notice(info_code: Option<i64>) -> Option<String> {
    match info_code {
        None | Some(0) => None,
        Some(_) => Some(
            "Azure DevOps could not return full wiki results — your organization may still be \
             indexing. Try again shortly."
                .to_string(),
        ),
    }
}

/// Converts a wiki file path to its page path: drops the code-wiki mapped
/// folder and the `.md` extension, turns `-` into a space and decodes `%XX`
/// escapes (a literal hyphen is stored as `%2D`).
fn wiki_page_path(file_path: &str, mapped_path: Option<&str>) -> String {
    let mut path = file_path;
    if let Some(mapped) = mapped_path
        .map(|mapped| mapped.trim_end_matches('/'))
        .filter(|mapped| !mapped.is_empty())
    {
        path = path.strip_prefix(mapped).unwrap_or(path);
    }
    let path = path
        .strip_suffix(".md")
        .or_else(|| path.strip_suffix(".MD"))
        .unwrap_or(path);
    let decoded = percent_decode(&path.replace('-', " "));
    if decoded.starts_with('/') {
        decoded
    } else {
        format!("/{decoded}")
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok());
            if let Some(byte) = hex {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn wiki_web_url(
    organization: &Organization,
    project_name: &str,
    wiki_name: &str,
    page_path: &str,
) -> String {
    format!(
        "{}/{}/_wiki/wikis/{}?pagePath={}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        encode_path_segment(wiki_name),
        encode_path_segment(page_path),
    )
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
            provider_kind: "azdo".to_string(),
        }
    }

    #[test]
    fn wiki_page_path_turns_file_path_into_page_path() {
        assert_eq!(wiki_page_path("/Deploy-Guide.md", None), "/Deploy Guide");
        assert_eq!(
            wiki_page_path("/Ops/Runbook-A.md", Some("")),
            "/Ops/Runbook A"
        );
    }

    #[test]
    fn wiki_page_path_strips_mapped_folder_and_decodes_escapes() {
        assert_eq!(
            wiki_page_path("/docs/Home-Page.md", Some("/docs/")),
            "/Home Page"
        );
        // A literal hyphen is stored as %2D; Japanese titles arrive %-encoded.
        assert_eq!(wiki_page_path("/a%2Db.md", None), "/a-b");
        assert_eq!(wiki_page_path("/%E6%97%A5%E6%9C%AC.md", None), "/日本");
    }

    #[test]
    fn percent_decode_leaves_malformed_escapes() {
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn wiki_web_url_builds_page_link() {
        assert_eq!(
            wiki_web_url(&org(), "Platform", "Platform.wiki", "/Deploy Guide"),
            "https://dev.azure.com/contoso/Platform/_wiki/wikis/Platform.wiki?pagePath=%2FDeploy%20Guide"
        );
    }

    #[test]
    fn resolve_top_defaults_and_caps() {
        assert_eq!(resolve_top(None), WIKI_SEARCH_TOP);
        assert_eq!(resolve_top(Some(0)), WIKI_SEARCH_TOP);
        assert_eq!(resolve_top(Some(30)), 30);
        assert_eq!(resolve_top(Some(10_000)), WIKI_SEARCH_MAX_TOP);
    }

    #[test]
    fn index_notice_only_for_nonzero_info_code() {
        assert!(index_notice(None).is_none());
        assert!(index_notice(Some(0)).is_none());
        assert!(index_notice(Some(1)).is_some());
    }
}
