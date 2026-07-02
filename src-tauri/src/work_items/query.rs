use std::collections::HashMap;

use azdo_client::ClassificationNode;

use crate::error::{AppError, Result};

use super::ClassificationNodeOption;

pub(crate) const WORK_ITEM_FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "System.ChangedDate",
    "System.Tags",
];

pub(crate) const WORK_ITEM_PREVIEW_FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.AssignedTo",
    "System.CreatedBy",
    "System.CreatedDate",
    "System.ChangedDate",
    "System.AreaPath",
    "System.IterationPath",
    "System.Reason",
    "System.Tags",
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "Microsoft.VSTS.CMMI.Symptom",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "Microsoft.VSTS.Scheduling.RemainingWork",
];

pub(crate) const WORK_ITEM_PREVIEW_COMMENT_LIMIT: u32 = 200;
pub(crate) const WORK_ITEM_IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const MAX_PREVIEW_RELATIONS: usize = 50;

// Area/iteration trees are rarely deeper than a handful of levels; expand
// enough to capture them in a single request.
pub(crate) const CLASSIFICATION_NODE_DEPTH: u32 = 10;

/// Flattens a classification tree depth-first, building each node's field-ready
/// path (`System.AreaPath` form) by backslash-joining ancestor names.
pub(crate) fn flatten_classification_node(
    node: &ClassificationNode,
    parent_path: Option<&str>,
    depth: usize,
    out: &mut Vec<ClassificationNodeOption>,
) {
    let path = match parent_path {
        Some(parent) => format!("{parent}\\{}", node.name),
        None => node.name.clone(),
    };
    let (start_date, finish_date) = node
        .attributes
        .as_ref()
        .map(|a| (a.start_date.clone(), a.finish_date.clone()))
        .unwrap_or((None, None));
    out.push(ClassificationNodeOption {
        name: node.name.clone(),
        path: path.clone(),
        depth,
        has_children: node.has_children,
        start_date,
        finish_date,
    });
    for child in &node.children {
        flatten_classification_node(child, Some(&path), depth + 1, out);
    }
}

pub(crate) fn validate_work_item_wiql(wiql: &str) -> Result<&str> {
    let wiql = wiql.trim();
    if wiql.is_empty() {
        return Err(AppError::InvalidInput("WIQL query is required".to_string()));
    }
    if !wiql_queries_source(wiql, "workitems") && !is_link_wiql(wiql) {
        return Err(AppError::InvalidInput(
            "WIQL must query FROM WorkItems or FROM WorkItemLinks".to_string(),
        ));
    }
    Ok(wiql)
}

fn wiql_queries_source(wiql: &str, source: &str) -> bool {
    let normalized = wiql.to_ascii_lowercase();
    let words: Vec<&str> = normalized.split_whitespace().collect();
    words
        .windows(2)
        .any(|pair| pair[0] == "from" && pair[1] == source)
}

pub(crate) fn is_link_wiql(wiql: &str) -> bool {
    wiql_queries_source(wiql, "workitemlinks")
}

pub(crate) fn work_item_query_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(200).clamp(1, 500)
}

/// Flattens `FROM WorkItemLinks` edges into a deduplicated id list in tree
/// order plus the depth of each id (roots have depth 0).
pub(crate) fn flatten_work_item_links(
    links: Vec<azdo_client::WorkItemLink>,
    limit: usize,
) -> (Vec<i64>, HashMap<i64, u32>) {
    let mut ids: Vec<i64> = Vec::new();
    let mut depth_by_id: HashMap<i64, u32> = HashMap::new();
    for link in links {
        if depth_by_id.contains_key(&link.target_id) {
            continue;
        }
        let depth = link
            .source_id
            .and_then(|source_id| depth_by_id.get(&source_id).copied())
            .map(|parent_depth| parent_depth + 1)
            .unwrap_or(0);
        depth_by_id.insert(link.target_id, depth);
        ids.push(link.target_id);
        if ids.len() >= limit {
            break;
        }
    }
    (ids, depth_by_id)
}
