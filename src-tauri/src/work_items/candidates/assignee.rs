use azdo_client::{IdentityPickerIdentity, WorkItemUpdate};
use serde_json::Value;

use crate::db::MentionHistoryEntry;

use super::super::{MentionCandidate, WorkItemAssigneeCandidate};
use super::identity::{is_azure_devops_service_identity_name, same_optional_mention_value};
use super::mention::mention_candidate_from_identity_picker;

pub(crate) fn assignee_candidate_from_identity_picker(
    identity: IdentityPickerIdentity,
) -> Option<WorkItemAssigneeCandidate> {
    mention_candidate_from_identity_picker(identity).map(assignee_candidate_from_mention)
}

pub(crate) fn assignee_candidates_from_updates(
    updates: Vec<WorkItemUpdate>,
) -> Vec<WorkItemAssigneeCandidate> {
    let mut candidates = Vec::new();
    for update in updates.into_iter().rev() {
        if let Some(identity) = update.revised_by {
            if let Some(candidate) = assignee_candidate_from_comment_identity(identity) {
                push_unique_assignee_candidate(&mut candidates, candidate);
            }
        }
        if let Some(field) = update.fields.get("System.AssignedTo") {
            for value in [&field.new_value, &field.old_value].into_iter().flatten() {
                if let Some(candidate) = assignee_candidate_from_value(value) {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
        }
    }
    candidates
}

pub(crate) fn assignee_candidate_from_comment_identity(
    identity: azdo_client::work_items::CommentIdentityRef,
) -> Option<WorkItemAssigneeCandidate> {
    let display_name = identity
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = identity
        .unique_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    let id = identity
        .id
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(assignee_candidate_from_parts(id, display_name, unique_name))
}

pub(crate) fn assignee_candidate_from_value(value: &Value) -> Option<WorkItemAssigneeCandidate> {
    if let Some(value) = value.as_str() {
        return assignee_candidate_from_identity_string(value);
    }
    let display_name = value
        .get("displayName")
        .or_else(|| value.get("DisplayName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = value
        .get("uniqueName")
        .or_else(|| value.get("UniqueName"))
        .or_else(|| value.get("mailAddress"))
        .or_else(|| value.get("Mail"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    let id = value
        .get("id")
        .or_else(|| value.get("Id"))
        .or_else(|| value.get("descriptor"))
        .or_else(|| value.get("subjectDescriptor"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(assignee_candidate_from_parts(id, display_name, unique_name))
}

pub(crate) fn assignee_candidate_from_identity_string(
    value: &str,
) -> Option<WorkItemAssigneeCandidate> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let (display_name, unique_name) = if let Some((display_name, rest)) = value.rsplit_once('<') {
        let unique_name = rest.strip_suffix('>').map(str::trim);
        (
            display_name.trim().to_string(),
            unique_name
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        )
    } else {
        (value.to_string(), None)
    };
    if display_name.is_empty() {
        return None;
    }
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    Some(assignee_candidate_from_parts(
        unique_name.clone().unwrap_or_else(|| display_name.clone()),
        display_name,
        unique_name,
    ))
}

pub(crate) fn assignee_candidate_from_mention(
    candidate: MentionCandidate,
) -> WorkItemAssigneeCandidate {
    assignee_candidate_from_parts(candidate.id, candidate.display_name, candidate.unique_name)
}

// Unlike mentions, assignment works with "Display <unique_name>" values, so
// entries without a storage-key GUID are still usable.
pub(crate) fn assignee_candidate_from_history(
    entry: MentionHistoryEntry,
) -> WorkItemAssigneeCandidate {
    let id = entry.user_id.unwrap_or_else(|| entry.unique_name.clone());
    assignee_candidate_from_parts(id, entry.display_name, Some(entry.unique_name))
}

pub(crate) fn assignee_candidate_from_parts(
    id: String,
    display_name: String,
    unique_name: Option<String>,
) -> WorkItemAssigneeCandidate {
    let assign_value = unique_name
        .as_deref()
        .map(|unique_name| format!("{display_name} <{unique_name}>"))
        .unwrap_or_else(|| display_name.clone());
    WorkItemAssigneeCandidate {
        id,
        display_name,
        unique_name,
        assign_value,
    }
}

pub(crate) fn assignee_candidate_matches_query(
    candidate: &WorkItemAssigneeCandidate,
    query: &str,
) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    candidate.display_name.to_lowercase().contains(&query)
        || candidate
            .unique_name
            .as_deref()
            .is_some_and(|value| value.to_lowercase().contains(&query))
}

pub(crate) fn push_unique_assignee_candidate(
    candidates: &mut Vec<WorkItemAssigneeCandidate>,
    candidate: WorkItemAssigneeCandidate,
) {
    let duplicate = candidates.iter().any(|existing| {
        existing.id.eq_ignore_ascii_case(&candidate.id)
            || same_optional_mention_value(
                existing.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || existing
                .assign_value
                .eq_ignore_ascii_case(&candidate.assign_value)
    });
    if !duplicate {
        candidates.push(candidate);
    }
}
