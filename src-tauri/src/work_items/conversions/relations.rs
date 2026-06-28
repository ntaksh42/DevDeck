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
