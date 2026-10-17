use azdo_client::AdoClient;
use tokio::task::JoinSet;

use super::notifications::{notification_allowed, pr_notification_records};
use super::{PrNotificationItem, PrNotificationKind, SyncBudget};
use crate::db::{AppDatabase, AppSettings, Organization};
use crate::error::Result;

pub(super) async fn collect_ready_prs(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    settings: &AppSettings,
    budget: &SyncBudget,
    snoozed: &std::collections::HashSet<String>,
) -> Result<Vec<PrNotificationItem>> {
    let Some(user) = org.authenticated_user_id.as_deref() else {
        return Ok(Vec::new());
    };
    let mut tasks = JoinSet::new();
    for row in db.list_created_pull_requests(&org.id, user)? {
        let pr = row.pr;
        let client = client.clone();
        let budget = budget.clone();
        tasks.spawn(async move {
            let _permit = budget.acquire().await.expect("sync budget closed");
            let result = client
                .is_pull_request_ready_to_merge(
                    &pr.project_id,
                    &pr.repository_id,
                    pr.pull_request_id,
                )
                .await;
            (pr, result)
        });
    }
    let mut items = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (pr, result) =
            joined.map_err(|e| crate::error::AppError::AzureDevOps(e.to_string()))?;
        let ready = match result {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(pr = pr.pull_request_id, %error, "merge readiness fetch failed");
                false
            }
        };
        let notify = !snoozed.contains(&format!("{}:{}", pr.repository_id, pr.pull_request_id))
            && notification_allowed(
                &settings.notification_rules,
                "readyToMerge",
                &pr.project_name,
                Some(&pr.repository_name),
            );
        let item = PrNotificationItem {
            kind: PrNotificationKind::ReadyToMerge,
            pull_request_id: pr.pull_request_id,
            repository_id: pr.repository_id,
            title: pr.title,
            repository_name: pr.repository_name,
            project_name: pr.project_name,
            web_url: pr.web_url,
            comment_author: None,
            snippet: None,
        };
        let records = pr_notification_records(&org.id, &org.name, std::slice::from_ref(&item));
        if db.update_pr_readiness(
            &org.id,
            &item.repository_id,
            item.pull_request_id,
            ready,
            notify.then_some(&records[0]),
        )? {
            items.push(item);
        }
    }
    Ok(items)
}
