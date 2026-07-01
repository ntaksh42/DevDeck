use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};
use crate::work_items::conversions::{image_content_type_from_url, normalize_image_content_type};

use super::service::CommitService;
use super::{CommitAvatarImage, FetchCommitAvatarInput};

/// Mirrors `WORK_ITEM_IMAGE_MAX_BYTES`: avatars are small, so this is a
/// generous ceiling against a misbehaving or malicious response.
const COMMIT_AVATAR_MAX_BYTES: usize = 2 * 1024 * 1024;

impl CommitService {
    /// Fetches a commit author/committer avatar and returns it as a data URL.
    /// Azure DevOps avatar endpoints require the same PAT/Azure CLI auth as
    /// the rest of the API, so the URL from commit data cannot be used
    /// directly as an `<img src>` and is proxied through here instead
    /// (mirrors `WorkItemService::fetch_image`).
    pub async fn fetch_avatar(&self, input: FetchCommitAvatarInput) -> Result<CommitAvatarImage> {
        let url = input.url.trim();
        if url.is_empty() {
            return Err(AppError::InvalidInput("avatar URL is required".to_string()));
        }

        let organization = self.resolve_organization(input.organization_id.as_deref())?;
        let client = client_for_organization(&organization, &self.secrets)?;
        let response = client.get_avatar_bytes(url).await?;
        if response.bytes.len() > COMMIT_AVATAR_MAX_BYTES {
            return Err(AppError::InvalidInput(
                "avatar image is too large to preview".to_string(),
            ));
        }

        let content_type = response
            .content_type
            .as_deref()
            .and_then(normalize_image_content_type)
            .or_else(|| image_content_type_from_url(url))
            // Azure DevOps avatar responses are commonly PNG without an
            // unambiguous URL extension; fall back rather than reject.
            .unwrap_or("image/png");
        let encoded = BASE64_STANDARD.encode(response.bytes);
        Ok(CommitAvatarImage {
            data_url: format!("data:{content_type};base64,{encoded}"),
        })
    }
}
