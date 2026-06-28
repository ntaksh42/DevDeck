use super::super::*;
use super::*;

pub(crate) fn summarize_work_item_comment(comment: AzdoWorkItemComment) -> WorkItemComment {
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

pub(crate) fn summarize_work_item(
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

pub(crate) fn summarize_work_item_update(update: WorkItemUpdate) -> Option<WorkItemUpdateSummary> {
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

pub(crate) fn summarize_work_item_preview(
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

pub(crate) fn cached_wi_to_summary(wi: CachedWorkItem) -> WorkItemSummary {
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

pub(crate) fn work_item_to_cached(
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
