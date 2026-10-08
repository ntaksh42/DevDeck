//! Reviews assigned to a group/team the user belongs to.
//!
//! Azure DevOps' `searchCriteria.reviewerId` filter only matches a PR when the
//! identity is a direct reviewer, so My Reviews would silently miss PRs whose
//! review was requested from a team. Those PRs are found by matching the
//! reviewers of the already-fetched active PRs against the user's group ids.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use azdo_client::AdoClient;

use crate::db::{AppDatabase, CachedPr, CachedReviewPr, Organization};
use crate::shared_cache::SharedReviewer;

use super::util::vote_label;

/// Group membership rarely changes; refreshing hourly keeps the extra identity
/// lookups off the 5 minute sync path.
const GROUP_TTL: Duration = Duration::from_secs(60 * 60);

type Key = (String, String, String);
type Entries = HashMap<Key, (Instant, Vec<String>)>;

fn entries() -> &'static Mutex<Entries> {
    static ENTRIES: OnceLock<Mutex<Entries>> = OnceLock::new();
    ENTRIES.get_or_init(Default::default)
}

/// Ids of the groups `user_id` belongs to. A lookup failure is non-fatal: the
/// sync continues with direct reviews only and the second value carries a
/// warning so the gap is visible in Sync health instead of silent.
pub(crate) async fn member_group_ids(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
    user_id: &str,
) -> (HashSet<String>, Option<String>) {
    let key = (db.cache_key(), org.id.clone(), user_id.to_string());
    let cached = {
        let entries = entries()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        entries
            .get(&key)
            .filter(|(stored_at, _)| stored_at.elapsed() < GROUP_TTL)
            .map(|(_, ids)| ids.clone())
    };
    if let Some(ids) = cached {
        return (ids.into_iter().collect(), None);
    }
    match client.list_member_group_ids(user_id).await {
        Ok(ids) => {
            entries()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(key, (Instant::now(), ids.clone()));
            (ids.into_iter().collect(), None)
        }
        Err(e) => {
            tracing::warn!(org = %org.name, error = %e, "sync: failed to list group memberships");
            (
                HashSet::new(),
                Some(format!(
                    "Reviews requested from your groups/teams are not included: {e}."
                )),
            )
        }
    }
}

/// Active PRs whose reviewer list names one of `group_ids` but that are not
/// already in `direct`. `my_vote` is 0 because a member who voted is added as a
/// direct reviewer and therefore already appears in `direct`.
pub(crate) fn group_review_prs(
    active: &[CachedPr],
    reviewers: &[SharedReviewer],
    group_ids: &HashSet<String>,
    direct: &[CachedReviewPr],
    user_id: &str,
) -> Vec<CachedReviewPr> {
    if group_ids.is_empty() {
        return Vec::new();
    }
    // (repository_id, pull_request_id) -> any matching group is a required reviewer
    let mut via_group: HashMap<(&str, i64), bool> = HashMap::new();
    for reviewer in reviewers {
        if group_ids.contains(&reviewer.reviewer_id) {
            let required = via_group
                .entry((reviewer.repository_id.as_str(), reviewer.pull_request_id))
                .or_insert(false);
            *required |= reviewer.is_required;
        }
    }
    let direct_keys: HashSet<(&str, i64)> = direct
        .iter()
        .map(|pr| (pr.repository_id.as_str(), pr.pull_request_id))
        .collect();

    active
        .iter()
        .filter(|pr| pr.status == "active" && pr.created_by_id.as_deref() != Some(user_id))
        .filter_map(|pr| {
            let key = (pr.repository_id.as_str(), pr.pull_request_id);
            let required = *via_group.get(&key)?;
            if direct_keys.contains(&key) {
                return None;
            }
            Some(CachedReviewPr {
                org_id: pr.org_id.clone(),
                project_id: pr.project_id.clone(),
                project_name: pr.project_name.clone(),
                repository_id: pr.repository_id.clone(),
                repository_name: pr.repository_name.clone(),
                pull_request_id: pr.pull_request_id,
                title: pr.title.clone(),
                created_by: pr.created_by.clone(),
                creation_date: pr.creation_date.clone(),
                target_ref_name: pr.target_ref_name.clone(),
                web_url: pr.web_url.clone(),
                my_vote: 0,
                my_vote_label: vote_label(0).to_string(),
                my_is_required: required,
                is_draft: pr.is_draft,
                merge_status: None,
                ci_status: None,
                ci_context: None,
                ci_check_count: 0,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_pr(repo: &str, id: i64, created_by_id: &str) -> CachedPr {
        CachedPr {
            org_id: "org".into(),
            project_id: "proj".into(),
            project_name: "Proj".into(),
            repository_id: repo.into(),
            repository_name: repo.into(),
            pull_request_id: id,
            title: format!("PR {id}"),
            status: "active".into(),
            created_by: Some("Author".into()),
            created_by_id: Some(created_by_id.into()),
            creation_date: "2026-01-01T00:00:00Z".into(),
            source_ref_name: "feature".into(),
            target_ref_name: "main".into(),
            web_url: None,
            is_draft: false,
        }
    }

    fn reviewer(repo: &str, id: i64, reviewer_id: &str, required: bool) -> SharedReviewer {
        SharedReviewer {
            repository_id: repo.into(),
            pull_request_id: id,
            reviewer_id: reviewer_id.into(),
            vote: 0,
            is_required: required,
        }
    }

    fn groups(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn picks_up_prs_assigned_to_my_group() {
        let active = vec![active_pr("r", 1, "a"), active_pr("r", 2, "a")];
        let reviewers = vec![
            reviewer("r", 1, "team", true),
            reviewer("r", 2, "other", false),
        ];
        let found = group_review_prs(&active, &reviewers, &groups(&["team"]), &[], "me");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pull_request_id, 1);
        assert!(found[0].my_is_required);
        assert_eq!(found[0].my_vote, 0);
    }

    #[test]
    fn skips_own_prs_and_prs_already_listed_directly() {
        let active = vec![active_pr("r", 1, "me"), active_pr("r", 2, "a")];
        let reviewers = vec![
            reviewer("r", 1, "team", false),
            reviewer("r", 2, "team", false),
        ];
        let direct = vec![CachedReviewPr {
            repository_id: "r".into(),
            pull_request_id: 2,
            ..group_review_prs(
                &[active_pr("r", 2, "a")],
                &[reviewer("r", 2, "team", false)],
                &groups(&["team"]),
                &[],
                "me",
            )
            .remove(0)
        }];
        let found = group_review_prs(&active, &reviewers, &groups(&["team"]), &direct, "me");
        assert!(found.is_empty());
    }

    #[test]
    fn no_groups_means_no_extra_reviews() {
        let active = vec![active_pr("r", 1, "a")];
        let reviewers = vec![reviewer("r", 1, "team", true)];
        assert!(group_review_prs(&active, &reviewers, &groups(&[]), &[], "me").is_empty());
    }
}
