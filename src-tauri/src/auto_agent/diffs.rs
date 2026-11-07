//! The changed code of a pull request, as material for the agent. The agent
//! often has no clone of the repository, so the material has to carry the
//! changes themselves, not just the file names.

use crate::pr_review::{
    GetPullRequestFileDiffInput, PrFileDiff, PrLocator, PrReviewService, PullRequestChanges,
};

/// Files whose changes are included; the rest are listed by name only.
const MAX_FILES: usize = 40;
/// Characters kept per side of one file's changed region.
const MAX_SIDE_CHARS: usize = 12_000;
/// Unchanged lines kept around the changed region.
const CONTEXT_LINES: usize = 3;

/// Markdown with the changed region of each changed file. Empty when no file's
/// content could be fetched, which the caller treats as "nothing to review".
pub(super) async fn section(
    service: &PrReviewService,
    locator: impl Fn() -> PrLocator,
    changes: &PullRequestChanges,
) -> String {
    let mut blocks = Vec::new();
    for file in changes.files.iter().take(MAX_FILES) {
        let diff = service
            .get_file_diff(GetPullRequestFileDiffInput {
                pr: locator(),
                file_path: file.path.clone(),
                original_path: file.original_path.clone(),
                change_type: file.change_type.clone(),
                base_commit_id: changes.base_commit_id.clone(),
                target_commit_id: changes.target_commit_id.clone(),
            })
            .await;
        match diff {
            Ok(diff) => blocks.push(file_block(&file.change_type, &diff)),
            Err(error) => {
                tracing::warn!(path = %file.path, ?error, "auto agent: diff unavailable");
            }
        }
    }
    if blocks.is_empty() {
        return String::new();
    }
    let omitted = changes.files.len().saturating_sub(MAX_FILES);
    let mut text = format!("## Changes\n\n{}", blocks.join("\n\n"));
    if omitted > 0 {
        text.push_str(&format!(
            "\n\n({omitted} more changed files are not shown.)"
        ));
    }
    text
}

fn file_block(change_type: &str, diff: &PrFileDiff) -> String {
    let (before, after) = changed_region(
        diff.base_content.as_deref().unwrap_or_default(),
        diff.target_content.as_deref().unwrap_or_default(),
    );
    let mut block = format!("### {} {}", change_type, diff.file_path);
    for (label, text, reason) in [
        ("Before", before, &diff.base_unavailable_reason),
        ("After", after, &diff.target_unavailable_reason),
    ] {
        if let Some(reason) = reason {
            block.push_str(&format!("\n{label}: unavailable ({reason})"));
        } else if !text.is_empty() {
            let shown: String = text.chars().take(MAX_SIDE_CHARS).collect();
            let cut = if shown.len() < text.len() {
                "\n…"
            } else {
                ""
            };
            block.push_str(&format!("\n{label}:\n```\n{shown}{cut}\n```"));
        }
    }
    block
}

/// The lines that differ between `before` and `after`, with a few unchanged
/// lines around them: everything between the common leading and trailing lines.
pub(super) fn changed_region(before: &str, after: &str) -> (String, String) {
    let before: Vec<&str> = before.lines().collect();
    let after: Vec<&str> = after.lines().collect();
    let prefix = before
        .iter()
        .zip(&after)
        .take_while(|(a, b)| a == b)
        .count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let start = prefix.saturating_sub(CONTEXT_LINES);
    let slice = |lines: &[&str]| {
        let end = (lines.len() - suffix + CONTEXT_LINES).min(lines.len());
        lines[start.min(end)..end].join("\n")
    };
    (slice(&before), slice(&after))
}
