//! GitHub code search mapped onto the code-search DTOs. Scoped to the connected
//! user's repositories via the `user:` qualifier, mirroring how Azure DevOps
//! code search is scoped to the organization.

use github_client::CodeSearchItem;

use crate::auth::github_client_for_organization;
use crate::code_search::{CodeSearchHit, CodeSearchResults, SearchCodeInput};
use crate::db::Organization;
use crate::error::Result;
use crate::secrets::SecretStore;

const CODE_SEARCH_LIMIT: u32 = 50;

/// Derives the GitHub login from the connection id (`github:{login}`), falling
/// back to the display name.
fn login_for(organization: &Organization) -> String {
    organization
        .id
        .strip_prefix("github:")
        .map(str::to_string)
        .or_else(|| organization.display_name.clone())
        .unwrap_or_else(|| organization.name.clone())
}

pub async fn search(
    organization: &Organization,
    secrets: &SecretStore,
    input: &SearchCodeInput,
) -> Result<CodeSearchResults> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(CodeSearchResults {
            count: 0,
            results: vec![],
            notice: None,
        });
    }
    let client = github_client_for_organization(organization, secrets)?;

    // GitHub code search requires a scope qualifier. Repository names of the
    // form `owner/repo` are pushed down as `repo:` filters; otherwise the search
    // is scoped to the connected user's repositories.
    let mut q = query.to_string();
    let repo_scopes: Vec<&String> = input
        .repositories
        .as_ref()
        .map(|repos| repos.iter().filter(|r| r.contains('/')).collect())
        .unwrap_or_default();
    if repo_scopes.is_empty() {
        q.push_str(&format!(" user:{}", login_for(organization)));
    } else {
        for repo in repo_scopes {
            q.push_str(&format!(" repo:{repo}"));
        }
    }
    if let Some(path) = input
        .path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        q.push_str(&format!(" path:{path}"));
    }

    let (items, total) = client.search_code(&q, CODE_SEARCH_LIMIT).await?;
    let results: Vec<CodeSearchHit> = items.into_iter().map(item_to_hit).collect();
    Ok(CodeSearchResults {
        count: total as i64,
        results,
        notice: None,
    })
}

fn item_to_hit(item: CodeSearchItem) -> CodeSearchHit {
    let repo = item.repository.as_ref();
    let owner = repo
        .and_then(|r| r.owner.as_ref())
        .map(|o| o.login.clone())
        .unwrap_or_default();
    let repo_name = repo.map(|r| r.name.clone()).unwrap_or_default();
    CodeSearchHit {
        file_name: item.name,
        path: item.path,
        project_name: owner,
        repository_name: repo_name,
        branch: None,
        web_url: item.html_url,
    }
}
