use github_client::IssueSearchItem;

use crate::auth::github_client_for_organization;
use crate::db::Organization;
use crate::error::Result;
use crate::prs::{MyCreatedPullRequestSummary, PullRequestSummary, ReviewPullRequestSummary};
use crate::secrets::SecretStore;

/// Upper bound on PRs fetched for the list views.
const MY_CREATED_LIMIT: u32 = 100;

/// Searches pull requests the authenticated user is involved in (authored,
/// assigned, mentioned, or review-requested), mapped to the search DTO. GitHub
/// has no "organization-wide" PR list for a user connection, so `involves:@me`
/// is the closest analogue to the Azure DevOps org-scoped search.
pub async fn search_pull_requests(
    organization: &Organization,
    secrets: &SecretStore,
    query: &str,
    active_only: bool,
    limit: u32,
) -> Result<Vec<PullRequestSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let mut q = String::from("is:pr involves:@me");
    if active_only {
        q.push_str(" is:open");
    }
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
