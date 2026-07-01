use crate::auth::client_for_organization;
use crate::error::Result;

use super::service::CommitService;
use super::{CommitContainingRef, CommitRefsResult, GetCommitRefsInput};

/// Upper bound on how many candidate refs are checked for ancestry beyond the
/// free "ref tip equals this commit" fast path. Azure DevOps has no
/// "refs containing this commit" REST endpoint, so each remaining candidate
/// costs one extra request (via the Diffs API's merge-base); this bound keeps
/// a repository with many branches/tags from making the preview panel slow.
const MAX_REFS_CHECKED: usize = 30;

/// A ref candidate before its containment is known: the short name (without
/// `refs/heads/`/`refs/tags/`), its kind, and its tip commit id.
struct RefCandidate {
    name: String,
    kind: &'static str,
    object_id: Option<String>,
}

/// Splits ref candidates into ones whose tip already matches `commit_id`
/// (free, no extra request) and the rest (need an ancestry check).
fn partition_candidates(
    candidates: Vec<RefCandidate>,
    commit_id: &str,
) -> (Vec<CommitContainingRef>, Vec<RefCandidate>) {
    let mut tip_matches = Vec::new();
    let mut remaining = Vec::new();
    for candidate in candidates {
        if candidate.object_id.as_deref() == Some(commit_id) {
            tip_matches.push(CommitContainingRef {
                kind: candidate.kind.to_string(),
                name: candidate.name,
            });
        } else {
            remaining.push(candidate);
        }
    }
    (tip_matches, remaining)
}

impl CommitService {
    /// Returns the branches/tags that contain `commit_id`. Ref tips that equal
    /// the commit are reported without an extra request; every other
    /// candidate ref (up to [`MAX_REFS_CHECKED`]) is checked via the Diffs
    /// API's merge-base: a ref contains the commit exactly when the merge
    /// base of the ref and the commit is the commit itself.
    pub async fn get_commit_refs(&self, input: GetCommitRefsInput) -> Result<CommitRefsResult> {
        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;

        let (branches, tags) = tokio::try_join!(
            client.list_branches(&input.project_id, &input.repository_id),
            client.list_tags(&input.project_id, &input.repository_id),
        )?;

        let mut candidates: Vec<RefCandidate> = Vec::new();
        for branch in branches {
            if let Some(name) = branch.name.strip_prefix("refs/heads/") {
                candidates.push(RefCandidate {
                    name: name.to_string(),
                    kind: "branch",
                    object_id: branch.object_id,
                });
            }
        }
        for tag in tags {
            if let Some(name) = tag.name.strip_prefix("refs/tags/") {
                candidates.push(RefCandidate {
                    name: name.to_string(),
                    kind: "tag",
                    object_id: tag.object_id,
                });
            }
        }

        let (mut refs, remaining) = partition_candidates(candidates, &input.commit_id);
        let truncated = remaining.len() > MAX_REFS_CHECKED;

        for candidate in remaining.into_iter().take(MAX_REFS_CHECKED) {
            let version_type = if candidate.kind == "branch" {
                "branch"
            } else {
                "tag"
            };
            match client
                .get_commits_diff_common_commit(
                    &input.project_id,
                    &input.repository_id,
                    &candidate.name,
                    version_type,
                    &input.commit_id,
                )
                .await
            {
                Ok(Some(common_commit)) if common_commit == input.commit_id => {
                    refs.push(CommitContainingRef {
                        kind: candidate.kind.to_string(),
                        name: candidate.name,
                    });
                }
                Ok(_) => {}
                Err(error) => {
                    // One unreachable ref should not fail the whole lookup;
                    // the preview panel just shows fewer refs.
                    tracing::warn!(
                        repository = %input.repository_id,
                        r#ref = %candidate.name,
                        error = %error,
                        "failed to check commit ancestry for ref, skipping"
                    );
                }
            }
        }

        refs.sort();
        Ok(CommitRefsResult { refs, truncated })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_candidates_separates_tip_matches() {
        let candidates = vec![
            RefCandidate {
                name: "main".to_string(),
                kind: "branch",
                object_id: Some("abc".to_string()),
            },
            RefCandidate {
                name: "feature/x".to_string(),
                kind: "branch",
                object_id: Some("def".to_string()),
            },
            RefCandidate {
                name: "v1.0".to_string(),
                kind: "tag",
                object_id: None,
            },
        ];
        let (tip_matches, remaining) = partition_candidates(candidates, "abc");
        assert_eq!(tip_matches.len(), 1);
        assert_eq!(tip_matches[0].name, "main");
        assert_eq!(tip_matches[0].kind, "branch");
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|c| c.name == "feature/x"));
        assert!(remaining.iter().any(|c| c.name == "v1.0"));
    }
}
