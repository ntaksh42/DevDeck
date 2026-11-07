use super::{
    parse_date_bound, parse_search_statuses, query::PrQuery, SearchPullRequestsInput, SearchStatus,
};
use crate::{
    db::Organization,
    error::{AppError, Result},
};
use azdo_client::{AdoClient, PullRequestStatus};
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone)]
pub(super) struct Scope {
    pub project_id: Option<String>,
    pub project_name: String,
    pub repository_id: Option<String>,
    pub status: PullRequestStatus,
    pub target: Option<String>,
    pub skip: u32,
}
impl Scope {
    pub fn label(&self) -> String {
        format!(
            "{} / {}{}",
            self.project_name,
            self.status.as_query_value(),
            self.target
                .as_ref()
                .map(|v| format!(" / {v}"))
                .unwrap_or_default()
        )
    }
}

#[derive(Debug)]
pub(super) struct Criteria {
    pub query: PrQuery,
    pub project_ids: HashSet<String>,
    pub statuses: Vec<PullRequestStatus>,
    pub repositories: Vec<String>,
    pub targets: Vec<Option<String>>,
    pub author: Option<String>,
    pub reviewer: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub closed_basis: bool,
    pub exclude_drafts: bool,
}

impl Criteria {
    pub fn new(input: &SearchPullRequestsInput, org: &Organization) -> Result<Self> {
        let query = PrQuery::parse(
            input.query.as_deref().unwrap_or_default(),
            input.exclude_words.as_deref().unwrap_or_default(),
        )?;
        let from = parse_date_bound(input.from_date.as_deref(), false)?;
        let to = parse_date_bound(input.to_date.as_deref(), true)?;
        if from.as_ref().zip(to.as_ref()).is_some_and(|(a, b)| a > b) {
            return Err(AppError::InvalidInput(
                "From must be before or equal to To".into(),
            ));
        }
        let statuses = parse_search_statuses(input.statuses.as_deref())?
            .into_iter()
            .map(|s| match s {
                SearchStatus::CachedActive => PullRequestStatus::Active,
                SearchStatus::Live(status) => status,
            })
            .collect();
        let clean = |values: &Option<Vec<String>>| -> Vec<String> {
            let mut seen = HashSet::new();
            values
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty() && seen.insert(v.clone()))
                .collect()
        };
        let targets = clean(&input.target_branches)
            .into_iter()
            .map(|b| {
                Some(format!(
                    "refs/heads/{}",
                    b.strip_prefix("refs/heads/").unwrap_or(&b)
                ))
            })
            .collect::<Vec<_>>();
        Ok(Self {
            query,
            project_ids: clean(&input.project_ids).into_iter().collect(),
            statuses,
            repositories: clean(&input.repository_ids),
            targets: if targets.is_empty() {
                vec![None]
            } else {
                targets
            },
            author: resolve_person(input.author_id.as_deref(), org)?,
            reviewer: resolve_person(input.reviewer_id.as_deref(), org)?,
            from,
            to,
            closed_basis: input.date_basis.as_deref() == Some("closed"),
            exclude_drafts: input.exclude_drafts.unwrap_or(false),
        })
    }

    pub async fn scopes(&self, client: &AdoClient) -> Result<VecDeque<Scope>> {
        // Repository endpoints accept an organization-level id, avoiding queries
        // against projects that do not own a selected repository.
        let projects = if self.repositories.is_empty() {
            client
                .list_projects()
                .await?
                .into_iter()
                .filter(|p| self.project_ids.is_empty() || self.project_ids.contains(&p.id))
                .map(|p| (Some(p.id), p.name, None))
                .collect::<Vec<_>>()
        } else {
            self.repositories
                .iter()
                .map(|id| (None, id.clone(), Some(id.clone())))
                .collect()
        };
        let mut scopes = VecDeque::new();
        for status in &self.statuses {
            for (project_id, project_name, repository_id) in &projects {
                for target in &self.targets {
                    scopes.push_back(Scope {
                        project_id: project_id.clone(),
                        project_name: project_name.clone(),
                        repository_id: repository_id.clone(),
                        status: *status,
                        target: target.clone(),
                        skip: 0,
                    });
                }
            }
        }
        Ok(scopes)
    }
}

fn resolve_person(person: Option<&str>, org: &Organization) -> Result<Option<String>> {
    let Some(person) = person.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if person.eq_ignore_ascii_case("me") {
        return org.authenticated_user_id.clone().map(Some).ok_or_else(|| {
            AppError::InvalidInput(
                "The signed-in identity is unavailable. Select a person by name.".into(),
            )
        });
    }
    if person.len() > 200 || person.chars().any(char::is_control) {
        return Err(AppError::InvalidInput("Invalid person identity".into()));
    }
    Ok(Some(person.into()))
}
