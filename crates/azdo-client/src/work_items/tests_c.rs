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
async fn list_work_item_comments_includes_reactions() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/workItems/42/comments"))
        .and(query_param("$expand", "all"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "comments": [{
                "id": 7,
                "text": "Looks good",
                "reactions": [
                    { "type": "like", "count": 2, "isCurrentUserEngaged": true },
                    { "type": "heart", "count": 1, "isCurrentUserEngaged": false }
                ]
            }]
        })))
        .mount(&server)
        .await;

    let comments = test_client(&server)
        .await
        .list_work_item_comments("project-1", 42, 50)
        .await
        .unwrap();
    assert_eq!(comments[0].reactions.len(), 2);
    assert_eq!(comments[0].reactions[0].reaction_type, "like");
    assert_eq!(comments[0].reactions[0].count, 2);
    assert!(comments[0].reactions[0].is_current_user_engaged);
}

#[tokio::test]
async fn set_work_item_comment_reaction_puts_and_deletes() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/project-1/_apis/wit/workItems/42/comments/7/reactions/like",
        ))
        .and(query_param("api-version", "7.1-preview.1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "type": "like", "count": 1, "isCurrentUserEngaged": true
        })))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(
            "/project-1/_apis/wit/workItems/42/comments/7/reactions/heart",
        ))
        .and(query_param("api-version", "7.1-preview.1"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let client = test_client(&server).await;
    client
        .set_work_item_comment_reaction("project-1", 42, 7, "like", true)
        .await
        .unwrap();
    client
        .set_work_item_comment_reaction("project-1", 42, 7, "heart", false)
        .await
        .unwrap();
}
