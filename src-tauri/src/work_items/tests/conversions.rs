use std::collections::HashMap;

use azdo_client::ClassificationNode;
use serde_json::json;

use super::super::*;

#[test]
fn pull_request_id_from_artifact_parses_git_links() {
    assert_eq!(
        pull_request_id_from_artifact("vstfs:///Git/PullRequestId/proj-guid%2Frepo-guid%2F4321"),
        Some(4321)
    );
    // Already-decoded separators are tolerated too.
    assert_eq!(
        pull_request_id_from_artifact("vstfs:///Git/PullRequestId/proj/repo/77"),
        Some(77)
    );
    // Non-PR artifact links and work item links are ignored.
    assert_eq!(
        pull_request_id_from_artifact("vstfs:///Git/Commit/proj%2Frepo%2Fabc"),
        None
    );
    assert_eq!(
        pull_request_id_from_artifact("https://dev.azure.com/org/_apis/wit/workItems/5"),
        None
    );
}

#[test]
fn extract_attachments_keeps_only_attached_files() {
    let relations = vec![
        WorkItemRelation {
            rel: "AttachedFile".to_string(),
            url: "https://dev.azure.com/org/_apis/wit/attachments/guid-1".to_string(),
            attributes: Some(azdo_client::WorkItemRelationAttributes {
                name: Some("repro.png".to_string()),
            }),
        },
        WorkItemRelation {
            rel: "System.LinkTypes.Related".to_string(),
            url: "https://dev.azure.com/org/_apis/wit/workItems/5".to_string(),
            attributes: None,
        },
        // Missing attribute name falls back to the URL's last segment.
        WorkItemRelation {
            rel: "AttachedFile".to_string(),
            url: "https://dev.azure.com/org/_apis/wit/attachments/guid-2".to_string(),
            attributes: None,
        },
    ];
    let attachments = extract_attachments(&relations);
    assert_eq!(attachments.len(), 2);
    assert_eq!(attachments[0].name, "repro.png");
    assert_eq!(attachments[1].name, "guid-2");
}

#[test]
fn summarize_maps_identity_object() {
    let organization = Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: Some("contoso".to_string()),
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
        provider_kind: "azdo".to_string(),
    };
    let mut fields = HashMap::new();
    fields.insert("System.Title".to_string(), json!("Fix save"));
    fields.insert("System.WorkItemType".to_string(), json!("Bug"));
    fields.insert("System.State".to_string(), json!("Active"));
    fields.insert(
        "System.AssignedTo".to_string(),
        json!({ "displayName": "Test User" }),
    );

    let summary = summarize_work_item(
        &organization,
        "project-1",
        "Platform Team",
        WorkItem {
            id: 123,
            fields,
            links: None,
        },
    );

    assert_eq!(summary.title, "Fix save");
    assert_eq!(summary.assigned_to.as_deref(), Some("Test User"));
    assert_eq!(
        summary.web_url.as_deref(),
        Some("https://dev.azure.com/contoso/Platform%20Team/_workitems/edit/123")
    );
}

#[test]
fn summarize_preview_maps_rich_fields() {
    let organization = Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: Some("contoso".to_string()),
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
        provider_kind: "azdo".to_string(),
    };
    let mut fields = HashMap::new();
    fields.insert("System.Title".to_string(), json!("Preview WIT"));
    fields.insert("System.WorkItemType".to_string(), json!("User Story"));
    fields.insert("System.State".to_string(), json!("Active"));
    fields.insert(
        "System.CreatedBy".to_string(),
        json!({ "displayName": "Creator" }),
    );
    fields.insert("System.Description".to_string(), json!("<p>Body</p>"));
    fields.insert("Microsoft.VSTS.Common.Priority".to_string(), json!(2));

    let preview = summarize_work_item_preview(
        &organization,
        "project-1",
        "Platform",
        WorkItem {
            id: 456,
            fields,
            links: None,
        },
        vec![],
    );

    assert_eq!(preview.title, "Preview WIT");
    assert_eq!(preview.created_by.as_deref(), Some("Creator"));
    assert_eq!(preview.description_html.as_deref(), Some("<p>Body</p>"));
    assert_eq!(preview.priority.as_deref(), Some("2"));
}

#[test]
fn summarize_preview_uses_repro_steps_as_description_fallback() {
    let organization = Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: Some("contoso".to_string()),
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
        provider_kind: "azdo".to_string(),
    };
    let mut fields = HashMap::new();
    fields.insert("System.Title".to_string(), json!("Bug preview"));
    fields.insert("System.Description".to_string(), json!(" "));
    fields.insert(
        "Microsoft.VSTS.TCM.ReproSteps".to_string(),
        json!("<div>Steps from bug field</div>"),
    );

    let preview = summarize_work_item_preview(
        &organization,
        "project-1",
        "Platform",
        WorkItem {
            id: 457,
            fields,
            links: None,
        },
        vec![],
    );

    assert_eq!(
        preview.description_html.as_deref(),
        Some("<div>Steps from bug field</div>")
    );
}

fn area_node(name: &str, children: Vec<ClassificationNode>) -> ClassificationNode {
    ClassificationNode {
        name: name.to_string(),
        structure_type: Some("area".to_string()),
        has_children: !children.is_empty(),
        children,
        attributes: None,
    }
}

#[test]
fn flatten_classification_node_builds_field_paths_from_names() {
    let tree = area_node(
        "Platform",
        vec![
            area_node("Web", vec![]),
            area_node("API", vec![area_node("Gateway", vec![])]),
        ],
    );

    let mut out = Vec::new();
    flatten_classification_node(&tree, None, 0, &mut out);

    let paths: Vec<(&str, usize)> = out.iter().map(|n| (n.path.as_str(), n.depth)).collect();
    assert_eq!(
        paths,
        vec![
            ("Platform", 0),
            ("Platform\\Web", 1),
            ("Platform\\API", 1),
            ("Platform\\API\\Gateway", 2),
        ]
    );
}
