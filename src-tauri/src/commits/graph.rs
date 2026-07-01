//! Shared helper for fetching per-commit parent ids for the commit graph
//! view. Azure DevOps and GitHub both only expose parent commit ids on their
//! single-commit detail endpoint (never on a commit list/search response), so
//! rendering a DAG for a page of search results means one detail request per
//! commit. This runs those requests with bounded concurrency instead of
//! sequentially or all at once.
use std::collections::HashMap;
use std::future::Future;

use tokio::task::JoinSet;

/// How many parent-lookups run at a time. Azure DevOps and GitHub both apply
/// per-connection rate limits; a small bounded pool keeps a ~100-commit graph
/// fetch fast without bursting past them.
const PARENTS_FETCH_CONCURRENCY: usize = 8;

/// Fetches parent commit ids for a set of commits, running up to
/// `PARENTS_FETCH_CONCURRENCY` lookups at a time via `fetch_one`. A commit
/// whose lookup fails or returns `None` is simply absent from the result
/// instead of failing the whole batch — the graph renders it as a leaf with a
/// dangling edge rather than erroring the entire view.
pub(crate) async fn fetch_parents_concurrently<F, Fut>(
    commit_ids: Vec<String>,
    fetch_one: F,
) -> HashMap<String, Vec<String>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Option<Vec<String>>> + Send + 'static,
{
    let mut results = HashMap::with_capacity(commit_ids.len());
    let mut pending = commit_ids.into_iter();
    let mut in_flight: JoinSet<(String, Option<Vec<String>>)> = JoinSet::new();

    for id in pending.by_ref().take(PARENTS_FETCH_CONCURRENCY) {
        let fut = fetch_one(id.clone());
        in_flight.spawn(async move { (id, fut.await) });
    }

    while let Some(joined) = in_flight.join_next().await {
        if let Ok((id, Some(parents))) = joined {
            results.insert(id, parents);
        }
        if let Some(next_id) = pending.next() {
            let fut = fetch_one(next_id.clone());
            in_flight.spawn(async move { (next_id, fut.await) });
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn resolves_parents_for_every_commit() {
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let result =
            fetch_parents_concurrently(ids, |id| async move { Some(vec![format!("{id}-parent")]) })
                .await;

        assert_eq!(result.get("a").unwrap(), &vec!["a-parent".to_string()]);
        assert_eq!(result.get("b").unwrap(), &vec!["b-parent".to_string()]);
        assert_eq!(result.get("c").unwrap(), &vec!["c-parent".to_string()]);
        assert_eq!(result.len(), 3);
    }

    #[tokio::test]
    async fn omits_commits_whose_lookup_fails() {
        let ids = vec!["ok".to_string(), "missing".to_string()];
        let result = fetch_parents_concurrently(ids, |id| async move {
            if id == "missing" {
                None
            } else {
                Some(vec!["ok-parent".to_string()])
            }
        })
        .await;

        assert_eq!(result.len(), 1);
        assert!(result.contains_key("ok"));
        assert!(!result.contains_key("missing"));
    }

    #[tokio::test]
    async fn respects_concurrency_bound_and_drains_the_whole_queue() {
        // 25 ids is more than one batch of PARENTS_FETCH_CONCURRENCY (8), so
        // this exercises the refill loop, not just the initial batch.
        let ids: Vec<String> = (0..25).map(|i| i.to_string()).collect();
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));

        let in_flight_for_closure = in_flight.clone();
        let max_for_closure = max_in_flight.clone();
        let result = fetch_parents_concurrently(ids.clone(), move |id| {
            let in_flight = in_flight_for_closure.clone();
            let max_in_flight = max_for_closure.clone();
            async move {
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                max_in_flight.fetch_max(now, Ordering::SeqCst);
                tokio::task::yield_now().await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                Some(vec![format!("{id}-parent")])
            }
        })
        .await;

        assert_eq!(result.len(), 25);
        assert!(
            max_in_flight.load(Ordering::SeqCst) <= PARENTS_FETCH_CONCURRENCY,
            "observed {} concurrent lookups, expected at most {}",
            max_in_flight.load(Ordering::SeqCst),
            PARENTS_FETCH_CONCURRENCY
        );
    }

    #[tokio::test]
    async fn empty_input_returns_empty_map() {
        let result: HashMap<String, Vec<String>> =
            fetch_parents_concurrently(Vec::new(), |_id| async move { Some(Vec::new()) }).await;
        assert!(result.is_empty());
    }
}
