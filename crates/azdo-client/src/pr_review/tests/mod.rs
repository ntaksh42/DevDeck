use std::sync::Arc;

use url::Url;
use wiremock::MockServer;

use crate::auth::PatProvider;
use crate::client::AdoClient;

mod labels;
mod pr_ops;
mod threads;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}
