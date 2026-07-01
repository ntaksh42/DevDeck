use azdo_client::{WikiSearchRequest, WikiSearchResult};
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::Result;
use crate::secrets::SecretStore;

const WIKI_SEARCH_TOP: u32 = 25;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchWikiPagesInput {
    pub organization_id: Option<String>,
    pub query: String,
    /// Project names to scope the search to. Empty/omitted means all projects.
    pub projects: Option<Vec<String>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchHit {
    pub file_name: String,
    pub path: String,
    pub project_name: String,
    pub wiki_id: String,
    pub wiki_name: String,
    pub web_url: String,
    /// Plain-text snippet around the first content match, if any (tags from
    /// the search highlight markup are stripped, never rendered as HTML).
    pub snippet: Option<String>,
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
    pub project: String,
    pub wiki_id: String,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageContent {
    pub path: String,
    pub content: String,
    /// Web link to the page for "edit in browser"; falls back to a URL built
    /// from trusted fields if Azure DevOps did not return one.
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

    pub async fn search(&self, input: SearchWikiPagesInput) -> Result<WikiSearchResults> {
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
                top: WIKI_SEARCH_TOP,
                skip: 0,
                project: normalize_values(input.projects),
            })
            .await?;

        let results = response
            .results
            .into_iter()
            .map(|result| wiki_search_hit(&organization, result))
            .collect();

        Ok(WikiSearchResults {
            count: response.count,
            results,
            notice: index_notice(response.info_code),
        })
    }

    pub async fn get_page(&self, input: GetWikiPageInput) -> Result<WikiPageContent> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let page = client
            .get_wiki_page(&input.project, &input.wiki_id, &input.path)
            .await?;

        let web_url = page.remote_url.unwrap_or_else(|| {
            wiki_page_web_url(&organization, &input.project, &input.wiki_id, &page.path)
        });

        Ok(WikiPageContent {
            path: page.path,
            content: page.content,
            web_url,
        })
    }
}

fn wiki_search_hit(organization: &Organization, result: WikiSearchResult) -> WikiSearchHit {
    let snippet = result
        .hits
        .iter()
        .find(|hit| hit.field_reference_name == "content")
        .and_then(|hit| hit.highlights.first())
        .map(|highlight| strip_highlight_tags(highlight));
    let web_url = wiki_page_web_url(
        organization,
        &result.project.name,
        &result.wiki.id,
        &result.path,
    );
    WikiSearchHit {
        file_name: result.file_name,
        path: result.path,
        project_name: result.project.name,
        wiki_id: result.wiki.id,
        wiki_name: result.wiki.name,
        web_url,
        snippet,
    }
}

/// Removes the search service's `<highlighthit>`/`</highlighthit>` highlight
/// markers, leaving plain text. The frontend renders this as text content,
/// never as HTML, so no other sanitization is needed.
fn strip_highlight_tags(value: &str) -> String {
    value
        .replace("<highlighthit>", "")
        .replace("</highlighthit>", "")
}

/// Maps a non-zero Wiki Search `infoCode` to a user-facing notice. The common
/// case right after enabling the org is that it is still indexing.
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

fn wiki_page_web_url(
    organization: &Organization,
    project_name: &str,
    wiki_id: &str,
    path: &str,
) -> String {
    format!(
        "{}/{}/_wiki/wikis/{}?pagePath={}",
        organization.base_url.trim_end_matches('/'),
        encode_query_value(project_name),
        encode_query_value(wiki_id),
        encode_query_value(path),
    )
}

/// Percent-encodes a query value, including path separators. Azure DevOps
/// itself encodes `/` as `%2F` in a wiki page's `pagePath` query value (see the
/// `remoteUrl` shape returned by the Wiki Pages "Get" API), so this differs
/// from `code_search.rs`'s encoder, which leaves `/` readable for file paths.
fn encode_query_value(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

/// Trims and drops blank entries from a multi-value filter so empty selections
/// become an empty list (which the search request omits entirely).
fn normalize_values(values: Option<Vec<String>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
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
    fn wiki_page_web_url_builds_pages_link() {
        assert_eq!(
            wiki_page_web_url(&org(), "Release", "w1", "/Hello world"),
            "https://dev.azure.com/contoso/Release/_wiki/wikis/w1?pagePath=%2FHello%20world"
        );
    }

    #[test]
    fn strip_highlight_tags_removes_markers_only() {
        assert_eq!(
            strip_highlight_tags("<highlighthit>Hello</highlighthit> world"),
            "Hello world"
        );
    }

    #[test]
    fn index_notice_only_for_nonzero_info_code() {
        assert!(index_notice(None).is_none());
        assert!(index_notice(Some(0)).is_none());
        assert!(index_notice(Some(1)).is_some());
    }
}
