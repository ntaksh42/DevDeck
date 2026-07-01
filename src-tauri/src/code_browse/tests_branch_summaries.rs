// Tests for build_branch_summaries (issue #398), split out from code_browse.rs
// to keep that file under the 500-line cap.
use serde_json::json;

use super::*;

fn branch_stat(
    name: &str,
    is_base: bool,
    ahead: i64,
    behind: i64,
    updated: &str,
) -> GitBranchStats {
    serde_json::from_value(json!({
        "name": name,
        "aheadCount": ahead,
        "behindCount": behind,
        "isBaseVersion": is_base,
        "commit": {
            "commitId": format!("{name}-sha"),
            "comment": "Some change",
            "committer": { "name": "Dev", "email": "dev@example.com", "date": updated }
        }
    }))
    .unwrap()
}

fn active_pr(id: i64, title: &str, source_branch: &str) -> GitPullRequest {
    serde_json::from_value(json!({
        "pullRequestId": id,
        "title": title,
        "status": "active",
        "creationDate": "2026-05-24T00:00:00Z",
        "sourceRefName": format!("refs/heads/{source_branch}"),
        "targetRefName": "refs/heads/main",
        "repository": {
            "id": "repo-1",
            "name": "azdo-dashboard",
            "project": { "id": "project-1", "name": "Platform" }
        }
    }))
    .unwrap()
}

#[test]
fn build_branch_summaries_links_pull_request_by_source_branch() {
    let stats = vec![
        branch_stat("main", true, 0, 0, "2026-05-20T00:00:00Z"),
        branch_stat("feature/x", false, 3, 1, "2026-05-25T00:00:00Z"),
    ];
    let prs = vec![active_pr(42, "Add feature x", "feature/x")];

    let branches = build_branch_summaries("https://dev.azure.com/contoso", stats, prs);
    assert_eq!(branches.len(), 2);

    let feature = branches.iter().find(|b| b.name == "feature/x").unwrap();
    assert_eq!(feature.pull_request_id, Some(42));
    assert_eq!(feature.pull_request_title.as_deref(), Some("Add feature x"));
    assert_eq!(
        feature.pull_request_url.as_deref(),
        Some("https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42")
    );

    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(main.pull_request_id, None);
}

#[test]
fn build_branch_summaries_sorts_base_branch_first_then_recency() {
    let stats = vec![
        branch_stat("old-feature", false, 1, 5, "2026-05-01T00:00:00Z"),
        branch_stat("main", true, 0, 0, "2026-05-20T00:00:00Z"),
        branch_stat("new-feature", false, 4, 1, "2026-05-26T00:00:00Z"),
    ];

    let branches = build_branch_summaries("https://dev.azure.com/contoso", stats, vec![]);
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, vec!["main", "new-feature", "old-feature"]);
}
