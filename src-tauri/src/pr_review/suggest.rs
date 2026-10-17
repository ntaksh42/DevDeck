//! Suggested reviewers: who recently changed the files a pull request touches
//! (issue #699). Azure DevOps has no CODEOWNERS, so the history of the target
//! branch is the signal. Commit authors are Git identities (name + email), not
//! directory ids, so the caller resolves them to people afterwards.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use azdo_client::CommitSearchCriteria;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::auth::client_for_organization;
use crate::error::Result;
use crate::prs::short_ref;

use super::types::{PrLocator, PrReviewerSuggestion, PrReviewerSuggestions};
use super::PrReviewService;

/// Changed files whose history is read; the rest are reported as not counted.
const MAX_FILES: usize = 20;
/// Recent commits read per file.
const COMMITS_PER_FILE: u32 = 10;
/// Requests in flight at once.
const CONCURRENCY: usize = 4;
const MAX_SUGGESTIONS: usize = 5;

/// One author of a commit that touched `path`.
pub(super) struct FileAuthor {
    pub name: String,
    pub email: Option<String>,
}

struct Tally {
    name: String,
    email: Option<String>,
    commits: usize,
    files: HashSet<String>,
}

/// Ranks commit authors by how many recent commits they have across the files,
/// most first. `excluded` holds lowercase emails and names (the PR author and
/// current reviewers) that must not be suggested.
pub(super) fn rank_authors(
    histories: &[(String, Vec<FileAuthor>)],
    excluded: &HashSet<String>,
) -> Vec<PrReviewerSuggestion> {
    let mut tallies: HashMap<String, Tally> = HashMap::new();
    for (path, authors) in histories {
        for author in authors {
            let email = author
                .email
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let key = email
                .map(str::to_lowercase)
                .unwrap_or_else(|| author.name.to_lowercase());
            if key.is_empty()
                || excluded.contains(&key)
                || excluded.contains(&author.name.to_lowercase())
            {
                continue;
            }
            let tally = tallies.entry(key).or_insert_with(|| Tally {
                name: author.name.clone(),
                email: email.map(str::to_string),
                commits: 0,
                files: HashSet::new(),
            });
            tally.commits += 1;
            tally.files.insert(path.clone());
        }
    }
    let mut ranked: Vec<Tally> = tallies.into_values().collect();
    // Ties go to the person who touched more distinct files, then by name so
    // the order is stable between runs.
    ranked.sort_by(|a, b| {
        b.commits
            .cmp(&a.commits)
            .then(b.files.len().cmp(&a.files.len()))
            .then(a.name.cmp(&b.name))
    });
    ranked
        .into_iter()
        .take(MAX_SUGGESTIONS)
        .map(|tally| PrReviewerSuggestion {
            evidence: format!(
                "{} recent commit{} across {} changed file{}",
                tally.commits,
                if tally.commits == 1 { "" } else { "s" },
                tally.files.len(),
                if tally.files.len() == 1 { "" } else { "s" },
            ),
            name: tally.name,
            email: tally.email,
            commit_count: tally.commits as i64,
        })
        .collect()
}

impl PrReviewService {
    /// People who recently changed the pull request's files on its target
    /// branch, excluding the PR author and the current reviewers.
    pub async fn suggest_reviewers(&self, pr: PrLocator) -> Result<PrReviewerSuggestions> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (detail, changes) = tokio::try_join!(
            async {
                client
                    .get_pull_request_detail(&pr.project_id, &pr.repository_id, pr.pull_request_id)
                    .await
                    .map_err(crate::error::AppError::from)
            },
            self.list_changes(PrLocator {
                organization_id: pr.organization_id.clone(),
                project_id: pr.project_id.clone(),
                repository_id: pr.repository_id.clone(),
                pull_request_id: pr.pull_request_id,
            }),
        )?;

        let mut excluded: HashSet<String> = HashSet::new();
        let identities = detail
            .created_by
            .iter()
            .map(|id| (id.unique_name.as_deref(), id.display_name.as_deref()))
            .chain(
                detail
                    .reviewers
                    .iter()
                    .flatten()
                    .map(|r| (r.unique_name.as_deref(), r.display_name.as_deref())),
            );
        for (unique_name, display_name) in identities {
            excluded.extend(unique_name.map(str::to_lowercase));
            excluded.extend(display_name.map(str::to_lowercase));
        }

        let files_total = changes
            .files
            .iter()
            .filter(|file| !file.change_type.to_lowercase().contains("delete"))
            .count();
        let paths: Vec<String> = changes
            .files
            .into_iter()
            .filter(|file| !file.change_type.to_lowercase().contains("delete"))
            .map(|file| file.path)
            .take(MAX_FILES)
            .collect();
        let files_considered = paths.len();

        let branch = short_ref(&detail.target_ref_name);
        let permits = Arc::new(Semaphore::new(CONCURRENCY));
        let mut tasks: JoinSet<Option<(String, Vec<FileAuthor>)>> = JoinSet::new();
        for path in paths {
            let client = client.clone();
            let permits = permits.clone();
            let (project_id, repository_id, branch) = (
                pr.project_id.clone(),
                pr.repository_id.clone(),
                branch.clone(),
            );
            tasks.spawn(async move {
                let _permit = permits.acquire().await.ok()?;
                let commits = client
                    .list_commits(
                        &project_id,
                        &repository_id,
                        CommitSearchCriteria {
                            branch: Some(branch),
                            item_path: Some(path.clone()),
                            top: Some(COMMITS_PER_FILE),
                            ..Default::default()
                        },
                    )
                    .await
                    .ok()?;
                let authors = commits
                    .into_iter()
                    .filter_map(|commit| commit.author)
                    .filter_map(|author| {
                        Some(FileAuthor {
                            name: author.name?,
                            email: author.email,
                        })
                    })
                    .collect();
                Some((path, authors))
            });
        }
        let mut histories = Vec::new();
        while let Some(joined) = tasks.join_next().await {
            if let Ok(Some(history)) = joined {
                histories.push(history);
            }
        }

        Ok(PrReviewerSuggestions {
            suggestions: rank_authors(&histories, &excluded),
            files_considered: files_considered as i64,
            files_total: files_total as i64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn author(name: &str, email: &str) -> FileAuthor {
        FileAuthor {
            name: name.to_string(),
            email: Some(email.to_string()),
        }
    }

    #[test]
    fn ranks_by_commit_count_and_counts_distinct_files() {
        let histories = vec![
            (
                "/a.rs".to_string(),
                vec![author("Ann", "ann@x.com"), author("Bob", "bob@x.com")],
            ),
            (
                "/b.rs".to_string(),
                vec![author("Ann", "ANN@x.com"), author("Ann", "ann@x.com")],
            ),
        ];
        let ranked = rank_authors(&histories, &HashSet::new());
        assert_eq!(ranked[0].name, "Ann");
        assert_eq!(ranked[0].commit_count, 3);
        assert_eq!(
            ranked[0].evidence,
            "3 recent commits across 2 changed files"
        );
        assert_eq!(ranked[1].name, "Bob");
        assert_eq!(ranked[1].evidence, "1 recent commit across 1 changed file");
    }

    #[test]
    fn excluded_authors_never_appear_by_email_or_name() {
        let histories = vec![(
            "/a.rs".to_string(),
            vec![
                author("Ann", "ann@x.com"),
                author("Bob Builder", "other@x.com"),
                author("Cy", "cy@x.com"),
            ],
        )];
        let excluded: HashSet<String> = ["ann@x.com", "bob builder"]
            .into_iter()
            .map(String::from)
            .collect();
        let names: Vec<_> = rank_authors(&histories, &excluded)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["Cy"]);
    }

    #[test]
    fn keeps_only_the_top_few_with_stable_tie_order() {
        let authors: Vec<FileAuthor> = ["f", "e", "d", "c", "b", "a"]
            .iter()
            .map(|n| author(n, &format!("{n}@x.com")))
            .collect();
        let ranked = rank_authors(&[("/a.rs".to_string(), authors)], &HashSet::new());
        let names: Vec<_> = ranked.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["a", "b", "c", "d", "e"]);
    }

    #[test]
    fn an_author_without_an_email_is_still_counted_by_name() {
        let histories = vec![(
            "/a.rs".to_string(),
            vec![FileAuthor {
                name: "Dee".to_string(),
                email: None,
            }],
        )];
        let ranked = rank_authors(&histories, &HashSet::new());
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].email, None);
    }
}
