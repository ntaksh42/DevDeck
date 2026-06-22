use std::collections::HashMap;
use std::sync::Arc;

use azdo_client::{Identity, IdentityPickerIdentity, PatProvider};
use serde_json::json;
use url::Url;
use wiremock::matchers::{body_string_contains, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::db::OrganizationDraft;

async fn test_client(server: &MockServer) -> AdoClient {
    let base_url = Url::parse(&format!("{}/", server.uri())).unwrap();
    AdoClient::new("contoso", Arc::new(PatProvider::new("test-pat")))
        .unwrap()
        .with_base_url(base_url)
}

#[tokio::test]
async fn update_candidates_are_cached_per_work_item() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/p1/_apis/wit/workItems/42/updates"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "revisedBy": {
                    "id": "alice-id",
                    "displayName": "Alice",
                    "uniqueName": "alice@corp.com"
                },
                "fields": {}
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let service = WorkItemService::new(db, SecretStore);
    let client = test_client(&server).await;

    let first = service
        .update_candidates(&client, "contoso", "p1", 42)
        .await
        .unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].display_name, "Alice");

    // Second lookup within the TTL is served from cache (expect(1) above).
    let second = service
        .update_candidates(&client, "contoso", "p1", 42)
        .await
        .unwrap();
    assert_eq!(first, second);
}

fn make_org_draft() -> OrganizationDraft {
    OrganizationDraft {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: Some("contoso".to_string()),
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: None,
        authenticated_user_display_name: None,
        authenticated_user_unique_name: None,
    }
}

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

#[test]
fn summarize_mention_candidate_prefers_provider_display_name() {
    let mut properties = HashMap::new();
    properties.insert(
        "Mail".to_string(),
        azdo_client::identity::IdentityProperty {
            value: Some("alice@example.com".to_string()),
        },
    );
    let candidate = summarize_mention_candidate(Identity {
        id: Some("user-1".to_string()),
        descriptor: None,
        subject_descriptor: None,
        provider_display_name: Some("Alice Johnson".to_string()),
        custom_display_name: None,
        display_name: Some("Alice".to_string()),
        unique_name: None,
        properties: Some(properties),
    })
    .unwrap();

    assert_eq!(candidate.id, "user-1");
    assert_eq!(candidate.display_name, "Alice Johnson");
    assert_eq!(candidate.unique_name.as_deref(), Some("alice@example.com"));
}

#[test]
fn mention_candidate_from_identity_picker_prefers_local_id_guid() {
    let candidate = mention_candidate_from_identity_picker(IdentityPickerIdentity {
        entity_id: Some("entity-1".to_string()),
        origin_id: Some("origin-1".to_string()),
        local_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
        subject_descriptor: Some("aad.subject-1".to_string()),
        display_name: Some("naoto akashi".to_string()),
        mail_address: Some("aksh0402@outlook.jp".to_string()),
        sign_in_address: None,
        entity_type: Some("User".to_string()),
        active: Some(true),
    })
    .unwrap();

    // The id is embedded into @<id> markdown mentions; only the
    // storage-key GUID (localId) is resolved by Azure DevOps.
    assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
    assert_eq!(candidate.display_name, "naoto akashi");
    assert_eq!(
        candidate.unique_name.as_deref(),
        Some("aksh0402@outlook.jp")
    );
}

#[test]
fn mention_candidate_from_identity_picker_falls_back_to_descriptor() {
    let candidate = mention_candidate_from_identity_picker(IdentityPickerIdentity {
        entity_id: None,
        origin_id: None,
        local_id: None,
        subject_descriptor: Some("aad.subject-1".to_string()),
        display_name: Some("naoto akashi".to_string()),
        mail_address: None,
        sign_in_address: None,
        entity_type: Some("User".to_string()),
        active: Some(true),
    })
    .unwrap();

    assert_eq!(candidate.id, "aad.subject-1");
}

#[test]
fn mention_candidate_from_history_requires_guid_user_id() {
    let guid_entry = crate::db::MentionHistoryEntry {
        unique_name: "alice@corp.com".to_string(),
        display_name: "Alice".to_string(),
        user_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
    };
    let candidate = mention_candidate_from_history(guid_entry).unwrap();
    assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
    assert_eq!(candidate.unique_name.as_deref(), Some("alice@corp.com"));

    // Descriptor or missing ids would post @<id> tokens that Azure DevOps
    // silently drops; such history rows must be skipped.
    let descriptor_entry = crate::db::MentionHistoryEntry {
        unique_name: "bob@corp.com".to_string(),
        display_name: "Bob".to_string(),
        user_id: Some("aad.subject-2".to_string()),
    };
    assert!(mention_candidate_from_history(descriptor_entry).is_none());

    let missing_entry = crate::db::MentionHistoryEntry {
        unique_name: "carol@corp.com".to_string(),
        display_name: "Carol".to_string(),
        user_id: None,
    };
    assert!(mention_candidate_from_history(missing_entry).is_none());
}

#[test]
fn assignee_candidate_from_history_works_without_guid_user_id() {
    let entry = crate::db::MentionHistoryEntry {
        unique_name: "alice@corp.com".to_string(),
        display_name: "Alice".to_string(),
        user_id: Some("d6245f20-2af8-44f4-9451-8107cb2767db".to_string()),
    };
    let candidate = assignee_candidate_from_history(entry);
    assert_eq!(candidate.id, "d6245f20-2af8-44f4-9451-8107cb2767db");
    assert_eq!(candidate.unique_name.as_deref(), Some("alice@corp.com"));
    assert_eq!(candidate.assign_value, "Alice <alice@corp.com>");

    // Assignment posts "Display <unique>" instead of @<id> tokens, so a
    // history row without a GUID id is still usable.
    let missing_entry = crate::db::MentionHistoryEntry {
        unique_name: "carol@corp.com".to_string(),
        display_name: "Carol".to_string(),
        user_id: None,
    };
    let candidate = assignee_candidate_from_history(missing_entry);
    assert_eq!(candidate.id, "carol@corp.com");
    assert_eq!(candidate.assign_value, "Carol <carol@corp.com>");
}

#[test]
fn assignee_candidates_from_updates_skip_service_identity_history() {
    let mut fields = HashMap::new();
    fields.insert(
        "System.AssignedTo".to_string(),
        azdo_client::work_items::WorkItemFieldUpdate {
            old_value: Some(json!({
                "displayName": "Agent Pool Service (1)",
                "id": "0e8fc31f-c0d7-4b14-b430-76dfb6cf7b0f",
                "uniqueName": "AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c"
            })),
            new_value: Some(json!({
                "displayName": "naoto akashi",
                "id": "eb38825c-2181-6ba9-85c2-3d28e9e68978",
                "uniqueName": "aksh0402@outlook.jp"
            })),
        },
    );

    let candidates = assignee_candidates_from_updates(vec![WorkItemUpdate {
        id: 1,
        revised_by: Some(azdo_client::work_items::CommentIdentityRef {
            id: Some("0e8fc31f-c0d7-4b14-b430-76dfb6cf7b0f".to_string()),
            display_name: Some("Agent Pool Service (1)".to_string()),
            unique_name: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
        }),
        revised_date: None,
        fields,
    }]);

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].display_name, "naoto akashi");
    assert_eq!(
        candidates[0].unique_name.as_deref(),
        Some("aksh0402@outlook.jp")
    );
}

#[test]
fn summarize_mention_candidate_accepts_descriptor_without_id() {
    let candidate = summarize_mention_candidate(Identity {
        id: None,
        descriptor: Some("aad.descriptor-1".to_string()),
        subject_descriptor: None,
        provider_display_name: Some("Naoto Akashi".to_string()),
        custom_display_name: None,
        display_name: None,
        unique_name: Some("naoto@example.com".to_string()),
        properties: None,
    })
    .unwrap();

    assert_eq!(candidate.id, "aad.descriptor-1");
    assert_eq!(candidate.display_name, "Naoto Akashi");
    assert_eq!(candidate.unique_name.as_deref(), Some("naoto@example.com"));
}

#[test]
fn summarize_mention_candidate_skips_group_identity() {
    let mut properties = HashMap::new();
    properties.insert(
        "SchemaClassName".to_string(),
        azdo_client::identity::IdentityProperty {
            value: Some("Group".to_string()),
        },
    );

    let candidate = summarize_mention_candidate(Identity {
        id: Some("group-1".to_string()),
        descriptor: None,
        subject_descriptor: None,
        provider_display_name: Some("Project Collection Valid Users".to_string()),
        custom_display_name: None,
        display_name: None,
        unique_name: None,
        properties: Some(properties),
    });

    assert!(candidate.is_none());
}

#[test]
fn summarize_mention_candidate_skips_inactive_identity() {
    let mut properties = HashMap::new();
    properties.insert(
        "Active".to_string(),
        azdo_client::identity::IdentityProperty {
            value: Some("false".to_string()),
        },
    );

    let candidate = summarize_mention_candidate(Identity {
        id: Some("inactive-user".to_string()),
        descriptor: None,
        subject_descriptor: None,
        provider_display_name: Some("Inactive User".to_string()),
        custom_display_name: None,
        display_name: None,
        unique_name: Some("inactive@example.com".to_string()),
        properties: Some(properties),
    });

    assert!(candidate.is_none());
}

#[test]
fn summarize_mention_candidate_skips_azure_devops_service_identity() {
    let mut properties = HashMap::new();
    properties.insert(
        "Domain".to_string(),
        azdo_client::identity::IdentityProperty {
            value: Some("AgentPool".to_string()),
        },
    );
    properties.insert(
        "Account".to_string(),
        azdo_client::identity::IdentityProperty {
            value: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
        },
    );

    let candidate = summarize_mention_candidate(Identity {
        id: Some("agent-pool-service".to_string()),
        descriptor: None,
        subject_descriptor: None,
        provider_display_name: Some("Agent Pool Service (1)".to_string()),
        custom_display_name: None,
        display_name: None,
        unique_name: Some("AgentPool\\d67b727b-218f-4f2f-ae94-fd1d7ad5b42c".to_string()),
        properties: Some(properties),
    });

    assert!(candidate.is_none());
}

fn test_org(
    authenticated_user_id: Option<&str>,
    authenticated_user_display_name: Option<&str>,
) -> Organization {
    test_org_with_unique_name(authenticated_user_id, authenticated_user_display_name, None)
}

fn test_org_with_unique_name(
    authenticated_user_id: Option<&str>,
    authenticated_user_display_name: Option<&str>,
    authenticated_user_unique_name: Option<&str>,
) -> Organization {
    Organization {
        id: "contoso".to_string(),
        name: "contoso".to_string(),
        display_name: None,
        base_url: "https://dev.azure.com/contoso".to_string(),
        auth_provider: "pat".to_string(),
        credential_key: "azdodeck:org:contoso:pat".to_string(),
        authenticated_user_id: authenticated_user_id.map(ToString::to_string),
        authenticated_user_display_name: authenticated_user_display_name.map(ToString::to_string),
        authenticated_user_unique_name: authenticated_user_unique_name.map(ToString::to_string),
        created_at: "2026-05-24T00:00:00Z".to_string(),
        updated_at: "2026-05-24T00:00:00Z".to_string(),
    }
}

#[test]
fn is_authenticated_user_matches_by_id() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user("user-1", "someone else", None, &org));
    assert!(is_authenticated_user("USER-1", "someone else", None, &org));
}

#[test]
fn is_authenticated_user_matches_by_display_name() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "naoto akashi",
        None,
        &org
    ));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "Naoto Akashi",
        None,
        &org
    ));
}

#[test]
fn is_authenticated_user_matches_by_unique_name() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "someone else",
        Some("user-1"),
        &org
    ));
}

#[test]
fn is_authenticated_user_does_not_match_different_person() {
    let org = test_org(Some("user-1"), Some("naoto akashi"));
    assert!(!is_authenticated_user(
        "user-2",
        "other person",
        Some("other@example.com"),
        &org
    ));
}

#[test]
fn is_authenticated_user_no_stored_user_never_matches() {
    let org = test_org(None, None);
    assert!(!is_authenticated_user("user-1", "naoto akashi", None, &org));
}

#[test]
fn is_authenticated_user_matches_by_stored_unique_name() {
    let org = test_org_with_unique_name(
        Some("user-1"),
        Some("naoto akashi"),
        Some("naoto@example.com"),
    );
    assert!(is_authenticated_user(
        "descriptor-xyz",
        "someone else",
        Some("Naoto@Example.com"),
        &org
    ));
}

#[test]
fn is_authenticated_user_keeps_namesake_with_different_unique_name() {
    let org = test_org_with_unique_name(
        Some("user-1"),
        Some("naoto akashi"),
        Some("naoto@example.com"),
    );
    // Same display name but a different e-mail: this is another person.
    assert!(!is_authenticated_user(
        "descriptor-other",
        "naoto akashi",
        Some("other.naoto@example.com"),
        &org
    ));
    // Without a unique name we cannot prove it's someone else; keep filtering.
    assert!(is_authenticated_user(
        "descriptor-other",
        "naoto akashi",
        None,
        &org
    ));
}

#[tokio::test]
async fn sync_work_items_skips_not_found_project_and_keeps_other_results() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 2,
            "value": [
                { "id": "project-ok", "name": "Platform" },
                { "id": "project-missing", "name": "Archived" }
            ]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": [{ "id": 10 }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 10,
                "fields": {
                    "System.Title": "Keep synced item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-24T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-missing/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();
    let client = test_client(&server).await;

    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    do_sync_work_items(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].title, "Keep synced item");
    let my_cached = db.list_my_work_items(&org.id).unwrap();
    assert_eq!(my_cached.len(), 1);
    assert_eq!(my_cached[0].title, "Keep synced item");
}

#[test]
fn wiql_with_changed_date_filter_inserts_condition_before_order_by() {
    let filtered = wiql_with_changed_date_filter(SYNC_WI_WIQL, "2026-06-10");
    assert_eq!(
        filtered,
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
         AND [System.ChangedDate] >= '2026-06-10' ORDER BY [System.ChangedDate] DESC"
    );
}

#[tokio::test]
async fn sync_work_items_delta_preserves_items_missing_from_window() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-ok", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    // The "all items" query must carry the ChangedDate delta filter; the
    // "my items" query stays unfiltered. Without the filter no mock
    // matches and the sync fails.
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(body_string_contains("[System.ChangedDate] >="))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": [{ "id": 10 }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(body_string_contains("@Me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": []
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 10,
                "fields": {
                    "System.Title": "Fresh change",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-06-11T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();

    // Cached item outside the delta window: a full sync would delete it.
    db.upsert_work_items(&[CachedWorkItem {
        org_id: org.id.clone(),
        project_id: "project-ok".to_string(),
        project_name: "Platform".to_string(),
        id: 99,
        title: "Old but alive".to_string(),
        work_item_type: Some("Task".to_string()),
        state: Some("Active".to_string()),
        assigned_to: None,
        assigned_to_unique_name: None,
        changed_date: Some("2026-01-01T00:00:00Z".to_string()),
        web_url: None,
    }])
    .unwrap();

    let now = Utc::now().to_rfc3339();
    db.update_sync_state(
        &format!("work_items:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();
    db.update_sync_state(
        &full_sync_scope(&org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();

    let client = test_client(&server).await;
    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let result = do_sync_work_items(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();
    assert!(!result.was_full_sync);

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    let mut ids: Vec<i64> = cached.iter().map(|item| item.id).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![10, 99]);
}

#[tokio::test]
async fn sync_work_items_runs_full_sync_when_interval_elapsed() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();

    let now = Utc::now().to_rfc3339();
    let stale_full = (Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
    db.update_sync_state(
        &format!("work_items:{}", org.id),
        &org.id,
        Some(&now),
        0,
        None,
        None,
    )
    .unwrap();
    db.update_sync_state(
        &full_sync_scope(&org.id),
        &org.id,
        Some(&stale_full),
        0,
        None,
        None,
    )
    .unwrap();

    assert!(delta_sync_since(&db, &org).is_none());
}

#[tokio::test]
async fn sync_work_items_batches_more_than_two_hundred_ids() {
    let server = MockServer::start().await;
    let refs: Vec<_> = (1..=201).map(|id| json!({ "id": id })).collect();

    Mock::given(method("GET"))
        .and(path("/_apis/projects"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{ "id": "project-ok", "name": "Platform" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/wiql"))
        .and(query_param("api-version", "7.1-preview"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "workItems": refs
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_string_contains("\"ids\":[1,2,3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 1,
                "fields": {
                    "System.Title": "First batch item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-24T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/project-ok/_apis/wit/workitemsbatch"))
        .and(query_param("api-version", "7.1-preview"))
        .and(body_string_contains("\"ids\":[201]"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 1,
            "value": [{
                "id": 201,
                "fields": {
                    "System.Title": "Second batch item",
                    "System.WorkItemType": "Task",
                    "System.State": "Active",
                    "System.ChangedDate": "2026-05-23T00:00:00Z"
                }
            }]
        })))
        .mount(&server)
        .await;

    let db_file = tempfile::NamedTempFile::new().unwrap();
    let db = AppDatabase::new(db_file.path().to_path_buf());
    db.initialize().unwrap();
    let org = db.upsert_organization(make_org_draft()).unwrap();
    let client = test_client(&server).await;

    let projects = client.list_projects().await.unwrap();
    let budget: crate::sync::SyncBudget = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    sync_work_items_for_org(&db, &client, &org, &projects, &budget)
        .await
        .unwrap();

    let cached = db
        .search_work_items(&org.id, None, None, None, None)
        .unwrap();
    assert_eq!(cached.len(), 2);
    assert!(cached.iter().any(|item| item.id == 1));
    assert!(cached.iter().any(|item| item.id == 201));
    let state = db
        .get_sync_state(&format!("work_items:{}", org.id))
        .unwrap()
        .unwrap();
    assert_eq!(state.error_count, 0);
    assert!(state
        .last_warning
        .as_deref()
        .is_some_and(|warning| warning.contains("more than 200 IDs")));
}

#[test]
fn flatten_work_item_links_computes_depths_in_tree_order() {
    use azdo_client::WorkItemLink;
    let links = vec![
        WorkItemLink {
            source_id: None,
            target_id: 1,
        },
        WorkItemLink {
            source_id: Some(1),
            target_id: 2,
        },
        WorkItemLink {
            source_id: Some(2),
            target_id: 3,
        },
        WorkItemLink {
            source_id: None,
            target_id: 4,
        },
        WorkItemLink {
            source_id: Some(1),
            target_id: 2,
        },
    ];
    let (ids, depths) = flatten_work_item_links(links, 10);
    assert_eq!(ids, vec![1, 2, 3, 4]);
    assert_eq!(depths[&1], 0);
    assert_eq!(depths[&2], 1);
    assert_eq!(depths[&3], 2);
    assert_eq!(depths[&4], 0);
}

#[test]
fn flatten_work_item_links_respects_limit() {
    use azdo_client::WorkItemLink;
    let links = vec![
        WorkItemLink {
            source_id: None,
            target_id: 1,
        },
        WorkItemLink {
            source_id: Some(1),
            target_id: 2,
        },
        WorkItemLink {
            source_id: Some(1),
            target_id: 3,
        },
    ];
    let (ids, _) = flatten_work_item_links(links, 2);
    assert_eq!(ids, vec![1, 2]);
}

#[test]
fn validate_wiql_accepts_flat_and_link_sources() {
    assert!(validate_work_item_wiql("SELECT [System.Id] FROM WorkItems").is_ok());
    assert!(validate_work_item_wiql(
        "SELECT [System.Id] FROM WorkItemLinks WHERE [System.Links.LinkType] = 'Child' MODE (Recursive)"
    )
    .is_ok());
    assert!(validate_work_item_wiql("SELECT [System.Id]\nFROM\nWorkItems").is_ok());
    assert!(validate_work_item_wiql("SELECT [System.Id] FROM Bugs").is_err());
    assert!(validate_work_item_wiql("").is_err());
}

#[test]
fn validate_editable_field_reference_name_rules() {
    assert_eq!(
        validate_editable_field_reference_name(" Custom.ReleaseTrain ").unwrap(),
        "Custom.ReleaseTrain"
    );
    assert_eq!(
        validate_editable_field_reference_name("Microsoft.VSTS.Common.Severity").unwrap(),
        "Microsoft.VSTS.Common.Severity"
    );
    assert!(validate_editable_field_reference_name("System.Title").is_err());
    assert!(validate_editable_field_reference_name("system.state").is_err());
    assert!(validate_editable_field_reference_name("no-dot").is_err());
    assert!(validate_editable_field_reference_name("Custom.bad name").is_err());
}

// ---- push_unique_mention_candidate dedup tests ----

fn mc(id: &str, display_name: &str, unique_name: Option<&str>) -> MentionCandidate {
    MentionCandidate {
        id: id.to_string(),
        display_name: display_name.to_string(),
        unique_name: unique_name.map(|s| s.to_string()),
    }
}

#[test]
fn test_dedup_same_id() {
    let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
    push_unique_mention_candidate(&mut candidates, mc("id-1", "Alice Duplicate", None));
    assert_eq!(candidates.len(), 1);
}

#[test]
fn test_dedup_same_unique_name() {
    let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
    push_unique_mention_candidate(
        &mut candidates,
        mc("id-2", "Alice Smith", Some("alice@corp.com")),
    );
    assert_eq!(candidates.len(), 1);
}

#[test]
fn test_dedup_same_display_name_no_unique_name() {
    // Can't tell apart two "Alice" candidates with no unique_name — treat as duplicate.
    let mut candidates = vec![mc("id-1", "Alice", None)];
    push_unique_mention_candidate(&mut candidates, mc("id-2", "Alice", None));
    assert_eq!(candidates.len(), 1);
}

#[test]
fn test_dedup_same_display_name_one_missing_unique_name() {
    // One side lacks unique_name — can't confirm they're distinct, so treat as duplicate.
    let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
    push_unique_mention_candidate(&mut candidates, mc("id-2", "Alice", None));
    assert_eq!(candidates.len(), 1);
}

#[test]
fn test_keep_same_display_name_different_unique_names() {
    // Both sides have distinct unique_names — these are provably different people.
    let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
    push_unique_mention_candidate(
        &mut candidates,
        mc("id-2", "Alice", Some("alice.other@corp.com")),
    );
    assert_eq!(candidates.len(), 2);
}

#[test]
fn test_keep_entirely_different_candidate() {
    let mut candidates = vec![mc("id-1", "Alice", Some("alice@corp.com"))];
    push_unique_mention_candidate(&mut candidates, mc("id-2", "Bob", Some("bob@corp.com")));
    assert_eq!(candidates.len(), 2);
}

#[test]
fn prioritized_relation_links_keep_parent_child_over_cap() {
    // Many low-priority "Related" links come back before the high-priority
    // Parent/Child links. Truncating before sorting (the old behavior) would
    // drop Parent/Child; sorting first must keep them.
    let mut raw: Vec<WorkItemRelation> = (0..60)
        .map(|i| WorkItemRelation {
            rel: "System.LinkTypes.Related".to_string(),
            url: format!(
                "https://dev.azure.com/contoso/_apis/wit/workItems/{}",
                1000 + i
            ),
            attributes: None,
        })
        .collect();
    raw.push(WorkItemRelation {
        rel: "System.LinkTypes.Hierarchy-Reverse".to_string(),
        url: "https://dev.azure.com/contoso/_apis/wit/workItems/7".to_string(),
        attributes: None,
    });
    raw.push(WorkItemRelation {
        rel: "System.LinkTypes.Hierarchy-Forward".to_string(),
        url: "https://dev.azure.com/contoso/_apis/wit/workItems/8".to_string(),
        attributes: None,
    });

    let links = prioritized_relation_links(&raw, MAX_PREVIEW_RELATIONS);

    assert_eq!(links.len(), MAX_PREVIEW_RELATIONS);
    assert_eq!(links[0], ("Parent".to_string(), 0, 7));
    assert_eq!(links[1], ("Child".to_string(), 1, 8));
}
