use chrono::NaiveDate;
use github_client::IssueSearchItem;

use crate::auth::github_client_for_organization;
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::prs::{
    MyCreatedPullRequestSummary, PullRequestSummary, ReviewPullRequestSummary,
    SearchPullRequestsInput,
};
use crate::secrets::SecretStore;

/// Upper bound on PRs fetched for the list views.
const MY_CREATED_LIMIT: u32 = 100;

/// The subset of [`SearchPullRequestsInput`] that maps onto GitHub search
/// qualifiers. Built once so the query string and the search call stay in sync.
///
/// `project_ids` carries the repository owner (see `item_to_search_summary`,
/// which sets `project_id` to the owner), and `repository_ids` carries the
/// `owner/name` slug, so both become `repo:`/`user:` qualifiers.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PrSearchQualifiers {
    repositories: Vec<String>,
    owners: Vec<String>,
    target_branches: Vec<String>,
    /// `created` or `closed`, matching the requested date basis.
    date_field: &'static str,
    from_date: Option<String>,
    to_date: Option<String>,
}

impl PrSearchQualifiers {
    pub fn from_input(input: &SearchPullRequestsInput) -> Result<Self> {
        let clean = |values: &Option<Vec<String>>| -> Vec<String> {
            values
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        };
        Ok(Self {
            repositories: clean(&input.repository_ids),
            owners: clean(&input.project_ids),
            // Azure DevOps sends full ref names; GitHub wants the bare branch.
            target_branches: clean(&input.target_branches)
                .into_iter()
                .map(|branch| {
                    branch
                        .strip_prefix("refs/heads/")
                        .unwrap_or(&branch)
                        .to_string()
                })
                .collect(),
            date_field: match input.date_basis.as_deref().map(str::trim) {
                Some("closed") => "closed",
                _ => "created",
            },
            from_date: parse_search_date(input.from_date.as_deref())?,
            to_date: parse_search_date(input.to_date.as_deref())?,
        })
    }

    /// Appends the qualifiers to a GitHub search query string.
    fn append_to(&self, q: &mut String) {
        // `repo:` already pins the owner, so adding `user:` alongside it would
        // AND two qualifiers that cannot both match.
        if !self.repositories.is_empty() {
            for repository in &self.repositories {
                q.push_str(" repo:");
                q.push_str(repository);
            }
        } else {
            for owner in &self.owners {
                q.push_str(" user:");
                q.push_str(owner);
            }
        }
        for branch in &self.target_branches {
            q.push_str(" base:");
            q.push_str(branch);
        }
        match (self.from_date.as_deref(), self.to_date.as_deref()) {
            (Some(from), Some(to)) => {
                q.push_str(&format!(" {}:{from}..{to}", self.date_field));
            }
            (Some(from), None) => q.push_str(&format!(" {}:>={from}", self.date_field)),
            (None, Some(to)) => q.push_str(&format!(" {}:<={to}", self.date_field)),
            (None, None) => {}
        }
    }
}

/// Validates a `YYYY-MM-DD` filter bound for use in a GitHub date qualifier.
fn parse_search_date(value: Option<&str>) -> Result<Option<String>> {
    let Some(trimmed) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::InvalidInput(format!("invalid date: {trimmed}")))?;
    Ok(Some(trimmed.to_string()))
}

/// Searches pull requests the authenticated user is involved in (authored,
/// assigned, mentioned, or review-requested), mapped to the search DTO. GitHub
/// has no "organization-wide" PR list for a user connection, so `involves:@me`
/// is the closest analogue to the Azure DevOps org-scoped search.
pub async fn search_pull_requests(
    organization: &Organization,
    secrets: &SecretStore,
    query: &str,
    active_only: bool,
    qualifiers: &PrSearchQualifiers,
    limit: u32,
) -> Result<Vec<PullRequestSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let mut q = String::from("is:pr involves:@me");
    if active_only {
        q.push_str(" is:open");
    }
    qualifiers.append_to(&mut q);
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        q.push(' ');
        q.push_str(trimmed);
    }
    let items = client.search_prs(&q, limit).await?;
    let mut results: Vec<PullRequestSummary> = items
        .into_iter()
        .map(|item| item_to_search_summary(&organization.id, item))
        .collect();
    results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
    Ok(results)
}

fn item_to_search_summary(org_id: &str, item: IssueSearchItem) -> PullRequestSummary {
    let (owner, repo) = item
        .owner_repo()
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .unwrap_or_default();
    let status = pr_status(&item);
    let created_by = item.user.as_ref().map(|u| u.login.clone());
    let closed_date = item.pull_request.as_ref().and_then(|p| p.merged_at.clone());
    PullRequestSummary {
        organization_id: org_id.to_string(),
        project_id: owner.clone(),
        project_name: owner.clone(),
        repository_id: format!("{owner}/{repo}"),
        repository_name: repo,
        pull_request_id: item.number as i64,
        title: item.title,
        status,
        created_by,
        creation_date: item.created_at,
        closed_date,
        source_ref_name: String::new(),
        target_ref_name: String::new(),
        web_url: Some(item.html_url),
        is_draft: item.draft,
    }
}

/// Maps a GitHub PR state to the Azure DevOps status vocabulary the UI uses.
fn pr_status(item: &IssueSearchItem) -> String {
    if item.state.eq_ignore_ascii_case("open") {
        "active".to_string()
    } else if item
        .pull_request
        .as_ref()
        .and_then(|p| p.merged_at.as_ref())
        .is_some()
    {
        "completed".to_string()
    } else {
        "abandoned".to_string()
    }
}

/// Lists open pull requests the authenticated user authored on GitHub, mapped to
/// the same DTO the Azure DevOps path returns. GitHub's search API does not
/// surface source/target branches or reviewer approvals, so those fields are
/// left empty/zero rather than fetched per-PR (kept cheap for the list view).
pub async fn list_my_created_pull_requests(
    organization: &Organization,
    secrets: &SecretStore,
) -> Result<Vec<MyCreatedPullRequestSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let items = client.list_authored_pull_requests(MY_CREATED_LIMIT).await?;
    let mut results: Vec<MyCreatedPullRequestSummary> = items
        .into_iter()
        .map(|item| item_to_summary(&organization.id, item))
        .collect();
    results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
    Ok(results)
}

/// Lists open pull requests where the authenticated user is a requested
/// reviewer, mapped to the Azure DevOps review DTO. GitHub has no per-reviewer
/// "vote" until a review is submitted, so a pending review request maps to a
/// neutral (no vote) state; CI/merge status are omitted to keep the list cheap.
pub async fn list_my_reviews(
    organization: &Organization,
    secrets: &SecretStore,
) -> Result<Vec<ReviewPullRequestSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let items = client
        .list_review_requested_pull_requests(MY_CREATED_LIMIT)
        .await?;
    let mut results: Vec<ReviewPullRequestSummary> = items
        .into_iter()
        .map(|item| item_to_review_summary(&organization.id, item))
        .collect();
    results.sort_by(|a, b| b.creation_date.cmp(&a.creation_date));
    Ok(results)
}

fn item_to_review_summary(org_id: &str, item: IssueSearchItem) -> ReviewPullRequestSummary {
    let (owner, repo) = item
        .owner_repo()
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .unwrap_or_default();
    let created_by = item.user.as_ref().map(|u| u.login.clone());
    ReviewPullRequestSummary {
        organization_id: org_id.to_string(),
        project_id: owner.clone(),
        project_name: owner.clone(),
        repository_id: format!("{owner}/{repo}"),
        repository_name: repo,
        pull_request_id: item.number as i64,
        title: item.title,
        created_by,
        creation_date: item.created_at,
        target_ref_name: String::new(),
        web_url: Some(item.html_url),
        my_vote: 0,
        my_vote_label: String::new(),
        my_is_required: false,
        is_draft: item.draft,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn item_to_summary(org_id: &str, item: IssueSearchItem) -> MyCreatedPullRequestSummary {
    let (owner, repo) = item
        .owner_repo()
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .unwrap_or_default();
    MyCreatedPullRequestSummary {
        organization_id: org_id.to_string(),
        // GitHub has no "project"; the repository owner is the closest analogue
        // and gives the view a stable grouping key.
        project_id: owner.clone(),
        project_name: owner.clone(),
        // `owner/repo` is GitHub's canonical repository identifier.
        repository_id: format!("{owner}/{repo}"),
        repository_name: repo,
        pull_request_id: item.number as i64,
        title: item.title,
        creation_date: item.created_at,
        source_ref_name: String::new(),
        target_ref_name: String::new(),
        web_url: Some(item.html_url),
        is_draft: item.draft,
        approvals: 0,
        reviewer_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> SearchPullRequestsInput {
        SearchPullRequestsInput {
            organization_id: None,
            query: None,
            statuses: None,
            project_ids: None,
            repository_ids: None,
            target_branches: None,
            from_date: None,
            to_date: None,
            date_basis: None,
            exclude_drafts: None,
            sort_by: None,
        }
    }

    fn query_for(input: &SearchPullRequestsInput) -> String {
        let mut q = String::from("is:pr involves:@me");
        PrSearchQualifiers::from_input(input)
            .unwrap()
            .append_to(&mut q);
        q
    }

    #[test]
    fn no_filters_leave_the_base_query_untouched() {
        assert_eq!(query_for(&input()), "is:pr involves:@me");
    }

    #[test]
    fn repositories_and_branches_become_qualifiers() {
        let mut i = input();
        i.repository_ids = Some(vec!["octo/hello".into(), "  ".into()]);
        i.target_branches = Some(vec!["refs/heads/main".into(), "release".into()]);
        let q = query_for(&i);
        assert!(q.contains("repo:octo/hello"), "{q}");
        // Blank entries are dropped and refs/heads/ is stripped for GitHub.
        assert!(!q.contains("repo: "), "{q}");
        assert!(q.contains("base:main"), "{q}");
        assert!(q.contains("base:release"), "{q}");
    }

    #[test]
    fn owner_qualifier_is_dropped_when_a_repository_pins_it() {
        let mut i = input();
        i.project_ids = Some(vec!["octo".into()]);
        i.repository_ids = Some(vec!["octo/hello".into()]);
        let q = query_for(&i);
        // `repo:` already scopes to the owner; ANDing `user:` matches nothing.
        assert!(q.contains("repo:octo/hello"), "{q}");
        assert!(!q.contains("user:"), "{q}");
    }

    #[test]
    fn owner_qualifier_is_used_without_a_repository_filter() {
        let mut i = input();
        i.project_ids = Some(vec!["octo".into()]);
        assert!(query_for(&i).contains("user:octo"));
    }

    #[test]
    fn date_window_maps_to_the_requested_basis() {
        let mut i = input();
        i.from_date = Some("2026-01-01".into());
        i.to_date = Some("2026-02-01".into());
        assert!(query_for(&i).contains("created:2026-01-01..2026-02-01"));

        i.date_basis = Some("closed".into());
        assert!(query_for(&i).contains("closed:2026-01-01..2026-02-01"));
    }

    #[test]
    fn open_ended_date_bounds_use_comparison_qualifiers() {
        let mut i = input();
        i.from_date = Some("2026-01-01".into());
        assert!(query_for(&i).contains("created:>=2026-01-01"));

        let mut i = input();
        i.to_date = Some("2026-02-01".into());
        assert!(query_for(&i).contains("created:<=2026-02-01"));
    }

    #[test]
    fn an_unparseable_date_is_rejected_rather_than_silently_dropped() {
        let mut i = input();
        i.from_date = Some("01/02/2026".into());
        assert!(PrSearchQualifiers::from_input(&i).is_err());
    }
}
