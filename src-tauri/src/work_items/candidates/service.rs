use std::time::Instant;

use azdo_client::AdoClient;
use chrono::Utc;

use crate::auth::client_for_organization;
use crate::error::Result;

use super::super::{
    MentionCandidate, RecordAssigneeInteractionInput, RecordMentionInteractionInput,
    SearchWorkItemAssigneesInput, SearchWorkItemMentionsInput, WorkItemAssigneeCandidate,
    WorkItemService, UPDATE_CANDIDATES_CACHE_CAP, UPDATE_CANDIDATES_TTL,
};
use super::{
    assignee_candidate_from_history, assignee_candidate_from_identity_picker,
    assignee_candidate_from_mention, assignee_candidate_matches_query,
    assignee_candidates_from_updates, is_authenticated_user, mention_candidate_from_assignee,
    mention_candidate_from_history, mention_candidate_from_identity_picker,
    mention_candidate_matches_query, push_unique_assignee_candidate, push_unique_mention_candidate,
    search_identity_picker_with_fallback, summarize_mention_candidate,
};

impl WorkItemService {
    pub(in crate::work_items) async fn update_candidates(
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
