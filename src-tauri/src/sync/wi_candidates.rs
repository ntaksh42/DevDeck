//! Which work items the Inbox reads the comments of.
//!
//! - Mentions: the organization-wide WIQL macro `@RecentMentions` (items the
//!   user was mentioned in over the last 30 days). If the service rejects it,
//!   the user's most recently changed assigned items are scanned instead, and
//!   Sync health says so: mentions elsewhere are missed until it works.
//! - Replies: items the user changed in the last 30 days (commenting changes
//!   the item, so this covers the items the user commented on) and the items
//!   the user follows in DevDeck.

use std::collections::HashSet;

use azdo_client::AdoClient;

use crate::db::{AppDatabase, Organization};

use super::SyncBudget;

/// Both spellings are tried: the macro is documented for the ID field with the
/// `In` operator, and the parenthesised form is the common WIQL list syntax.
const MENTION_WIQLS: [&str; 2] = [
    "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions) \
     ORDER BY [System.ChangedDate] DESC",
    "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN @RecentMentions \
     ORDER BY [System.ChangedDate] DESC",
];
const TOUCHED_WIQL: &str = "SELECT [System.Id] FROM WorkItems \
     WHERE [System.ChangedBy] EVER @Me AND [System.ChangedDate] >= @Today - 30 \
     ORDER BY [System.ChangedDate] DESC";
const QUERY_TOP: usize = 100;
/// How many assigned items the mention fallback looks at.
const FALLBACK_ITEMS: usize = 30;

pub(super) struct Candidates {
    /// Mentioned items first, then touched, then followed; no duplicates.
    pub ids: Vec<i64>,
    pub followed: HashSet<i64>,
    /// Shown as "Limited" in Sync health.
    pub warning: Option<String>,
}

async fn query(client: &AdoClient, budget: &SyncBudget, wiql: &str) -> Result<Vec<i64>, String> {
    let _permit = budget
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    client
        .query_work_item_ids_org(wiql, Some(QUERY_TOP))
        .await
        .map_err(|e| e.to_string())
}

fn fallback_ids(db: &AppDatabase, org: &Organization) -> Vec<i64> {
    let mut items = db.list_my_work_items(&org.id).unwrap_or_default();
    items.sort_by(|a, b| b.changed_date.cmp(&a.changed_date));
    items
        .into_iter()
        .take(FALLBACK_ITEMS)
        .map(|item| item.id)
        .collect()
}

pub(super) async fn discover(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    budget: &SyncBudget,
) -> Candidates {
    let mut warnings = Vec::new();
    let mut mentioned = None;
    for wiql in MENTION_WIQLS {
        match query(client, budget, wiql).await {
            Ok(ids) => {
                mentioned = Some(ids);
                break;
            }
            Err(e) => {
                tracing::debug!(org = %org.name, error = %e, "inbox: @RecentMentions query rejected")
            }
        }
    }
    let mentioned = mentioned.unwrap_or_else(|| {
        tracing::warn!(org = %org.name, "inbox: @RecentMentions unavailable, scanning assigned work items");
        warnings.push(format!(
            "@RecentMentions was rejected, so work item mentions are only read from your {FALLBACK_ITEMS} most recently changed assigned items."
        ));
        fallback_ids(db, org)
    });
    let touched = query(client, budget, TOUCHED_WIQL)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(org = %org.name, error = %e, "inbox: failed to list the work items you changed");
            warnings.push(format!(
                "Replies on work items you commented on are not included: {e}."
            ));
            Vec::new()
        });
    let followed: Vec<i64> = db
        .list_followed_work_items(&org.id)
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.work_item_id)
        .collect();

    let mut seen = HashSet::new();
    let ids = mentioned
        .into_iter()
        .chain(touched)
        .chain(followed.iter().copied())
        .filter(|id| seen.insert(*id))
        .collect();
    Candidates {
        ids,
        followed: followed.into_iter().collect(),
        warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
    }
}
