use crate::auth::client_for_organization;
use crate::commits::encode_path_segment;
use crate::error::Result;
use crate::prs::{short_ref, vote_label};
use crate::work_items::{summarize_mention_candidate, MentionCandidate};

use super::helpers::{fetch_side, map_threads, ChangeFlags};
use super::types::*;

impl PrReviewService {
    pub async fn get_review(&self, pr: PrLocator) -> Result<PullRequestReview> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let (detail, threads) = tokio::try_join!(
            client.get_pull_request_detail(&pr.project_id, &pr.repository_id, pr.pull_request_id,),
            client
                .list_pull_request_threads(&pr.project_id, &pr.repository_id, pr.pull_request_id,),
        )?;

        let me = organization.authenticated_user_id.as_deref();
        Ok(PullRequestReview {
            pull_request_id: detail.pull_request_id,
            title: detail.title,
            description: detail.description,
            source_ref_name: short_ref(&detail.source_ref_name),
            target_ref_name: short_ref(&detail.target_ref_name),
            created_by: detail.created_by.and_then(|id| id.display_name),
            creation_date: detail.creation_date.map(|date| date.to_rfc3339()),
            is_draft: detail.is_draft.unwrap_or(false),
            auto_complete: detail.auto_complete_set_by.is_some(),
            reviewers: detail
                .reviewers
                .unwrap_or_default()
                .into_iter()
                .map(|reviewer| PrReviewer {
                    is_me: me.is_some() && reviewer.id.as_deref() == me,
                    id: reviewer.id.clone(),
                    display_name: reviewer.display_name.unwrap_or_default(),
                    vote: reviewer.vote,
                    vote_label: vote_label(reviewer.vote).to_string(),
                    is_required: reviewer.is_required,
                })
                .collect(),
            labels: detail
                .labels
                .into_iter()
                .map(|label| PrLabel {
                    id: label.id,
                    name: label.name,
                })
                .collect(),
            threads: map_threads(threads, me),
        })
    }

    pub async fn list_changes(&self, pr: PrLocator) -> Result<PullRequestChanges> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let iterations = client
            .list_pull_request_iterations(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await?;
        let Some(latest) = iterations.into_iter().max_by_key(|iteration| iteration.id) else {
            return Ok(PullRequestChanges {
                base_commit_id: None,
                target_commit_id: None,
                files: vec![],
            });
        };
        let entries = client
            .get_pull_request_iteration_changes(
                &pr.project_id,
                &pr.repository_id,
                pr.pull_request_id,
                latest.id,
            )
            .await?;
        let files = entries
            .into_iter()
            .filter_map(|entry| {
                let item = entry.item?;
                if item.is_folder.unwrap_or(false) {
                    return None;
                }
                Some(PrChangedFile {
                    path: item.path?,
                    change_type: entry.change_type.unwrap_or_else(|| "edit".to_string()),
                    original_path: entry.source_server_item,
                })
            })
            .collect();
        Ok(PullRequestChanges {
            base_commit_id: latest.common_ref_commit.map(|commit| commit.commit_id),
            target_commit_id: latest.source_ref_commit.map(|commit| commit.commit_id),
            files,
        })
    }

    pub async fn get_file_diff(&self, input: GetPullRequestFileDiffInput) -> Result<PrFileDiff> {
        let organization = self
            .db
            .resolve_organization(input.pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let flags = ChangeFlags::parse(&input.change_type);

        let base_path = input
            .original_path
            .clone()
            .unwrap_or_else(|| input.file_path.clone());

        // The two sides are independent; fetch them concurrently.
        let base_future = async {
            if flags.is_add {
                Ok((None, None))
            } else if let Some(commit) = input.base_commit_id.as_deref() {
                fetch_side(&client, &input.pr, &base_path, commit).await
            } else {
                Ok((None, Some("missing".to_string())))
            }
        };
        let target_future = async {
            if flags.is_delete {
                Ok((None, None))
            } else if let Some(commit) = input.target_commit_id.as_deref() {
                fetch_side(&client, &input.pr, &input.file_path, commit).await
            } else {
                Ok((None, Some("missing".to_string())))
            }
        };
        let ((base_content, base_unavailable_reason), (target_content, target_unavailable_reason)) =
            tokio::try_join!(base_future, target_future)?;

        Ok(PrFileDiff {
            file_path: input.file_path,
            base_content,
            target_content,
            base_unavailable_reason,
            target_unavailable_reason,
        })
    }

    pub async fn list_commits(&self, pr: PrLocator) -> Result<Vec<PrCommit>> {
        let organization = self
            .db
            .resolve_organization(pr.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let commits = client
            .list_pull_request_commits(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await?;
        // Azure DevOps resolves the repository GUID in the `_git/{repo}` path,
        // so the commit web URL is built from trusted fields without an extra
        // round-trip (matching the URL guidance in AGENTS.md).
        let base_url = organization.base_url.trim_end_matches('/');
        let repo_segment = encode_path_segment(&pr.repository_id);
        let project_segment = encode_path_segment(&pr.project_id);
        Ok(commits
            .into_iter()
            .map(|commit| {
                let comment = commit
                    .comment
                    .unwrap_or_default()
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string();
                let web_url = Some(format!(
                    "{base_url}/{project_segment}/_git/{repo_segment}/commit/{}",
                    commit.commit_id
                ));
                PrCommit {
                    short_commit_id: commit.commit_id.chars().take(8).collect(),
                    commit_id: commit.commit_id,
                    comment,
                    author_name: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.name.clone()),
                    author_date: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.date)
                        .map(|date| date.to_rfc3339()),
                    web_url,
                }
            })
            .collect())
    }

    pub async fn search_mentions(
        &self,
        input: SearchPullRequestMentionsInput,
    ) -> Result<Vec<MentionCandidate>> {
        let query = input.query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let organization = self
            .db
            .resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let identities = client.search_identities(query, 40).await?;
        Ok(identities
            .into_iter()
            .filter_map(summarize_mention_candidate)
            .collect())
    }
}
