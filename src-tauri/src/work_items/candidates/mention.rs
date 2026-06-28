use azdo_client::{Identity, IdentityPickerIdentity};

use crate::db::MentionHistoryEntry;

use super::super::{MentionCandidate, WorkItemAssigneeCandidate};
use super::identity::{
    both_unique_names_differ, is_azure_devops_service_identity_name, is_mention_resolvable_id,
    is_user_like_identity, same_optional_mention_value,
};

pub(crate) fn summarize_mention_candidate(identity: Identity) -> Option<MentionCandidate> {
    if !is_user_like_identity(&identity) {
        return None;
    }
    let id = identity
        .id
        .clone()
        .or_else(|| identity.subject_descriptor.clone())
        .or_else(|| identity.descriptor.clone())?;
    let unique_name = identity
        .unique_name
        .clone()
        .or_else(|| identity.property_value("Mail").map(ToString::to_string))
        .or_else(|| identity.property_value("Account").map(ToString::to_string));
    let display_name = identity
        .provider_display_name
        .or(identity.custom_display_name)
        .or(identity.display_name)
        .or_else(|| unique_name.clone())?;
    Some(MentionCandidate {
        id,
        display_name,
        unique_name,
    })
}

pub(crate) fn mention_candidate_from_identity_picker(
    identity: IdentityPickerIdentity,
) -> Option<MentionCandidate> {
    if identity.active == Some(false) {
        return None;
    }
    if identity
        .entity_type
        .as_deref()
        .is_some_and(|value| !value.eq_ignore_ascii_case("User"))
    {
        return None;
    }
    let display_name = identity
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let unique_name = identity
        .mail_address
        .or(identity.sign_in_address)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if is_azure_devops_service_identity_name(&display_name, unique_name.as_deref()) {
        return None;
    }
    // Markdown mentions are only resolved by Azure DevOps when the token is
    // the identity's storage-key GUID (localId); descriptors like "aad.xxx"
    // are silently dropped from the posted comment. Prefer GUID-shaped ids.
    let id = identity
        .local_id
        .or(identity.entity_id)
        .or(identity.origin_id)
        .or(identity.subject_descriptor)
        .or_else(|| unique_name.clone())
        .unwrap_or_else(|| display_name.clone());
    Some(MentionCandidate {
        id,
        display_name,
        unique_name,
    })
}

pub(crate) fn mention_candidate_from_assignee(
    candidate: WorkItemAssigneeCandidate,
) -> MentionCandidate {
    MentionCandidate {
        id: candidate.id,
        display_name: candidate.display_name,
        unique_name: candidate.unique_name,
    }
}

pub(crate) fn mention_candidate_from_history(
    entry: MentionHistoryEntry,
) -> Option<MentionCandidate> {
    // Only entries with a storage-key GUID produce working @<id> mentions;
    // legacy rows recorded with descriptors or e-mails must not shadow
    // identity-picker results that carry a usable id.
    let id = entry.user_id.filter(|id| is_mention_resolvable_id(id))?;
    Some(MentionCandidate {
        id,
        display_name: entry.display_name,
        unique_name: Some(entry.unique_name),
    })
}

pub(crate) fn mention_candidate_matches_query(
    display_name: &str,
    unique_name: Option<&str>,
    query: &str,
) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    display_name.to_lowercase().contains(&query)
        || unique_name
            .map(|value| value.to_lowercase().contains(&query))
            .unwrap_or(false)
}

pub(crate) fn push_unique_mention_candidate(
    candidates: &mut Vec<MentionCandidate>,
    candidate: MentionCandidate,
) {
    let duplicate = candidates.iter().any(|existing| {
        existing.id.eq_ignore_ascii_case(&candidate.id)
            || same_optional_mention_value(
                existing.unique_name.as_deref(),
                candidate.unique_name.as_deref(),
            )
            || (existing
                .display_name
                .eq_ignore_ascii_case(&candidate.display_name)
                && !both_unique_names_differ(
                    existing.unique_name.as_deref(),
                    candidate.unique_name.as_deref(),
                ))
    });
    if !duplicate {
        candidates.push(candidate);
    }
}
