//! Pure conversions between Azure DevOps REST payloads and the work item DTOs
//! returned over IPC: summaries, previews, update history, custom fields, and
//! the field-reference / image-content-type validation helpers.

use super::*;

pub(super) fn summarize_work_item_comment(comment: AzdoWorkItemComment) -> WorkItemComment {
    let (created_by, created_by_id, created_by_unique_name) = comment
        .created_by
        .map(|identity| {
            let created_by = identity
                .display_name
                .clone()
                .or_else(|| identity.unique_name.clone());
            (created_by, identity.id, identity.unique_name)
        })
        .unwrap_or((None, None, None));

    let reactions = comment
        .reactions
        .into_iter()
        .map(|reaction| CommentReactionSummary {
            reaction_type: reaction.reaction_type,
            count: reaction.count,
            is_mine: reaction.is_current_user_engaged,
        })
        .collect();

    WorkItemComment {
        id: comment.id,
        text: comment.text,
        rendered_text: comment.rendered_text,
        created_by,
        created_by_id,
        created_by_unique_name,
        created_date: comment.created_date,
        reactions,
    }
}

/// Trims and drops blank entries from a multi-value filter, returning `None`
/// when nothing is left so callers can treat "no values" as "no filter".
pub(super) fn normalize_filter_set(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let cleaned: Vec<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// Membership test for an optional multi-value filter: `None` (no filter)
/// matches everything; otherwise the value must be present in the set.
pub(super) fn filter_matches(filter: &Option<Vec<String>>, value: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(values) => value.is_some_and(|value| values.iter().any(|f| f == value)),
    }
}

pub(super) fn summarize_work_item(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
) -> WorkItemSummary {
    WorkItemSummary {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: work_item.id,
        title: string_field(&work_item, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(&work_item, "System.WorkItemType"),
        state: string_field(&work_item, "System.State"),
        assigned_to: identity_field(&work_item, "System.AssignedTo"),
        changed_date: string_field(&work_item, "System.ChangedDate"),
        web_url: work_item_web_url(organization, project_name, work_item.id, &work_item),
        extra_fields: Vec::new(),
        depth: None,
    }
}

const MAX_EXTRA_QUERY_FIELDS: usize = 20;

pub(super) fn sanitize_extra_query_fields(extra_fields: Option<&[String]>) -> Vec<String> {
    let mut fields: Vec<String> = Vec::new();
    for field in extra_fields.unwrap_or_default() {
        let field = field.trim();
        if !is_valid_field_reference_name(field) {
            continue;
        }
        if WORK_ITEM_FIELDS
            .iter()
            .any(|standard| standard.eq_ignore_ascii_case(field))
            || fields
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(field))
        {
            continue;
        }
        fields.push(field.to_string());
        if fields.len() >= MAX_EXTRA_QUERY_FIELDS {
            break;
        }
    }
    fields
}

pub(super) fn extra_work_item_fields(
    work_item: &WorkItem,
    extra_fields: &[String],
) -> Vec<WorkItemCustomField> {
    extra_fields
        .iter()
        .map(|reference_name| WorkItemCustomField {
            reference_name: reference_name.clone(),
            value: string_field(work_item, reference_name)
                .or_else(|| identity_field(work_item, reference_name)),
        })
        .collect()
}

/// Bookkeeping fields that change on every revision and add no review value.
const WORK_ITEM_HISTORY_HIDDEN_FIELDS: &[&str] = &[
    "System.Rev",
    "System.AuthorizedDate",
    "System.RevisedDate",
    "System.Watermark",
    "System.AuthorizedAs",
    "System.PersonId",
    "System.ChangedDate",
    "System.ChangedBy",
    "System.CommentCount",
    "System.IterationId",
    "System.AreaId",
    "System.NodeName",
];

pub(super) fn update_value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        Value::Object(map) => map
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| map.get("uniqueName").and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

pub(super) fn summarize_work_item_update(update: WorkItemUpdate) -> Option<WorkItemUpdateSummary> {
    let mut changes: Vec<WorkItemFieldChange> = update
        .fields
        .iter()
        .filter(|(reference_name, _)| {
            !WORK_ITEM_HISTORY_HIDDEN_FIELDS
                .iter()
                .any(|hidden| hidden.eq_ignore_ascii_case(reference_name))
        })
        .map(|(reference_name, change)| WorkItemFieldChange {
            reference_name: reference_name.clone(),
            old_value: change.old_value.as_ref().and_then(update_value_string),
            new_value: change.new_value.as_ref().and_then(update_value_string),
        })
        .filter(|change| {
            change.old_value != change.new_value
                && (change.old_value.is_some() || change.new_value.is_some())
        })
        .collect();
    if changes.is_empty() {
        return None;
    }
    changes.sort_by(|a, b| a.reference_name.cmp(&b.reference_name));

    // revisedDate is a 9999-01-01 sentinel on the latest revision; prefer the
    // System.ChangedDate value recorded by the update itself.
    let revised_date = update
        .fields
        .get("System.ChangedDate")
        .and_then(|change| change.new_value.as_ref())
        .and_then(update_value_string)
        .or_else(|| update.revised_date.filter(|date| !date.starts_with("9999")));

    Some(WorkItemUpdateSummary {
        id: update.id,
        revised_by: update
            .revised_by
            .and_then(|identity| identity.display_name.or(identity.unique_name)),
        revised_date,
        changes,
    })
}

pub(super) fn summarize_work_item_preview(
    organization: &Organization,
    project_id: &str,
    project_name: &str,
    work_item: WorkItem,
    comments: Vec<AzdoWorkItemComment>,
) -> WorkItemPreview {
    let web_url = work_item_web_url(organization, project_name, work_item.id, &work_item);

    let custom_fields = custom_work_item_fields(&work_item);

    WorkItemPreview {
        organization_id: organization.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: work_item.id,
        title: string_field(&work_item, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(&work_item, "System.WorkItemType"),
        state: string_field(&work_item, "System.State"),
        assigned_to: identity_field(&work_item, "System.AssignedTo"),
        assigned_to_unique_name: identity_unique_name_field(&work_item, "System.AssignedTo"),
        created_by: identity_field(&work_item, "System.CreatedBy"),
        created_date: string_field(&work_item, "System.CreatedDate"),
        changed_date: string_field(&work_item, "System.ChangedDate"),
        area_path: string_field(&work_item, "System.AreaPath"),
        iteration_path: string_field(&work_item, "System.IterationPath"),
        reason: string_field(&work_item, "System.Reason"),
        tags: string_field(&work_item, "System.Tags"),
        priority: string_field(&work_item, "Microsoft.VSTS.Common.Priority"),
        severity: string_field(&work_item, "Microsoft.VSTS.Common.Severity"),
        story_points: string_field(&work_item, "Microsoft.VSTS.Scheduling.StoryPoints"),
        remaining_work: string_field(&work_item, "Microsoft.VSTS.Scheduling.RemainingWork"),
        description_html: first_string_field(
            &work_item,
            &[
                "System.Description",
                "Microsoft.VSTS.TCM.ReproSteps",
                "Microsoft.VSTS.CMMI.Symptom",
            ],
        ),
        acceptance_criteria_html: string_field(
            &work_item,
            "Microsoft.VSTS.Common.AcceptanceCriteria",
        ),
        custom_fields,
        web_url,
        comments: comments
            .into_iter()
            .map(summarize_work_item_comment)
            .collect(),
        comments_unavailable: false,
        relations: Vec::new(),
        pull_requests: Vec::new(),
        attachments: Vec::new(),
    }
}

/// Extracts attached files (`AttachedFile` relations) for the preview, newest
/// last as Azure DevOps returns them. The display name comes from the relation
/// attributes, falling back to the URL's last segment.
pub(super) fn extract_attachments(raw_relations: &[WorkItemRelation]) -> Vec<WorkItemAttachment> {
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
pub(super) fn pull_request_id_from_artifact(url: &str) -> Option<i64> {
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
pub(super) fn link_type_to_rel(link_type: &str) -> Option<&'static str> {
    match link_type.trim().to_ascii_lowercase().as_str() {
        "parent" => Some("System.LinkTypes.Hierarchy-Reverse"),
        "child" => Some("System.LinkTypes.Hierarchy-Forward"),
        "related" => Some("System.LinkTypes.Related"),
        "successor" => Some("System.LinkTypes.Dependency-Forward"),
        "predecessor" => Some("System.LinkTypes.Dependency-Reverse"),
        _ => None,
    }
}

pub(super) fn relation_type_label(rel: &str) -> (String, u8) {
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
pub(super) fn prioritized_relation_links(
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

pub(super) fn related_work_item_id(url: &str) -> Option<i64> {
    let lowered = url.to_ascii_lowercase();
    if !lowered.contains("/_apis/wit/workitems/") {
        return None;
    }
    url.rsplit('/').next()?.parse::<i64>().ok()
}

pub(super) fn preview_fields(custom_fields: Option<&[String]>) -> Vec<String> {
    let mut fields: Vec<String> = WORK_ITEM_PREVIEW_FIELDS
        .iter()
        .map(ToString::to_string)
        .collect();
    if let Some(custom_fields) = custom_fields {
        for field in custom_fields {
            let field = field.trim();
            if !is_valid_field_reference_name(field) {
                continue;
            }
            if fields
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(field))
            {
                continue;
            }
            fields.push(field.to_string());
            if fields.len() >= WORK_ITEM_PREVIEW_FIELDS.len() + 20 {
                break;
            }
        }
    }
    fields
}

pub(super) fn custom_work_item_fields(work_item: &WorkItem) -> Vec<WorkItemCustomField> {
    let mut fields = work_item
        .fields
        .keys()
        .filter(|field| {
            !WORK_ITEM_PREVIEW_FIELDS
                .iter()
                .any(|standard| standard.eq_ignore_ascii_case(field))
        })
        .filter(|field| is_valid_field_reference_name(field))
        .map(|reference_name| WorkItemCustomField {
            reference_name: reference_name.clone(),
            value: string_field(work_item, reference_name),
        })
        .collect::<Vec<_>>();
    fields.sort_by(|left, right| left.reference_name.cmp(&right.reference_name));
    fields
}

/// Generic field updates are restricted to non-System fields; System.* edits
/// go through the dedicated state/assignee/reason commands.
// The combined update accepts the System fields the staging UI edits plus
// anything `validate_editable_field_reference_name` allows for custom fields.
pub(super) fn validate_update_field_reference_name(value: &str) -> Result<&str> {
    const ALLOWED_SYSTEM_FIELDS: &[&str] = &[
        "System.Title",
        "System.State",
        "System.Reason",
        "System.AssignedTo",
        "System.Tags",
        "System.AreaPath",
        "System.IterationPath",
    ];
    let field = value.trim();
    if let Some(allowed) = ALLOWED_SYSTEM_FIELDS
        .iter()
        .copied()
        .find(|allowed| allowed.eq_ignore_ascii_case(field))
    {
        return Ok(allowed);
    }
    validate_editable_field_reference_name(field)
}

pub(super) fn validate_editable_field_reference_name(value: &str) -> Result<&str> {
    let field = value.trim();
    if !is_valid_field_reference_name(field) {
        return Err(AppError::InvalidInput(format!(
            "invalid field reference name: {value}"
        )));
    }
    if field.to_ascii_lowercase().starts_with("system.") {
        return Err(AppError::InvalidInput(
            "System fields cannot be edited as custom fields".to_string(),
        ));
    }
    Ok(field)
}

pub(super) fn is_valid_field_reference_name(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || !value.contains('.') {
        return false;
    }
    value.split('.').all(|part| {
        let mut chars = part.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

pub(super) fn work_item_web_url(
    organization: &Organization,
    project_name: &str,
    work_item_id: i64,
    work_item: &WorkItem,
) -> Option<String> {
    work_item
        .links
        .as_ref()
        .and_then(|links| links.html.as_ref().map(|html| html.href.clone()))
        .or_else(|| {
            Some(format!(
                "https://dev.azure.com/{}/{}/_workitems/edit/{}",
                organization.name,
                encode_path_segment(project_name),
                work_item_id
            ))
        })
}

pub(super) fn string_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn first_string_field(work_item: &WorkItem, fields: &[&str]) -> Option<String> {
    fields
        .iter()
        .filter_map(|field| string_field(work_item, field))
        .find(|value| !value.trim().is_empty())
}

pub(super) fn identity_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        Value::Object(map) => map
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| map.get("uniqueName").and_then(Value::as_str))
            .map(ToString::to_string),
        _ => None,
    }
}

pub(super) fn identity_unique_name_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::Object(map) => map
            .get("uniqueName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
}

pub(super) fn normalize_image_content_type(content_type: &str) -> Option<&'static str> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match media_type.as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/svg+xml" => Some("image/svg+xml"),
        "image/bmp" => Some("image/bmp"),
        _ => None,
    }
}

pub(super) fn image_content_type_from_url(url: &str) -> Option<&'static str> {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".png") {
        Some("image/png")
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if path.ends_with(".gif") {
        Some("image/gif")
    } else if path.ends_with(".webp") {
        Some("image/webp")
    } else if path.ends_with(".svg") {
        Some("image/svg+xml")
    } else if path.ends_with(".bmp") {
        Some("image/bmp")
    } else {
        None
    }
}

pub(super) fn cached_wi_to_summary(wi: CachedWorkItem) -> WorkItemSummary {
    WorkItemSummary {
        organization_id: wi.org_id,
        project_id: wi.project_id,
        project_name: wi.project_name,
        id: wi.id,
        title: wi.title,
        work_item_type: wi.work_item_type,
        state: wi.state,
        assigned_to: wi.assigned_to,
        changed_date: wi.changed_date,
        web_url: wi.web_url,
        extra_fields: Vec::new(),
        depth: None,
    }
}

pub(super) fn work_item_to_cached(
    org: &Organization,
    project_id: &str,
    project_name: &str,
    wi: &WorkItem,
) -> CachedWorkItem {
    let web_url = format!(
        "{}/{}/_workitems/edit/{}",
        org.base_url,
        encode_path_segment(project_name),
        wi.id
    );
    CachedWorkItem {
        org_id: org.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        id: wi.id,
        title: string_field(wi, "System.Title").unwrap_or_else(|| "(untitled)".to_string()),
        work_item_type: string_field(wi, "System.WorkItemType"),
        state: string_field(wi, "System.State"),
        assigned_to: identity_field(wi, "System.AssignedTo"),
        assigned_to_unique_name: identity_unique_name_field(wi, "System.AssignedTo"),
        changed_date: string_field(wi, "System.ChangedDate"),
        web_url: Some(web_url),
    }
}
