//! Persists each view query's last result so a view opens with the rows it
//! showed last time (even after a restart) while the query runs again.

use chrono::Utc;
use serde::Serialize;

use crate::error::Result;

use super::{RunWorkItemQueryInput, WorkItemService, WorkItemSummary};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedWorkItemQueryResult {
    /// The `WorkItemSummary` rows exactly as `run_work_item_query` returned them.
    pub items: serde_json::Value,
    pub fetched_at: String,
}

/// Identifies one query: the same project, WIQL, limit and extra fields give
/// the same rows, whichever view runs it.
pub(crate) fn query_signature(input: &RunWorkItemQueryInput) -> String {
    let limit = input.limit.map(|l| l.to_string()).unwrap_or_default();
    let extra = input.extra_fields.as_deref().unwrap_or_default().join("|");
    serde_json::json!([input.project_id, input.wiql.trim(), limit, extra]).to_string()
}

impl WorkItemService {
    pub fn cached_query(
        &self,
        input: RunWorkItemQueryInput,
    ) -> Result<Option<CachedWorkItemQueryResult>> {
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let Some((json, fetched_at)) = self
            .db
            .get_work_item_view_result(&organization.id, &query_signature(&input))?
        else {
            return Ok(None);
        };
        // A row written by an older shape is just a cache miss.
        Ok(serde_json::from_str(&json)
            .ok()
            .map(|items| CachedWorkItemQueryResult { items, fetched_at }))
    }

    /// Best effort: a failed write only means the next open waits for the query.
    pub(super) fn remember_query_result(
        &self,
        input: &RunWorkItemQueryInput,
        items: &[WorkItemSummary],
    ) {
        let json = match serde_json::to_string(items) {
            Ok(json) => json,
            Err(error) => {
                tracing::warn!(error = ?error, "failed to encode work item view result");
                return;
            }
        };
        let saved = self
            .db
            .resolve_organization(input.organization_id.as_deref())
            .and_then(|organization| {
                self.db.save_work_item_view_result(
                    &organization.id,
                    &query_signature(input),
                    &json,
                    &Utc::now().to_rfc3339(),
                )
            });
        if let Err(error) = saved {
            tracing::warn!(error = ?error, "failed to cache work item view result");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(wiql: &str, extra: Option<Vec<String>>) -> RunWorkItemQueryInput {
        RunWorkItemQueryInput {
            organization_id: Some("org".into()),
            project_id: "p1".into(),
            wiql: wiql.into(),
            limit: Some(200),
            extra_fields: extra,
        }
    }

    #[test]
    fn signature_changes_with_the_query_but_not_surrounding_whitespace() {
        let base = query_signature(&input("SELECT 1", None));
        assert_eq!(base, query_signature(&input("  SELECT 1\n", None)));
        assert_ne!(base, query_signature(&input("SELECT 2", None)));
        assert_ne!(
            base,
            query_signature(&input("SELECT 1", Some(vec!["Custom.Field".into()])))
        );
    }
}
