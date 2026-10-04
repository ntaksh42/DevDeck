use std::sync::Arc;

use azdo_client::PatProvider;
use url::Url;
use wiremock::MockServer;

use super::*;

mod authenticated_user;
mod candidates;
mod conversions;
mod mutations;
mod pull_request_links;
mod sync;
mod sync_capped;

pub(super) async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}
