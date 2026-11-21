use std::sync::Arc;

use url::Url;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::PatProvider;
use crate::client::AdoClient;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("testorg", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn list_work_item_updates_keeps_the_latest_across_pages() {
    let server = MockServer::start().await;
    let page = |from: i64, to: i64| {
        let value: Vec<_> = (from..=to)
            .map(|id| serde_json::json!({ "id": id, "rev": id, "fields": {} }))
            .collect();
        ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({ "count": value.len(), "value": value }))
    };
    for (skip, response) in [("0", page(1, 200)), ("200", page(201, 230))] {
        Mock::given(method("GET"))
            .and(path("/project-1/_apis/wit/workItems/10/updates"))
            .and(query_param("$skip", skip))
            .respond_with(response)
            .expect(1)
            .mount(&server)
            .await;
    }

    let updates = test_client(&server)
        .await
        .list_work_item_updates("project-1", 10, 50)
        .await
        .unwrap();

    let ids: Vec<i64> = updates.iter().map(|u| u.id).collect();
    assert_eq!(ids, (181..=230).collect::<Vec<_>>());
}
