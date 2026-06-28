use super::super::*;

pub(crate) fn string_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::String(value) => Some(value.clone()),
        value if value.is_number() || value.is_boolean() => Some(value.to_string()),
        _ => None,
    }
}

pub(crate) fn first_string_field(work_item: &WorkItem, fields: &[&str]) -> Option<String> {
    fields
        .iter()
        .filter_map(|field| string_field(work_item, field))
        .find(|value| !value.trim().is_empty())
}

pub(crate) fn identity_field(work_item: &WorkItem, field: &str) -> Option<String> {
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

pub(crate) fn identity_unique_name_field(work_item: &WorkItem, field: &str) -> Option<String> {
    match work_item.fields.get(field)? {
        Value::Object(map) => map
            .get("uniqueName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
}

pub(crate) fn update_value_string(value: &Value) -> Option<String> {
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

const MAX_EXTRA_QUERY_FIELDS: usize = 20;

pub(crate) fn sanitize_extra_query_fields(extra_fields: Option<&[String]>) -> Vec<String> {
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

pub(crate) fn extra_work_item_fields(
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

pub(crate) fn preview_fields(custom_fields: Option<&[String]>) -> Vec<String> {
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

pub(crate) fn custom_work_item_fields(work_item: &WorkItem) -> Vec<WorkItemCustomField> {
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
pub(crate) fn validate_update_field_reference_name(value: &str) -> Result<&str> {
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

pub(crate) fn validate_editable_field_reference_name(value: &str) -> Result<&str> {
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

pub(crate) fn is_valid_field_reference_name(value: &str) -> bool {
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

pub(crate) fn work_item_web_url(
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
