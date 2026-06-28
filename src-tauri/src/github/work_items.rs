//! GitHub Issues mapped onto the work-item DTOs so the Work Items views render
//! GitHub issues for a GitHub connection. GitHub issues are the closest analogue
//! to Azure DevOps work items.

use github_client::{IssueComment, IssueSearchItem};
use serde_json::json;

use crate::auth::github_client_for_organization;
use crate::db::Organization;
use crate::error::{AppError, Result};
use crate::secrets::SecretStore;
use crate::work_items::{
    AddWorkItemCommentInput, AssignWorkItemsInput, BulkWorkItemResult, DeleteWorkItemCommentInput,
    GetWorkItemPreviewInput, SetWorkItemsStateInput, SetWorkItemsTagsInput,
    UpdateWorkItemCommentInput, WorkItemComment, WorkItemPreview, WorkItemSummary,
};

const LIMIT: u32 = 100;

/// Splits a GitHub `owner/repo` slug (used as the work-item project id).
fn split_owner_repo(project_id: &str) -> Result<(String, String)> {
    project_id
        .split_once('/')
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .filter(|(o, r)| !o.is_empty() && !r.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!(
                "GitHub issue project id must be 'owner/repo', got '{project_id}'"
            ))
        })
}

/// Open issues assigned to the authenticated user (the "My Work Items" view).
pub async fn list_my(
    organization: &Organization,
    secrets: &SecretStore,
) -> Result<Vec<WorkItemSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let items = client.list_assigned_issues(LIMIT).await?;
    let assignee = organization.authenticated_user_display_name.clone();
    Ok(items
        .into_iter()
        .map(|item| item_to_summary(&organization.id, item, assignee.clone()))
        .collect())
}

/// Issue search scoped to the authenticated user's involvement, mirroring how
/// the Azure DevOps work-item search is scoped to the connection.
pub async fn search(
    organization: &Organization,
    secrets: &SecretStore,
    query: &str,
) -> Result<Vec<WorkItemSummary>> {
    let client = github_client_for_organization(organization, secrets)?;
    let mut q = String::from("is:issue involves:@me");
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        q.push(' ');
        q.push_str(trimmed);
    }
    let items = client.search_issues(&q, LIMIT).await?;
    Ok(items
        .into_iter()
        .map(|item| item_to_summary(&organization.id, item, None))
        .collect())
}

/// Maps a GitHub issue comment to the work-item comment DTO.
fn comment_to_dto(comment: IssueComment) -> WorkItemComment {
    WorkItemComment {
        id: comment.id as i64,
        text: comment.body.clone(),
        rendered_text: comment.body,
        created_by: comment.user.map(|u| u.login),
        created_by_id: None,
        created_by_unique_name: None,
        created_date: Some(comment.created_at),
        reactions: Vec::new(),
    }
}

/// Issue detail (the Work Item preview) for a GitHub connection.
pub async fn get_preview(
    organization: &Organization,
    secrets: &SecretStore,
    input: GetWorkItemPreviewInput,
) -> Result<WorkItemPreview> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let issue = client.get_issue(&owner, &repo, input.work_item_id).await?;

    let comments_result = client
        .list_issue_comments(&owner, &repo, input.work_item_id)
        .await;
    let (comments, comments_unavailable) = match comments_result {
        Ok(list) => (list.into_iter().map(comment_to_dto).collect(), false),
        Err(_) => (Vec::new(), true),
    };

    let tags = if issue.labels.is_empty() {
        None
    } else {
        Some(
            issue
                .labels
                .iter()
                .map(|l| l.name.clone())
                .collect::<Vec<_>>()
                .join("; "),
        )
    };
    let assigned_to = issue
        .assignee
        .as_ref()
        .map(|u| u.login.clone())
        .or_else(|| issue.assignees.first().map(|u| u.login.clone()));

    Ok(WorkItemPreview {
        organization_id: organization.id.clone(),
        project_id: input.project_id.clone(),
        project_name: repo,
        id: issue.number as i64,
        title: issue.title,
        work_item_type: Some("Issue".to_string()),
        state: Some(issue.state),
        assigned_to,
        assigned_to_unique_name: None,
        created_by: issue.user.map(|u| u.login),
        created_date: Some(issue.created_at),
        changed_date: issue.updated_at,
        area_path: None,
        iteration_path: None,
        reason: None,
        tags,
        priority: None,
        severity: None,
        story_points: None,
        remaining_work: None,
        description_html: issue.body,
        acceptance_criteria_html: None,
        custom_fields: Vec::new(),
        web_url: Some(issue.html_url),
        comments,
        comments_unavailable,
        relations: Vec::new(),
        pull_requests: Vec::new(),
        attachments: Vec::new(),
    })
}

pub async fn add_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: AddWorkItemCommentInput,
) -> Result<WorkItemComment> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let comment = client
        .create_issue_comment(&owner, &repo, input.work_item_id, &input.markdown)
        .await?;
    Ok(comment_to_dto(comment))
}

pub async fn update_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: UpdateWorkItemCommentInput,
) -> Result<WorkItemComment> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let comment = client
        .update_issue_comment(&owner, &repo, input.comment_id, &input.markdown)
        .await?;
    Ok(comment_to_dto(comment))
}

pub async fn delete_comment(
    organization: &Organization,
    secrets: &SecretStore,
    input: DeleteWorkItemCommentInput,
) -> Result<()> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    client
        .delete_issue_comment(&owner, &repo, input.comment_id)
        .await?;
    Ok(())
}

/// Maps an Azure DevOps-style state string to GitHub's open/closed.
fn github_issue_state(state: &str) -> &'static str {
    match state.to_ascii_lowercase().as_str() {
        "closed" | "done" | "resolved" | "completed" | "removed" => "closed",
        _ => "open",
    }
}

pub async fn set_state(
    organization: &Organization,
    secrets: &SecretStore,
    input: SetWorkItemsStateInput,
) -> Result<Vec<BulkWorkItemResult>> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let state = github_issue_state(&input.state);
    let mut results = Vec::new();
    for id in input.work_item_ids {
        let outcome = client
            .update_issue(&owner, &repo, id, json!({ "state": state }))
            .await;
        results.push(BulkWorkItemResult {
            id,
            error: outcome.err().map(|e| e.to_string()),
        });
    }
    Ok(results)
}

pub async fn assign(
    organization: &Organization,
    secrets: &SecretStore,
    input: AssignWorkItemsInput,
) -> Result<Vec<BulkWorkItemResult>> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let assignees: Vec<String> = if input.assigned_to.trim().is_empty() {
        Vec::new()
    } else {
        vec![input.assigned_to.trim().to_string()]
    };
    let mut results = Vec::new();
    for id in input.work_item_ids {
        let outcome = client
            .update_issue(&owner, &repo, id, json!({ "assignees": assignees }))
            .await;
        results.push(BulkWorkItemResult {
            id,
            error: outcome.err().map(|e| e.to_string()),
        });
    }
    Ok(results)
}

pub async fn set_tags(
    organization: &Organization,
    secrets: &SecretStore,
    input: SetWorkItemsTagsInput,
) -> Result<Vec<BulkWorkItemResult>> {
    let (owner, repo) = split_owner_repo(&input.project_id)?;
    let client = github_client_for_organization(organization, secrets)?;
    let mut results = Vec::new();
    for id in input.work_item_ids.clone() {
        let outcome = apply_labels(&client, &owner, &repo, id, &input).await;
        results.push(BulkWorkItemResult {
            id,
            error: outcome.err().map(|e| e.to_string()),
        });
    }
    Ok(results)
}

/// Computes the new label set (current − remove + add) and writes it back, since
/// GitHub's PATCH replaces the whole label list.
async fn apply_labels(
    client: &github_client::GitHubClient,
    owner: &str,
    repo: &str,
    id: i64,
    input: &SetWorkItemsTagsInput,
) -> Result<()> {
    let issue = client.get_issue(owner, repo, id).await?;
    let mut labels: Vec<String> = issue.labels.into_iter().map(|l| l.name).collect();
    labels.retain(|l| !input.remove_tags.iter().any(|r| r.eq_ignore_ascii_case(l)));
    for tag in &input.add_tags {
        if !labels.iter().any(|l| l.eq_ignore_ascii_case(tag)) {
            labels.push(tag.clone());
        }
    }
    client
        .update_issue(owner, repo, id, json!({ "labels": labels }))
        .await?;
    Ok(())
}

fn item_to_summary(
    org_id: &str,
    item: IssueSearchItem,
    assigned_to: Option<String>,
) -> WorkItemSummary {
    let (owner, repo) = item
        .owner_repo()
        .map(|(o, r)| (o.to_string(), r.to_string()))
        .unwrap_or_default();
    // GitHub has no "project"; the `owner/repo` slug is used as the project id so
    // issue detail/mutations can recover the repository (issue numbers are only
    // unique within a repository).
    let repo_slug = format!("{owner}/{repo}");
    WorkItemSummary {
        organization_id: org_id.to_string(),
        project_id: repo_slug,
        project_name: repo,
        id: item.number as i64,
        title: item.title,
        work_item_type: Some("Issue".to_string()),
        state: Some(item.state),
        assigned_to,
        changed_date: item.updated_at,
        web_url: Some(item.html_url),
        extra_fields: Vec::new(),
        depth: None,
    }
}
