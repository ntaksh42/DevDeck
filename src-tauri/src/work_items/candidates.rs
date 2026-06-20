//! Conversion and de-duplication helpers for @mention and assignee candidates.
//!
//! These translate the various identity shapes Azure DevOps returns (identity
//! picker results, work item update history, comment authors, stored mention
//! history) into the `MentionCandidate` / `WorkItemAssigneeCandidate` DTOs, and
//! enforce the rules around which identities are real, mentionable users.

use std::time::Instant;

use azdo_client::{AdoClient, Identity, IdentityPickerIdentity, WorkItemUpdate};
use chrono::Utc;
use serde_json::Value;

use crate::auth::client_for_organization;
use crate::db::{MentionHistoryEntry, Organization};
use crate::error::Result;

use super::{
    MentionCandidate, RecordAssigneeInteractionInput, RecordMentionInteractionInput,
    SearchWorkItemAssigneesInput, SearchWorkItemMentionsInput, WorkItemAssigneeCandidate,
    WorkItemService, UPDATE_CANDIDATES_CACHE_CAP, UPDATE_CANDIDATES_TTL,
};

/// Search the identity picker and map each result, falling back to the
/// identities API (mapped through `fallback`) when the picker call fails.
///
/// `search_mentions` and `search_assignees` share this exact control flow;
/// only the per-identity mappers differ.
async fn search_identity_picker_with_fallback<T, P, F>(
    client: &AdoClient,
    query: &str,
    limit: usize,
    picker: P,
    fallback: F,
) -> Result<Vec<T>>
where
    P: FnMut(IdentityPickerIdentity) -> Option<T>,
    F: FnMut(Identity) -> Option<T>,
{
    match client.search_identity_picker(query, limit).await {
        Ok(identities) => Ok(identities.into_iter().filter_map(picker).collect()),
        Err(error) => {
            tracing::warn!(%error, "identity picker search failed; falling back to identities API");
            Ok(client
                .search_identities(query, limit)
                .await?
                .into_iter()
                .filter_map(fallback)
                .collect())
        }
    }
}

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

pub(super) fn mention_candidate_from_identity_picker(
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

pub(super) fn assignee_candidate_from_identity_picker(
    identity: IdentityPickerIdentity,
) -> Option<WorkItemAssigneeCandidate> {
    mention_candidate_from_identity_picker(identity).map(assignee_candidate_from_mention)
}

pub(super) fn assignee_candidates_from_updates(
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

pub(super) fn assignee_candidate_from_comment_identity(
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

pub(super) fn assignee_candidate_from_value(value: &Value) -> Option<WorkItemAssigneeCandidate> {
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

pub(super) fn assignee_candidate_from_identity_string(
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

pub(super) fn assignee_candidate_from_mention(
    candidate: MentionCandidate,
) -> WorkItemAssigneeCandidate {
    assignee_candidate_from_parts(candidate.id, candidate.display_name, candidate.unique_name)
}

pub(super) fn mention_candidate_from_assignee(
    candidate: WorkItemAssigneeCandidate,
) -> MentionCandidate {
    MentionCandidate {
        id: candidate.id,
        display_name: candidate.display_name,
        unique_name: candidate.unique_name,
    }
}

// Unlike mentions, assignment works with "Display <unique_name>" values, so
// entries without a storage-key GUID are still usable.
pub(super) fn assignee_candidate_from_history(
    entry: MentionHistoryEntry,
) -> WorkItemAssigneeCandidate {
    let id = entry.user_id.unwrap_or_else(|| entry.unique_name.clone());
    assignee_candidate_from_parts(id, entry.display_name, Some(entry.unique_name))
}

pub(super) fn mention_candidate_from_history(
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

/// Azure DevOps resolves markdown mentions only for storage-key GUIDs.
pub(super) fn is_mention_resolvable_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

pub(super) fn is_authenticated_user(
    id: &str,
    display_name: &str,
    unique_name: Option<&str>,
    organization: &Organization,
) -> bool {
    let uid = organization.authenticated_user_id.as_deref().unwrap_or("");
    let self_unique = organization
        .authenticated_user_unique_name
        .as_deref()
        .unwrap_or("");
    let dn = organization
        .authenticated_user_display_name
        .as_deref()
        .unwrap_or("");
    if !uid.is_empty()
        && (id.eq_ignore_ascii_case(uid)
            || unique_name.is_some_and(|un| un.eq_ignore_ascii_case(uid)))
    {
        return true;
    }
    if !self_unique.is_empty() && unique_name.is_some_and(|un| un.eq_ignore_ascii_case(self_unique))
    {
        return true;
    }
    if !dn.is_empty() && display_name.eq_ignore_ascii_case(dn) {
        // Same display name, but a unique name that provably belongs to
        // someone else: do not treat a namesake as the authenticated user.
        let provably_different = !self_unique.is_empty()
            && unique_name.is_some_and(|un| !un.eq_ignore_ascii_case(self_unique));
        return !provably_different;
    }
    false
}

pub(super) fn assignee_candidate_from_parts(
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

pub(super) fn assignee_candidate_matches_query(
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

pub(super) fn push_unique_assignee_candidate(
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

pub(super) fn is_user_like_identity(identity: &Identity) -> bool {
    let schema = identity.property_value("SchemaClassName");
    let special_type = identity.property_value("SpecialType");
    let meta_type = identity.property_value("MetaType");
    let active = identity.property_value("Active");
    let domain = identity.property_value("Domain");
    let account = identity.property_value("Account");
    let has_mail_or_account = identity.property_value("Mail").is_some()
        || account.is_some()
        || identity
            .unique_name
            .as_deref()
            .is_some_and(|value| value.contains('@'));

    if is_azure_devops_service_identity(identity, domain, account) {
        return false;
    }
    if active.is_some_and(|value| value.eq_ignore_ascii_case("false")) {
        return false;
    }
    if schema.is_some_and(|value| !value.eq_ignore_ascii_case("User")) {
        return false;
    }
    if special_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }
    if meta_type.is_some_and(|value| {
        value.eq_ignore_ascii_case("Application") || value.eq_ignore_ascii_case("ServicePrincipal")
    }) {
        return false;
    }

    schema.is_some() || has_mail_or_account || identity.id.is_some()
}

pub(super) fn is_azure_devops_service_identity(
    identity: &Identity,
    domain: Option<&str>,
    account: Option<&str>,
) -> bool {
    let service_domain = domain.is_some_and(|value| {
        value.eq_ignore_ascii_case("Build") || value.eq_ignore_ascii_case("AgentPool")
    });
    let service_account = account.is_some_and(|value| {
        let value = value.to_lowercase();
        value.starts_with("build\\")
            || value.starts_with("agentpool\\")
            || value == "project collection build service"
    });
    let service_display = [
        identity.provider_display_name.as_deref(),
        identity.custom_display_name.as_deref(),
        identity.display_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| is_azure_devops_service_identity_name(value, None));

    service_domain || service_account || service_display
}

pub(super) fn is_azure_devops_service_identity_name(
    display_name: &str,
    unique_name: Option<&str>,
) -> bool {
    let display_name = display_name.to_lowercase();
    display_name.contains(" build service (")
        || display_name.starts_with("agent pool service")
        || unique_name.is_some_and(|value| {
            let value = value.to_lowercase();
            value.starts_with("build\\")
                || value.starts_with("agentpool\\")
                || value.eq_ignore_ascii_case("Project Collection Build Service")
        })
}

pub(super) fn mention_candidate_matches_query(
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

pub(super) fn push_unique_mention_candidate(
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

pub(super) fn same_optional_mention_value(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    }
}

/// Returns true only when both sides have a unique_name and they differ — the only
/// case where same display_name candidates are definitively distinct people.
pub(super) fn both_unique_names_differ(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(l), Some(r)) => !l.eq_ignore_ascii_case(r),
        _ => false,
    }
}

impl WorkItemService {
    pub(super) async fn update_candidates(
        &self,
        client: &AdoClient,
        org_id: &str,
        project_id: &str,
        work_item_id: i64,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        let key = (org_id.to_string(), project_id.to_string(), work_item_id);
        {
            let cache = self.update_candidates.lock().await;
            if let Some((fetched_at, candidates)) = cache.get(&key) {
                if fetched_at.elapsed() < UPDATE_CANDIDATES_TTL {
                    return Ok(candidates.clone());
                }
            }
        }
        // Run the HTTP request without holding the lock so candidate fetches
        // for different work items are not serialized behind one another.
        let updates = client
            .list_work_item_updates(project_id, work_item_id, 50)
            .await?;
        let candidates = assignee_candidates_from_updates(updates);
        let mut cache = self.update_candidates.lock().await;
        if cache.len() >= UPDATE_CANDIDATES_CACHE_CAP {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), candidates.clone()));
        Ok(candidates)
    }

    pub fn record_mention_interaction(&self, input: RecordMentionInteractionInput) -> Result<()> {
        let unique_name = input.unique_name.trim();
        let display_name = input.display_name.trim();
        if unique_name.is_empty() || display_name.is_empty() {
            return Ok(());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let now = Utc::now().to_rfc3339();
        self.db.record_mention_interaction(
            &organization.id,
            unique_name,
            display_name,
            input.user_id.as_deref(),
            &now,
        )
    }

    pub fn record_assignee_interaction(&self, input: RecordAssigneeInteractionInput) -> Result<()> {
        let unique_name = input.unique_name.trim();
        let display_name = input.display_name.trim();
        if unique_name.is_empty() || display_name.is_empty() {
            return Ok(());
        }
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let now = Utc::now().to_rfc3339();
        self.db.record_assignee_interaction(
            &organization.id,
            unique_name,
            display_name,
            input.user_id.as_deref(),
            &now,
        )
    }

    pub async fn search_mentions(
        &self,
        input: SearchWorkItemMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        let query = input.query.trim();
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut candidates = Vec::new();

        match self
            .update_candidates(
                &client,
                &organization.id,
                &input.project_id,
                input.work_item_id,
            )
            .await
        {
            Ok(update_candidates) => {
                for candidate in update_candidates
                    .into_iter()
                    .map(mention_candidate_from_assignee)
                {
                    push_unique_mention_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load work item updates for mention candidates");
            }
        }

        match self.db.list_mention_history(&organization.id, 20) {
            Ok(entries) => {
                for candidate in entries
                    .into_iter()
                    .filter_map(mention_candidate_from_history)
                {
                    push_unique_mention_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load mention history for mention candidates");
            }
        }

        if !query.is_empty() {
            let picker_candidates = search_identity_picker_with_fallback(
                &client,
                query,
                40,
                mention_candidate_from_identity_picker,
                summarize_mention_candidate,
            )
            .await?;
            for candidate in picker_candidates {
                push_unique_mention_candidate(&mut candidates, candidate);
            }
        }

        // The signed-in user goes last instead of being removed: in a
        // single-member organization removing self would leave the picker
        // permanently empty, and mentioning yourself is legitimate.
        let mut results: Vec<MentionCandidate> = candidates
            .into_iter()
            .filter(|c| {
                mention_candidate_matches_query(&c.display_name, c.unique_name.as_deref(), query)
            })
            .collect();
        results.sort_by_key(|c| {
            is_authenticated_user(
                &c.id,
                &c.display_name,
                c.unique_name.as_deref(),
                &organization,
            )
        });
        results.truncate(8);
        Ok(results)
    }

    pub async fn search_assignees(
        &self,
        input: SearchWorkItemAssigneesInput,
    ) -> Result<Vec<WorkItemAssigneeCandidate>> {
        let query = input.query.trim();
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let mut candidates = Vec::new();

        match self
            .update_candidates(
                &client,
                &organization.id,
                &input.project_id,
                input.work_item_id,
            )
            .await
        {
            Ok(update_candidates) => {
                for candidate in update_candidates {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load work item updates for assignee candidates");
            }
        }

        match self.db.list_assignee_history(&organization.id, 20) {
            Ok(entries) => {
                for candidate in entries.into_iter().map(assignee_candidate_from_history) {
                    push_unique_assignee_candidate(&mut candidates, candidate);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to load assignee history for assignee candidates");
            }
        }

        if !query.is_empty() {
            let picker_candidates = search_identity_picker_with_fallback(
                &client,
                query,
                40,
                assignee_candidate_from_identity_picker,
                |identity| {
                    summarize_mention_candidate(identity).map(assignee_candidate_from_mention)
                },
            )
            .await?;
            for candidate in picker_candidates {
                push_unique_assignee_candidate(&mut candidates, candidate);
            }
        }

        // Keep self in the list (last) so assigning to yourself stays
        // possible; see search_mentions for the rationale.
        let mut results: Vec<WorkItemAssigneeCandidate> = candidates
            .into_iter()
            .filter(|candidate| candidate.unique_name.is_some())
            .filter(|candidate| assignee_candidate_matches_query(candidate, query))
            .collect();
        results.sort_by_key(|c| {
            is_authenticated_user(
                &c.id,
                &c.display_name,
                c.unique_name.as_deref(),
                &organization,
            )
        });
        results.truncate(8);
        Ok(results)
    }
}
