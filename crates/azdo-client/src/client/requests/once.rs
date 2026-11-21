use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{AdoClient, Result};

impl AdoClient {
    /// PATCH whose body is not safe to apply twice (a JSON Patch that appends
    /// to or removes from a list by index), so an ambiguous 5xx or timeout is
    /// not retried: the first attempt may already have been applied.
    pub(crate) async fn patch_json_once<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
        content_type: &str,
        body: &B,
    ) -> Result<T> {
        self.patch_json_with(path, query, content_type, body, false)
            .await
    }
}
