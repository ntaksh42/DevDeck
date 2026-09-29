use std::collections::HashSet;

use crate::db::{CachedPr, CachedReviewPr};

use super::super::*;

/// Extracts attached files (`AttachedFile` relations) for the preview, newest
/// last as Azure DevOps returns them. The display name comes from the relation
/// attributes, falling back to the URL's last segment.
pub(crate) fn extract_attachments(raw_relations: &[WorkItemRelation]) -> Vec<WorkItemAttachment> {
    raw_relations
        .iter()
        .filter(|relation| relation.rel == "AttachedFile")
        .map(|relation| WorkItemAttachment {
            name: relation
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.name.clone())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| {
                    relation
                        .url
                        .rsplit('/')
                        .next()
                        .unwrap_or("attachment")
                        .to_string()
                }),
            url: relation.url.clone(),
        })
        .collect()
}

/// Parses the pull request id from an `ArtifactLink` relation URL. Git PR links
/// look like `vstfs:///Git/PullRequestId/{projGuid}%2F{repoGuid}%2F{prId}`,
/// so the PR id is the final segment after URL-decoding the `%2F` separators.
pub(crate) fn pull_request_id_from_artifact(url: &str) -> Option<i64> {
    let lowered = url.to_ascii_lowercase();
    if !lowered.contains("/git/pullrequestid/") {
        return None;
    }
    let decoded = url.replace("%2F", "/").replace("%2f", "/");
    decoded.rsplit('/').next()?.parse::<i64>().ok()
}

/// Extracts the linked pull request ids from `ArtifactLink` relations whose
/// attribute name is "Pull Request" (the Development-section link Azure
/// DevOps adds when a PR references a work item).
pub(crate) fn pull_request_ids_from_relations(raw_relations: &[WorkItemRelation]) -> Vec<i64> {
    let mut pr_ids: Vec<i64> = raw_relations
        .iter()
        .filter(|relation| relation.rel == "ArtifactLink")
        .filter(|relation| {
            relation
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.name.as_deref())
                .is_some_and(|name| name.eq_ignore_ascii_case("Pull Request"))
        })
        .filter_map(|relation| pull_request_id_from_artifact(&relation.url))
        .collect();
    pr_ids.sort_unstable();
    pr_ids.dedup();
    pr_ids
}

/// Parses `(project_id, repository_id, pull_request_id)` from a Git PR
/// `ArtifactLink` URL (`vstfs:///Git/PullRequestId/{proj}%2F{repo}%2F{id}`).
pub(crate) fn pull_request_artifact_parts(url: &str) -> Option<(String, String, i64)> {
    const MARKER: &str = "/git/pullrequestid/";
    let start = url.to_ascii_lowercase().find(MARKER)? + MARKER.len();
    let decoded = url[start..].replace("%2F", "/").replace("%2f", "/");
    let mut parts = decoded.split('/');
    let project = parts.next().filter(|part| !part.is_empty())?;
    let repository = parts.next().filter(|part| !part.is_empty())?;
    let id = parts.next()?.parse::<i64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((project.to_string(), repository.to_string(), id))
}

/// Builds the preview's Pull Requests section. Details come from My Reviews
/// first (it carries the vote), then the org-wide Active PR cache. A PR in
/// neither cache still gets a browser link: Azure DevOps web routes accept the
/// project and repository GUIDs from the artifact link in place of names.
pub(crate) fn pull_request_links_from_relations(
    base_url: &str,
    raw_relations: &[WorkItemRelation],
    reviews: &[CachedReviewPr],
    active_prs: &[CachedPr],
) -> Vec<WorkItemPullRequestLink> {
    let base_url = base_url.trim_end_matches('/');
    pull_request_ids_from_relations(raw_relations)
        .into_iter()
        .map(|pull_request_id| {
            let draft_label =
                |is_draft: bool| if is_draft { "Draft" } else { "Active" }.to_string();
            if let Some(pr) = reviews
                .iter()
                .find(|pr| pr.pull_request_id == pull_request_id)
            {
                return WorkItemPullRequestLink {
                    pull_request_id,
                    repository_id: Some(pr.repository_id.clone()),
                    title: Some(pr.title.clone()),
                    status: Some(draft_label(pr.is_draft)),
                    my_vote_label: Some(pr.my_vote_label.clone()),
                    web_url: pr.web_url.clone(),
                };
            }
            let fallback = raw_relations
                .iter()
                .filter_map(|relation| pull_request_artifact_parts(&relation.url))
                .find(|(_, _, id)| *id == pull_request_id);
            let fallback_url = fallback.as_ref().map(|(project, repository, _)| {
                format!("{base_url}/{project}/_git/{repository}/pullrequest/{pull_request_id}")
            });
            if let Some(pr) = active_prs
                .iter()
                .find(|pr| pr.pull_request_id == pull_request_id)
            {
                return WorkItemPullRequestLink {
                    pull_request_id,
                    repository_id: Some(pr.repository_id.clone()),
                    title: Some(pr.title.clone()),
                    status: Some(draft_label(pr.is_draft)),
                    my_vote_label: None,
                    web_url: pr.web_url.clone().or(fallback_url),
                };
            }
            WorkItemPullRequestLink {
                pull_request_id,
                repository_id: fallback.map(|(_, repository, _)| repository),
                title: None,
                status: None,
                my_vote_label: None,
                web_url: fallback_url,
            }
        })
        .collect()
}

/// True when any PR linked to the work item is currently active in the
/// locally synced PR cache (`active_pr_ids`).
pub(crate) fn work_item_has_active_pull_request(
    raw_relations: &[WorkItemRelation],
    active_pr_ids: &HashSet<i64>,
) -> bool {
    pull_request_ids_from_relations(raw_relations)
        .iter()
        .any(|id| active_pr_ids.contains(id))
}

/// Maps an Azure DevOps link relation to (display label, sort rank).
/// Maps a friendly link type (as chosen in the UI) to its Azure DevOps link
/// reference name. Inverse of the labels in `relation_type_label`.
pub(crate) fn link_type_to_rel(link_type: &str) -> Option<&'static str> {
    match link_type.trim().to_ascii_lowercase().as_str() {
        "parent" => Some("System.LinkTypes.Hierarchy-Reverse"),
        "child" => Some("System.LinkTypes.Hierarchy-Forward"),
        "related" => Some("System.LinkTypes.Related"),
        "successor" => Some("System.LinkTypes.Dependency-Forward"),
        "predecessor" => Some("System.LinkTypes.Dependency-Reverse"),
        _ => None,
    }
}

pub(crate) fn relation_type_label(rel: &str) -> (String, u8) {
    match rel {
        "System.LinkTypes.Hierarchy-Reverse" => ("Parent".to_string(), 0),
        "System.LinkTypes.Hierarchy-Forward" => ("Child".to_string(), 1),
        "System.LinkTypes.Related" => ("Related".to_string(), 2),
        "System.LinkTypes.Dependency-Forward" => ("Successor".to_string(), 3),
        "System.LinkTypes.Dependency-Reverse" => ("Predecessor".to_string(), 3),
        other => (other.rsplit('.').next().unwrap_or(other).to_string(), 4),
    }
}

/// Build the ranked, deduplicated relation links for a preview, applying the
/// item cap only after sorting so high-priority relations (Parent/Child) are
/// never dropped by the API's return order.
pub(crate) fn prioritized_relation_links(
    raw_relations: &[WorkItemRelation],
    limit: usize,
) -> Vec<(String, u8, i64)> {
    let mut links: Vec<(String, u8, i64)> = raw_relations
        .iter()
        .filter_map(|relation| {
            let id = related_work_item_id(&relation.url)?;
            let (label, rank) = relation_type_label(&relation.rel);
            Some((label, rank, id))
        })
        .collect();
    links.sort_by_key(|link| (link.1, link.2));
    links.truncate(limit);
    links
}

pub(crate) fn related_work_item_id(url: &str) -> Option<i64> {
    let lowered = url.to_ascii_lowercase();
    if !lowered.contains("/_apis/wit/workitems/") {
        return None;
    }
    url.rsplit('/').next()?.parse::<i64>().ok()
}
