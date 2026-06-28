use super::super::*;

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

#[test]
fn validate_update_field_reference_name_allows_title() {
    assert_eq!(
        validate_update_field_reference_name(" system.title ").unwrap(),
        "System.Title"
    );
    assert_eq!(
        validate_update_field_reference_name("System.State").unwrap(),
        "System.State"
    );
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
