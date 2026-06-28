use std::collections::HashMap;

use azdo_client::{Identity, IdentityPickerIdentity};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::super::*;
use super::test_client;

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
