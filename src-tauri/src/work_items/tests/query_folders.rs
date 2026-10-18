use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::super::metadata::expand_truncated_query_folders;
use super::*;

fn folder(id: &str, name: &str, children: serde_json::Value) -> serde_json::Value {
    json!({ "id": id, "name": name, "isFolder": true, "hasChildren": true, "children": children })
}

fn truncated_folder(id: &str, name: &str) -> serde_json::Value {
    json!({ "id": id, "name": name, "isFolder": true, "hasChildren": true })
}

fn leaf(id: &str, name: &str) -> serde_json::Value {
    json!({ "id": id, "name": name, "isFolder": false, "wiql": "SELECT [System.Id] FROM WorkItems" })
}

#[tokio::test]
async fn expands_folders_cut_off_by_depth() {
    let server = MockServer::start().await;
    // `$depth=2` stops above Team/Sub, so it arrives without its contents.
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/queries/sub"))
        .and(query_param("$depth", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(folder(
            "sub",
            "Sub",
            json!([
                leaf("deep", "Deep Query"),
                truncated_folder("deeper", "Deeper")
            ]),
        )))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/queries/deeper"))
        .respond_with(ResponseTemplate::new(200).set_body_json(folder(
            "deeper",
            "Deeper",
            json!([leaf("deepest", "Deepest Query")]),
        )))
        .expect(1)
        .mount(&server)
        .await;

    let mut roots: Vec<azdo_client::QueryHierarchyItem> = serde_json::from_value(json!([folder(
        "shared",
        "Shared Queries",
        json!([folder(
            "team",
            "Team",
            json!([truncated_folder("sub", "Sub")])
        )]),
    )]))
    .unwrap();

    let client = test_client(&server).await;
    expand_truncated_query_folders(&client, "project-1", &mut roots).await;

    let mut queries = Vec::new();
    for root in &roots {
        flatten_query_hierarchy(root, "", &mut queries);
    }
    let found: Vec<(String, String)> = queries
        .into_iter()
        .map(|q| (q.folder_path, q.name))
        .collect();
    assert_eq!(
        found,
        vec![
            (
                "Shared Queries/Team/Sub".to_string(),
                "Deep Query".to_string()
            ),
            (
                "Shared Queries/Team/Sub/Deeper".to_string(),
                "Deepest Query".to_string()
            ),
        ]
    );
}

#[tokio::test]
async fn failed_folder_is_not_retried() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/project-1/_apis/wit/queries/broken"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;

    let mut roots: Vec<azdo_client::QueryHierarchyItem> = serde_json::from_value(json!([folder(
        "shared",
        "Shared Queries",
        json!([leaf("ok", "Visible"), truncated_folder("broken", "Broken")]),
    )]))
    .unwrap();

    let client = test_client(&server).await;
    expand_truncated_query_folders(&client, "project-1", &mut roots).await;

    let mut queries = Vec::new();
    flatten_query_hierarchy(&roots[0], "", &mut queries);
    assert_eq!(queries.len(), 1);
    assert_eq!(queries[0].name, "Visible");
}
