use azdo_client::WikiPage as AzdoWikiPage;
use serde::{Deserialize, Serialize};

use crate::auth::client_for_organization;
use crate::db::{AppDatabase, Organization};
use crate::error::Result;
use crate::projects::ProjectDirectory;
use crate::secrets::SecretStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWikisInput {
    pub organization_id: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWikiPagesInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub wiki_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWikiPageInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub wiki_id: String,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSummary {
    pub id: String,
    pub name: String,
}

/// A flattened wiki page entry: its full `path`, the leaf `title`, tree `depth`,
/// and whether it has child pages.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageNode {
    pub path: String,
    pub title: String,
    pub depth: usize,
    pub is_parent_page: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageContent {
    pub path: String,
    pub title: String,
    pub content: String,
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WikiService {
    db: AppDatabase,
    secrets: SecretStore,
    projects: ProjectDirectory,
}

impl WikiService {
    pub fn new(db: AppDatabase, secrets: SecretStore) -> Self {
        Self {
            db,
            secrets,
            projects: ProjectDirectory::new(),
        }
    }

    fn resolve_organization(&self, id: Option<&str>) -> Result<Organization> {
        self.db.resolve_organization(id)
    }

    pub async fn list_wikis(&self, input: ListWikisInput) -> Result<Vec<WikiSummary>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let wikis = client.list_wikis(&project.id).await?;
        Ok(wikis
            .into_iter()
            .map(|wiki| WikiSummary {
                id: wiki.id,
                name: wiki.name,
            })
            .collect())
    }

    pub async fn list_pages(&self, input: ListWikiPagesInput) -> Result<Vec<WikiPageNode>> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let tree = client
            .get_wiki_page_tree(&project.id, &input.wiki_id)
            .await?;
        let mut out = Vec::new();
        // Skip the synthetic root (`/`); surface only real pages.
        for child in &tree.sub_pages {
            flatten_wiki_page(child, &mut out);
        }
        Ok(out)
    }

    pub async fn get_page(&self, input: GetWikiPageInput) -> Result<WikiPageContent> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let project = self
            .projects
            .project(&client, &organization.id, &input.project_id)
            .await?;
        let page = client
            .get_wiki_page(&project.id, &input.wiki_id, &input.path)
            .await?;
        let path = page.path.unwrap_or(input.path);
        Ok(WikiPageContent {
            title: wiki_page_title(&path),
            content: page.content.unwrap_or_default(),
            remote_url: page.remote_url,
            path,
        })
    }
}

fn flatten_wiki_page(page: &AzdoWikiPage, out: &mut Vec<WikiPageNode>) {
    if let Some(path) = page.path.as_deref().filter(|p| *p != "/") {
        let depth = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .count()
            .saturating_sub(1);
        out.push(WikiPageNode {
            path: path.to_string(),
            title: wiki_page_title(path),
            depth,
            is_parent_page: page.is_parent_page,
        });
    }
    for child in &page.sub_pages {
        flatten_wiki_page(child, out);
    }
}

/// The leaf segment of a wiki page path (e.g. `/Guides/Setup` -> `Setup`).
fn wiki_page_title(path: &str) -> String {
    path.split('/')
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("/")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(path: &str, is_parent: bool, sub_pages: Vec<AzdoWikiPage>) -> AzdoWikiPage {
        AzdoWikiPage {
            path: Some(path.to_string()),
            content: None,
            is_parent_page: is_parent,
            order: None,
            remote_url: None,
            sub_pages,
        }
    }

    #[test]
    fn flatten_wiki_page_skips_root_and_computes_depth() {
        let tree = node(
            "/",
            true,
            vec![
                node("/Home", false, vec![]),
                node("/Guides", true, vec![node("/Guides/Setup", false, vec![])]),
            ],
        );
        let mut out = Vec::new();
        for child in &tree.sub_pages {
            flatten_wiki_page(child, &mut out);
        }
        let rows: Vec<(&str, &str, usize)> = out
            .iter()
            .map(|n| (n.path.as_str(), n.title.as_str(), n.depth))
            .collect();
        assert_eq!(
            rows,
            vec![
                ("/Home", "Home", 0),
                ("/Guides", "Guides", 0),
                ("/Guides/Setup", "Setup", 1),
            ]
        );
    }
}
