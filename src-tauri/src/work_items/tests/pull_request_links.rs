use crate::db::{CachedPr, CachedReviewPr};

use super::super::*;

const BASE_URL: &str = "https://dev.azure.com/contoso";

fn pr_relation(url: &str) -> WorkItemRelation {
    WorkItemRelation {
        rel: "ArtifactLink".to_string(),
        url: url.to_string(),
        attributes: Some(azdo_client::WorkItemRelationAttributes {
            name: Some("Pull Request".to_string()),
        }),
    }
}

fn review(pull_request_id: i64) -> CachedReviewPr {
    CachedReviewPr {
        org_id: "org".to_string(),
        project_id: "proj-guid".to_string(),
        project_name: "Demo".to_string(),
        repository_id: "repo-guid".to_string(),
        repository_name: "api".to_string(),
        pull_request_id,
        title: "Reviewed PR".to_string(),
        created_by: None,
        creation_date: "2026-01-01T00:00:00Z".to_string(),
        target_ref_name: "refs/heads/main".to_string(),
        web_url: Some(format!(
            "{BASE_URL}/Demo/_git/api/pullrequest/{pull_request_id}"
        )),
        my_vote: 0,
        my_vote_label: "No Vote".to_string(),
        my_is_required: false,
        is_draft: false,
        merge_status: None,
        ci_status: None,
        ci_context: None,
        ci_check_count: 0,
    }
}

fn active(pull_request_id: i64, is_draft: bool) -> CachedPr {
    CachedPr {
        org_id: "org".to_string(),
        project_id: "proj-guid".to_string(),
        project_name: "Demo".to_string(),
        repository_id: "repo-guid".to_string(),
        repository_name: "web".to_string(),
        pull_request_id,
        title: "Teammate PR".to_string(),
        status: "active".to_string(),
        created_by: None,
        created_by_id: None,
        creation_date: "2026-01-01T00:00:00Z".to_string(),
        source_ref_name: "refs/heads/feature".to_string(),
        target_ref_name: "refs/heads/main".to_string(),
        web_url: Some(format!(
            "{BASE_URL}/Demo/_git/web/pullrequest/{pull_request_id}"
        )),
        is_draft,
    }
}

#[test]
fn pull_request_artifact_parts_parses_project_repo_and_id() {
    assert_eq!(
        pull_request_artifact_parts("vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F42"),
        Some(("proj-guid".to_string(), "repo-guid".to_string(), 42))
    );
    assert_eq!(
        pull_request_artifact_parts("vstfs:///Git/PullRequestId/p/r/7"),
        Some(("p".to_string(), "r".to_string(), 7))
    );
    assert_eq!(
        pull_request_artifact_parts("vstfs:///Git/PullRequestId/42"),
        None
    );
    assert_eq!(
        pull_request_artifact_parts("vstfs:///Git/Commit/p%2Fr%2Fabc"),
        None
    );
}

#[test]
fn pull_request_links_prefer_reviews_then_active_cache() {
    let relations = vec![
        pr_relation("vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F1"),
        pr_relation("vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F2"),
    ];
    let links = pull_request_links_from_relations(
        BASE_URL,
        &relations,
        &[review(1)],
        &[active(1, false), active(2, true)],
    );
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].title.as_deref(), Some("Reviewed PR"));
    assert_eq!(links[0].my_vote_label.as_deref(), Some("No Vote"));
    // A teammate's PR that I'm not reviewing still opens, with its details.
    assert_eq!(links[1].title.as_deref(), Some("Teammate PR"));
    assert_eq!(links[1].status.as_deref(), Some("Draft"));
    assert_eq!(links[1].my_vote_label, None);
    assert_eq!(
        links[1].web_url.as_deref(),
        Some("https://dev.azure.com/contoso/Demo/_git/web/pullrequest/2")
    );
}

#[test]
fn pull_request_links_fall_back_to_guid_web_url_when_uncached() {
    // Completed/abandoned PRs are in neither cache but must stay clickable.
    let relations = vec![pr_relation(
        "vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F9001",
    )];
    let links = pull_request_links_from_relations(&format!("{BASE_URL}/"), &relations, &[], &[]);
    assert_eq!(
        links,
        vec![WorkItemPullRequestLink {
            pull_request_id: 9001,
            repository_id: Some("repo-guid".to_string()),
            title: None,
            status: None,
            my_vote_label: None,
            web_url: Some(
                "https://dev.azure.com/contoso/proj-guid/_git/repo-guid/pullrequest/9001"
                    .to_string()
            ),
        }]
    );
}
