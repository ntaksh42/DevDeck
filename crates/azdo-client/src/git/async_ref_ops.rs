//! Cherry-pick and revert: Azure DevOps' "async ref operation" APIs
//! (`POST .../cherryPicks`, `POST .../reverts`). Both create a branch from a
//! commit (cherry-pick applies it, revert undoes it) and both run server-side
//! as an async job — the POST returns a `queued`/`inProgress` operation that
//! must be polled by id until it reaches a terminal status.
//!
//! Unlike the rest of this client, these two endpoints are pinned to
//! `api-version=7.1` (not `7.1-preview`) to match the Microsoft Learn REST
//! reference for Cherry Picks/Reverts exactly, since this is a write path.
//! The request body's `repository` field is sent as just `{ "id": ... }`;
//! the project/repository are already unambiguous from the URL path, and
//! Microsoft's documented sample additionally includes `name`/`project`/
//! `defaultBranch`/`remoteUrl`, none of which this client resolves separately
//! before this call. If Azure DevOps ever rejects the minimal form, widen
//! this body — flagged here since it could not be verified against a live
//! organization.

use serde::Serialize;
use tokio::time::sleep;

use crate::client::AdoClient;
use crate::error::Result;

use super::{GitAsyncOperationStatus, GitCherryPick, GitRevert};

const ASYNC_REF_OP_API_VERSION: &str = "7.1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryRefBody<'a> {
    id: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitRefBody<'a> {
    commit_id: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsyncRefOperationSourceBody<'a> {
    commit_list: Vec<CommitRefBody<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsyncRefOperationRequest<'a> {
    repository: RepositoryRefBody<'a>,
    source: AsyncRefOperationSourceBody<'a>,
    onto_ref_name: &'a str,
    generated_ref_name: &'a str,
}

fn build_request<'a>(
    repository_id: &'a str,
    commit_id: &'a str,
    onto_ref_name: &'a str,
    generated_ref_name: &'a str,
) -> AsyncRefOperationRequest<'a> {
    AsyncRefOperationRequest {
        repository: RepositoryRefBody { id: repository_id },
        source: AsyncRefOperationSourceBody {
            commit_list: vec![CommitRefBody { commit_id }],
        },
        onto_ref_name,
        generated_ref_name,
    }
}

impl AdoClient {
    /// Starts a cherry-pick of a single commit onto `onto_ref_name`, proposing
    /// `generated_ref_name` as the new branch. Returns immediately with a
    /// `queued`/`inProgress` operation; use [`AdoClient::get_cherry_pick`] or
    /// [`AdoClient::cherry_pick_commit_and_wait`] to learn the outcome.
    pub async fn create_cherry_pick(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
        onto_ref_name: &str,
        generated_ref_name: &str,
    ) -> Result<GitCherryPick> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/cherryPicks");
        let body = build_request(repository_id, commit_id, onto_ref_name, generated_ref_name);
        self.post_json(&path, &[("api-version", ASYNC_REF_OP_API_VERSION)], &body)
            .await
    }

    pub async fn get_cherry_pick(
        &self,
        project_id: &str,
        repository_id: &str,
        cherry_pick_id: i64,
    ) -> Result<GitCherryPick> {
        let path = format!(
            "{project_id}/_apis/git/repositories/{repository_id}/cherryPicks/{cherry_pick_id}"
        );
        self.get_json(&path, &[("api-version", ASYNC_REF_OP_API_VERSION)])
            .await
    }

    /// Starts a cherry-pick and polls until it reaches a terminal status or
    /// the client's [`AsyncRefOperationPollPolicy`] budget runs out, whichever
    /// comes first. Never errors solely because the budget ran out — callers
    /// check `status` on the returned value (it may still be `queued` or
    /// `inProgress`, meaning Azure DevOps is still working on it).
    pub async fn cherry_pick_commit_and_wait(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
        onto_ref_name: &str,
        generated_ref_name: &str,
    ) -> Result<GitCherryPick> {
        let created = self
            .create_cherry_pick(
                project_id,
                repository_id,
                commit_id,
                onto_ref_name,
                generated_ref_name,
            )
            .await?;
        self.poll_until_terminal(created, |id| {
            self.get_cherry_pick(project_id, repository_id, id)
        })
        .await
    }

    /// Starts a revert of a single commit onto `onto_ref_name`, proposing
    /// `generated_ref_name` as the new branch. Mirrors
    /// [`AdoClient::create_cherry_pick`] against the `reverts` resource.
    pub async fn create_revert(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
        onto_ref_name: &str,
        generated_ref_name: &str,
    ) -> Result<GitRevert> {
        let path = format!("{project_id}/_apis/git/repositories/{repository_id}/reverts");
        let body = build_request(repository_id, commit_id, onto_ref_name, generated_ref_name);
        self.post_json(&path, &[("api-version", ASYNC_REF_OP_API_VERSION)], &body)
            .await
    }

    pub async fn get_revert(
        &self,
        project_id: &str,
        repository_id: &str,
        revert_id: i64,
    ) -> Result<GitRevert> {
        let path =
            format!("{project_id}/_apis/git/repositories/{repository_id}/reverts/{revert_id}");
        self.get_json(&path, &[("api-version", ASYNC_REF_OP_API_VERSION)])
            .await
    }

    /// Starts a revert and polls until terminal or the poll budget runs out.
    /// Mirrors [`AdoClient::cherry_pick_commit_and_wait`].
    pub async fn revert_commit_and_wait(
        &self,
        project_id: &str,
        repository_id: &str,
        commit_id: &str,
        onto_ref_name: &str,
        generated_ref_name: &str,
    ) -> Result<GitRevert> {
        let created = self
            .create_revert(
                project_id,
                repository_id,
                commit_id,
                onto_ref_name,
                generated_ref_name,
            )
            .await?;
        self.poll_until_terminal(created, |id| self.get_revert(project_id, repository_id, id))
            .await
    }

    /// Polls `refetch` on the client's configured interval until `current`
    /// reaches a terminal status or the attempt budget is exhausted, returning
    /// whichever state was last observed.
    async fn poll_until_terminal<T, F, Fut>(&self, mut current: T, refetch: F) -> Result<T>
    where
        T: AsyncRefOperationStatus,
        F: Fn(i64) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let policy = self.poll_policy;
        for _ in 1..policy.attempts() {
            if current.status().is_terminal() {
                break;
            }
            sleep(policy.interval).await;
            current = refetch(current.operation_id()).await?;
        }
        Ok(current)
    }
}

/// Lets [`AdoClient::poll_until_terminal`] work generically over
/// [`GitCherryPick`] and [`GitRevert`], whose only difference is the name of
/// the id field.
trait AsyncRefOperationStatus {
    fn operation_id(&self) -> i64;
    fn status(&self) -> GitAsyncOperationStatus;
}

impl AsyncRefOperationStatus for GitCherryPick {
    fn operation_id(&self) -> i64 {
        self.cherry_pick_id
    }
    fn status(&self) -> GitAsyncOperationStatus {
        self.status
    }
}

impl AsyncRefOperationStatus for GitRevert {
    fn operation_id(&self) -> i64 {
        self.revert_id
    }
    fn status(&self) -> GitAsyncOperationStatus {
        self.status
    }
}
