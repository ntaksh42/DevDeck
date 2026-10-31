use azdo_client::CommentIdentityRef;

use std::collections::HashMap;

use azdo_client::WorkItemComment;

use super::wi_mentions::*;
use crate::db::StateInboxRef;

// Real ids are GUIDs; a short id would also match ordinary words.
const ME: &str = "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7";

fn comment(id: i64, author: &str, text: &str) -> WorkItemComment {
    WorkItemComment {
        id,
        text: Some(text.to_string()),
        rendered_text: None,
        created_date: None,
        created_by: Some(CommentIdentityRef {
            id: Some(author.to_string()),
            display_name: Some(format!("{author}-name")),
            unique_name: None,
        }),
        reactions: Vec::new(),
    }
}

#[test]
fn markup_is_reduced_to_readable_text() {
    assert_eq!(
        strip_markup("<div>Hi <a href=\"#\" data-vss-mention=\"version:2.0,abc\">@Me</a>&nbsp;&amp; <b>you</b></div>"),
        "Hi @Me & you"
    );
}

#[test]
fn first_observation_only_records_the_cursor() {
    let comments = [comment(5, "other", &format!("@<{ME}> look"))];
    let (hits, max) = work_item_comment_hits(&comments, ME, None, false);
    assert!(hits.is_empty());
    assert_eq!(max, Some(5));
}

#[test]
fn new_mentions_by_others_are_reported_oldest_first() {
    let comments = [
        comment(
            9,
            "tanaka",
            &format!(
                "<div><a data-vss-mention=\"version:2.0,{ME}\">@Me</a> please <b>check</b></div>"
            ),
        ),
        comment(8, "suzuki", &format!("@<{}> second", ME.to_uppercase())),
        comment(7, ME, &format!("@<{ME}> my own note")),
        comment(6, "tanaka", "no mention here"),
        comment(3, "tanaka", &format!("@<{ME}> already seen")),
    ];
    let (hits, max) = work_item_comment_hits(&comments, ME, Some(5), false);
    assert_eq!(max, Some(9));
    let ids: Vec<i64> = hits.iter().map(|h| h.comment_id).collect();
    assert_eq!(ids, vec![8, 9]);
    assert_eq!(hits[0].snippet, "@you second");
    assert_eq!(hits[1].snippet, "@Me please check");
    assert_eq!(hits[1].author.as_deref(), Some("tanaka-name"));
}

#[test]
fn a_later_comment_by_me_answers_the_mention() {
    let open = [
        StateInboxRef {
            id: 1,
            kind: KIND_WI_MENTION.into(),
            repository_id: String::new(),
            subject_id: 42,
            comment_id: 10,
        },
        StateInboxRef {
            id: 2,
            kind: KIND_WI_MENTION.into(),
            repository_id: String::new(),
            subject_id: 42,
            comment_id: 20,
        },
    ];
    let refs: Vec<&StateInboxRef> = open.iter().collect();
    let comments = [
        comment(10, "tanaka", &format!("@<{ME}> a")),
        comment(15, ME, "done"),
        comment(20, "tanaka", &format!("@<{ME}> b")),
    ];
    assert_eq!(answered_mention_ids(&comments, ME, &refs), vec![1]);
}

#[test]
fn mentions_of_finished_work_items_are_finished() {
    let work_item = |id: i64, state: &str| azdo_client::WorkItem {
        id,
        fields: HashMap::from([("System.State".to_string(), state.into())]),
        links: None,
        relations: Vec::new(),
    };
    let open = [(1, 42), (2, 43), (3, 44)].map(|(id, subject_id)| StateInboxRef {
        id,
        kind: KIND_WI_MENTION.into(),
        repository_id: String::new(),
        subject_id,
        comment_id: 1,
    });
    let items = [
        work_item(42, "Closed"),
        work_item(43, "Active"),
        work_item(44, "Removed"),
    ];
    assert_eq!(finished_mention_ids(&items, &open), vec![1, 3]);
}

#[test]
fn replies_count_on_followed_items_and_after_my_comment() {
    let comments = [
        comment(4, "tanaka", "question"),
        comment(5, ME, "my answer"),
        comment(6, "tanaka", "thanks"),
        comment(7, "suzuki", &format!("@<{ME}> one more")),
    ];
    let kinds = |seen: i64, followed: bool| -> Vec<(i64, &'static str)> {
        work_item_comment_hits(&comments, ME, Some(seen), followed)
            .0
            .into_iter()
            .map(|hit| (hit.comment_id, hit.kind))
            .collect()
    };
    // Comment 4 comes before mine, so it is only a reply on a followed item.
    assert_eq!(
        kinds(3, false),
        vec![(6, KIND_WI_REPLY), (7, KIND_WI_MENTION)]
    );
    assert_eq!(
        kinds(3, true),
        vec![(4, KIND_WI_REPLY), (6, KIND_WI_REPLY), (7, KIND_WI_MENTION)]
    );
}
