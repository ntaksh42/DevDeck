use std::collections::HashMap;

use azdo_client::AdoClient;

use super::{
    should_revive, work_item_activity_advanced, SnoozeReconcile, SnoozeService, ITEM_TYPE_WORK_ITEM,
};
use crate::db::CachedWorkItem;
use crate::error::Result;
use crate::sync::SyncBudget;

impl SnoozeService {
    /// Reuses ChangedDate from the assigned-item sync and fetches only the
    /// active snoozes outside that snapshot, even across projects.
    pub(crate) async fn reconcile_work_items(
        &self,
        org_id: &str,
        client: &AdoClient,
        budget: &SyncBudget,
        current: &[CachedWorkItem],
        now: &str,
    ) -> Result<SnoozeReconcile> {
        let rows = self.db.list_snoozed_items(org_id, ITEM_TYPE_WORK_ITEM)?;
        if rows.is_empty() {
            return Ok(SnoozeReconcile::default());
        }

        let mut changes: HashMap<i64, String> = current
            .iter()
            .filter_map(|item| Some((item.id, item.changed_date.clone()?)))
            .collect();
        let outside_cache = rows
            .iter()
            .filter(|row| !should_revive(now, &row.snooze_until, false))
            .filter_map(|row| row.item_key.parse::<i64>().ok())
            .filter(|id| !changes.contains_key(id))
            .collect::<Vec<_>>();
        if !outside_cache.is_empty() {
            let _permit = budget.acquire().await;
            match client
                .get_visible_work_items_batch_org(outside_cache, vec!["System.ChangedDate".into()])
                .await
            {
                Ok(items) => changes.extend(items.into_iter().filter_map(|item| {
                    Some((
                        item.id,
                        item.fields.get("System.ChangedDate")?.as_str()?.to_owned(),
                    ))
                })),
                Err(error) => {
                    tracing::warn!(org_id, %error, "could not refresh snoozed work item activity")
                }
            }
        }

        let mut revived = Vec::new();
        for row in rows {
            let changed = row
                .item_key
                .parse::<i64>()
                .ok()
                .and_then(|id| changes.get(&id));
            let new_activity =
                work_item_activity_advanced(Some(&row.created_at), changed.map(String::as_str))
                    && work_item_activity_advanced(
                        row.baseline_activity.as_deref(),
                        changed.map(String::as_str),
                    );
            if should_revive(now, &row.snooze_until, new_activity)
                && self.db.delete_unchanged_snoozed_item(org_id, &row)?
            {
                revived.push(row.item_key);
            }
        }
        let still_snoozed = self
            .db
            .list_snoozed_items(org_id, ITEM_TYPE_WORK_ITEM)?
            .into_iter()
            .filter(|row| !should_revive(now, &row.snooze_until, false))
            .map(|row| row.item_key)
            .collect();
        Ok(SnoozeReconcile {
            revived,
            still_snoozed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use azdo_client::PatProvider;
    use chrono::{Duration, Utc};
    use std::sync::Arc;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn changed_unassigned_item_returns_but_older_activity_does_not_revive_another() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::db::AppDatabase::new(temp.path().join("devdeck.sqlite3"));
        db.initialize().unwrap();
        db.upsert_organization(crate::db::OrganizationDraft {
            id: "org".into(),
            name: "org".into(),
            display_name: None,
            base_url: "https://dev.azure.com/org".into(),
            auth_provider: "pat".into(),
            credential_key: "org:pat".into(),
            authenticated_user_id: None,
            authenticated_user_display_name: None,
            authenticated_user_unique_name: None,
            provider_kind: "azdo".into(),
        })
        .unwrap();
        let earlier = Utc::now() - Duration::minutes(1);
        let later = Utc::now() + Duration::minutes(1);
        let deadline = Utc::now() + Duration::days(1);
        for id in ["11", "12", "13"] {
            db.upsert_snoozed_item("org", ITEM_TYPE_WORK_ITEM, id, &deadline.to_rfc3339(), None)
                .unwrap();
        }
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/_apis/wit/workitemsbatch"))
            .and(body_json(serde_json::json!({
                "ids": [11, 12, 13], "fields": ["System.ChangedDate"], "errorPolicy": "omit"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "count": 2, "value": [
                    {"id": 11, "fields": {"System.ChangedDate": later.to_rfc3339()}},
                    {"id": 12, "fields": {"System.ChangedDate": earlier.to_rfc3339()}}
                ]
            })))
            .expect(1)
            .mount(&server)
            .await;
        let client = AdoClient::new("org", Arc::new(PatProvider::new("test-pat")))
            .unwrap()
            .with_base_url(url::Url::parse(&format!("{}/", server.uri())).unwrap());
        let budget = Arc::new(tokio::sync::Semaphore::new(1));
        let result = SnoozeService::new(db)
            .reconcile_work_items("org", &client, &budget, &[], &later.to_rfc3339())
            .await
            .unwrap();
        assert_eq!(result.revived, ["11"]);
        assert_eq!(result.still_snoozed, ["12", "13"]);
    }
}
