use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

use crate::auth::client_for_organization;
use crate::error::{AppError, Result};

use super::PrReviewService;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommentImageInput {
    organization_id: String,
    project_id: String,
    pr: Option<CommentImagePr>,
    name: String,
    base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentImagePr {
    repository_id: String,
    pull_request_id: i64,
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

impl PrReviewService {
    pub(crate) async fn upload_comment_image(&self, input: CommentImageInput) -> Result<String> {
        const MAX_BYTES: usize = 10 * 1024 * 1024;
        let invalid = || AppError::InvalidInput("Invalid comment image".into());
        let (stem, extension) = input.name.rsplit_once('.').ok_or_else(invalid)?;
        if !safe_id(&input.project_id)
            || !safe_id(stem)
            || !matches!(extension, "png" | "jpg" | "gif" | "webp")
            || input.base64.len() > MAX_BYTES.div_ceil(3) * 4
            || input
                .pr
                .as_ref()
                .is_some_and(|pr| !safe_id(&pr.repository_id) || pr.pull_request_id <= 0)
        {
            return Err(invalid());
        }
        let bytes = STANDARD.decode(input.base64).map_err(|_| invalid())?;
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err(invalid());
        }
        let organization = self.db.resolve_organization(Some(&input.organization_id))?;
        if organization.provider_kind != "azdo" {
            return Err(AppError::InvalidInput(
                "Image paste requires Azure DevOps".into(),
            ));
        }
        let client = client_for_organization(&organization, &self.secrets)?;
        let pr = input
            .pr
            .as_ref()
            .map(|pr| (pr.repository_id.as_str(), pr.pull_request_id));
        Ok(client
            .upload_comment_attachment(&input.project_id, pr, &input.name, bytes)
            .await?)
    }
}
