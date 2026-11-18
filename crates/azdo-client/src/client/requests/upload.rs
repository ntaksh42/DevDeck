use super::{decode_json, join_api_path, AdoClient, Result};
use serde::Deserialize;

#[derive(Deserialize)]
struct Attachment {
    url: String,
}

impl AdoClient {
    pub async fn upload_comment_attachment(
        &self,
        project: &str,
        pr: Option<(&str, i64)>,
        name: &str,
        bytes: Vec<u8>,
    ) -> Result<String> {
        let (path, query) = match pr {
            Some((repo, id)) => (
                format!(
                    "{project}/_apis/git/repositories/{repo}/pullRequests/{id}/attachments/{name}"
                ),
                vec![("api-version", "7.1")],
            ),
            None => (
                format!("{project}/_apis/wit/attachments"),
                vec![("api-version", "7.1"), ("fileName", name)],
            ),
        };
        let url = join_api_path(&self.base_url, &path)?;
        let attachment: Attachment = self
            .send_with_retry(
                "POST",
                url.as_str(),
                false,
                || {
                    self.http
                        .post(url.clone())
                        .query(&query)
                        .header("Content-Type", "application/octet-stream")
                        .body(bytes.clone())
                },
                |response| async move { decode_json(response).await },
            )
            .await?;
        Ok(attachment.url)
    }
}
