use rusqlite::params;

use super::test_support::make_org_draft;
use super::*;

/// The filters must apply before the row limit: when the newest matches all
/// sit in other projects, the filtered project still gets its own matches.
#[test]
fn text_search_filters_before_the_row_limit() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    upsert_organization(&conn, make_org_draft("org1")).unwrap();
    for id in 1..=250_i64 {
        conn.execute(
            "INSERT INTO work_items(org_id, project_id, project_name, id, title, changed_date) \
             VALUES ('org1', 'other', 'Other', ?1, 'login page', ?2)",
            params![id, format!("2026-10-01T00:00:{:02}Z", id % 60)],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO work_items(org_id, project_id, project_name, id, title, changed_date) \
         VALUES ('org1', 'mine', 'Mine', 9001, 'login timeout', '2025-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    let mine = vec!["mine".to_string()];
    let filters = WorkItemFilters {
        project_ids: Some(&mine),
        ..WorkItemFilters::default()
    };
    let results = search_work_items_text(&conn, "org1", "login", filters).unwrap();
    assert_eq!(
        results.iter().map(|item| item.id).collect::<Vec<_>>(),
        vec![9001]
    );

    // The id-prefix path honours the filters too.
    let results = search_work_items_text(&conn, "org1", "9", filters).unwrap();
    assert_eq!(
        results.iter().map(|item| item.id).collect::<Vec<_>>(),
        vec![9001]
    );
}
