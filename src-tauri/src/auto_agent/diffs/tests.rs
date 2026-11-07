use super::*;

fn builder() -> MaterialBuilder {
    MaterialBuilder::new(&PullRequestChanges {
        base_commit_id: Some("previous-head".into()),
        target_commit_id: Some("new-head".into()),
        files: vec![crate::pr_review::PrChangedFile {
            path: "/file.rs".into(),
            change_type: "edit".into(),
            original_path: None,
        }],
    })
}

fn diff(before: Option<&str>, after: Option<&str>) -> PrFileDiff {
    PrFileDiff {
        file_path: "/file.rs".into(),
        base_content: before.map(str::to_owned),
        target_content: after.map(str::to_owned),
        base_unavailable_reason: None,
        target_unavailable_reason: None,
    }
}

#[test]
fn separated_late_changes_are_kept_without_the_large_unchanged_middle() {
    let before = (0..20_000)
        .map(|i| format!("original {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let after = before
        .replace("original 2\n", "early edit\n")
        .replace("original 19997\n", "late edit\n");
    let mut material = builder();
    material.file("edit", None, &diff(Some(&before), Some(&after)));
    let material = material.finish();
    assert!(material.complete);
    assert!(material.has_content);
    assert!(material.document.contains("3: early edit"));
    assert!(material.document.contains("19998: late edit"));
    assert!(!material.document.contains("original 10000"));
    assert!(material.document.contains("Base commit: previous-head"));
    assert!(material.document.contains("Head commit: new-head"));
    assert!(material.document.len() < 3000);
}

#[test]
fn rename_and_delete_preserve_old_paths_and_line_numbers() {
    let mut material = builder();
    material.file(
        "edit, rename",
        Some("/old.rs"),
        &diff(Some("old"), Some("new")),
    );
    material.file("delete", None, &diff(Some("deleted line"), None));
    let material = material.finish();
    assert!(material.complete);
    assert!(material.document.contains("from /old.rs"));
    assert!(material.document.contains("1: deleted line"));
}

#[test]
fn unavailable_contents_are_not_reported_as_reviewable() {
    let mut material = builder();
    let mut file = diff(None, None);
    file.base_unavailable_reason = Some("binary".into());
    material.file("edit", None, &file);
    let material = material.finish();
    assert!(!material.has_content);
    assert!(!material.complete);
    assert!(material
        .document
        .contains("/file.rs: Before unavailable (binary)"));
}

#[test]
fn an_empty_added_file_is_still_readable() {
    let mut material = builder();
    material.file("add", None, &diff(None, Some("")));
    let material = material.finish();
    assert!(material.has_content);
    assert!(material.complete);
}

#[test]
fn a_final_newline_change_is_visible() {
    let mut material = builder();
    material.file("edit", None, &diff(Some("same\n"), Some("same")));
    let material = material.finish();
    assert!(material.complete);
    assert!(material.document.contains("Before=true, After=false"));
    assert!(material.document.contains("@@ Before"));
}

#[test]
fn byte_budget_marks_omitted_hunks_without_dropping_later_small_hunks() {
    let before = format!(
        "{}\n{}",
        "a".repeat(180_000),
        (0..50)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let after = before
        .replacen(&"a".repeat(180_000), &"b".repeat(180_000), 1)
        .replace("line 47\n", "late edit\n");
    let mut material = builder();
    material.file("edit", None, &diff(Some(&before), Some(&after)));
    let material = material.finish();
    assert!(!material.complete);
    assert!(material.document.len() <= MAX_BYTES);
    assert!(material.document.contains("Unreviewed coverage"));
    assert!(material.document.contains("late edit"));
}

#[test]
fn unicode_budget_uses_bytes_and_records_omission() {
    let mut material = builder();
    material.file("add", None, &diff(None, Some(&"漢".repeat(130_000))));
    let material = material.finish();
    assert!(!material.complete);
    assert!(!material.has_content);
    assert!(material.document.len() <= MAX_BYTES);
    assert!(material.document.contains("byte budget"));
}
