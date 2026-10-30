//! The note text and the material handed to the agent, which has no Azure
//! DevOps access. Mirrors the frontend's `contextDocument.ts` for the parts an
//! automatic run can gather.

use std::sync::LazyLock;

use regex::Regex;

use crate::agent_notes::NoteTarget;
use crate::db::CachedReviewPr;
use crate::pr_review::{PullRequestChanges, PullRequestReview};
use crate::work_items::WorkItemPreview;

const MAX_CHARS: usize = 400_000;

pub(super) fn note_body(target: NoteTarget, result_folder: &str) -> String {
    let (what, folder) = match target {
        NoteTarget::PullRequest => ("この PR をレビュー", "Review result folder"),
        _ => ("この Work Item を調査", "Work item result folder"),
    };
    format!(
        "DevDeck の自動実行です。{what}し、結果 HTML を {folder} (`{result_folder}`) に作ってください。\n\
         - 読み取り専用: コードやブランチは変更しない。\n\
         - PR / WI へのコメントの提案 (`post`) は書かない。\n\
         - 資料は `context_file` と手元のクローンから得る。"
    )
}

fn fields(rows: &[(&str, Option<String>)]) -> String {
    rows.iter()
        .filter_map(|(name, value)| {
            value
                .as_deref()
                .filter(|v| !v.is_empty())
                .map(|v| format!("- {name}: {v}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn or_none(text: String) -> String {
    if text.trim().is_empty() {
        "(none)".to_string()
    } else {
        text
    }
}

fn finish(sections: Vec<String>) -> String {
    let text = sections
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    text.chars().take(MAX_CHARS).collect()
}

pub(super) fn pull_request(
    pr: &CachedReviewPr,
    review: &PullRequestReview,
    changes: Option<&PullRequestChanges>,
) -> String {
    let threads = review
        .threads
        .iter()
        .filter_map(|thread| {
            let comments: Vec<String> = thread
                .comments
                .iter()
                .filter(|c| !c.is_system)
                .filter_map(|c| {
                    let content = c.content.as_deref().filter(|t| !t.is_empty())?;
                    Some(format!(
                        "  - {}: {content}",
                        c.author.as_deref().unwrap_or("?")
                    ))
                })
                .collect();
            if comments.is_empty() {
                return None;
            }
            let place = match (&thread.file_path, thread.right_line) {
                (Some(path), Some(line)) => format!(" ({path}:{line})"),
                (Some(path), None) => format!(" ({path})"),
                _ => String::new(),
            };
            let status = if thread.is_resolved {
                "resolved"
            } else {
                thread.status.as_deref().unwrap_or("active")
            };
            Some(format!(
                "- Thread {} [{status}]{place}\n{}",
                thread.id,
                comments.join("\n")
            ))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let reviewers = review
        .reviewers
        .iter()
        .map(|r| format!("{} ({})", r.display_name, r.vote_label))
        .collect::<Vec<_>>()
        .join(", ");
    let files = match changes {
        Some(changes) => or_none(
            changes
                .files
                .iter()
                .map(|f| format!("- {} {}", f.change_type, f.path))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        None => "(unavailable)".to_string(),
    };
    finish(vec![
        format!(
            "# Pull request !{}: {}",
            review.pull_request_id, review.title
        ),
        fields(&[
            ("Repository", Some(pr.repository_name.clone())),
            ("Source", Some(review.source_ref_name.clone())),
            ("Target", Some(review.target_ref_name.clone())),
            ("Author", review.created_by.clone()),
            ("Created", review.creation_date.clone()),
            ("Reviewers", Some(reviewers)),
            ("URL", pr.web_url.clone()),
        ]),
        "## Description".to_string(),
        or_none(review.description.clone().unwrap_or_default()),
        "## Changed files".to_string(),
        files,
        "## Comment threads".to_string(),
        or_none(threads),
    ])
}

pub(super) fn work_item(item: &WorkItemPreview) -> String {
    let mut rows = vec![
        ("Type", item.work_item_type.clone()),
        ("State", item.state.clone()),
        ("Reason", item.reason.clone()),
        ("Assigned to", item.assigned_to.clone()),
        ("Created by", item.created_by.clone()),
        ("Created", item.created_date.clone()),
        ("Changed", item.changed_date.clone()),
        ("Area", item.area_path.clone()),
        ("Iteration", item.iteration_path.clone()),
        ("Priority", item.priority.clone()),
        ("Severity", item.severity.clone()),
        ("Tags", item.tags.clone()),
    ];
    rows.extend(
        item.custom_fields
            .iter()
            .map(|f| (f.reference_name.as_str(), f.value.clone())),
    );
    rows.push(("URL", item.web_url.clone()));
    let pull_requests = item
        .pull_requests
        .iter()
        .map(|pr| {
            format!(
                "- !{} {} [{}] {}",
                pr.pull_request_id,
                pr.title.as_deref().unwrap_or_default(),
                pr.status.as_deref().unwrap_or_default(),
                pr.web_url.as_deref().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let comments = item
        .comments
        .iter()
        .map(|c| {
            let text = c
                .rendered_text
                .as_deref()
                .or(c.text.as_deref())
                .unwrap_or_default();
            format!(
                "- {} ({}):\n\n{}",
                c.created_by.as_deref().unwrap_or("?"),
                c.created_date.as_deref().unwrap_or_default(),
                html_to_text(text)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let criteria = item
        .acceptance_criteria_html
        .as_deref()
        .map(html_to_text)
        .filter(|t| !t.is_empty())
        .map(|t| format!("## Acceptance criteria\n\n{t}"))
        .unwrap_or_default();
    finish(vec![
        format!("# Work item #{}: {}", item.id, item.title),
        fields(&rows),
        "## Description".to_string(),
        or_none(html_to_text(
            item.description_html.as_deref().unwrap_or_default(),
        )),
        criteria,
        "## Linked pull requests".to_string(),
        or_none(pull_requests),
        "## Comments (newest first)".to_string(),
        or_none(comments),
    ])
}

/// Plain text of Azure DevOps rich text: block tags become line breaks, other
/// tags are dropped and the common entities decoded.
pub(super) fn html_to_text(html: &str) -> String {
    static BREAK: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>|</(p|div|li|tr|h[1-6])>").unwrap());
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());
    static BLANK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n\s*\n(\s*\n)+").unwrap());
    let text = BREAK.replace_all(html, "\n");
    let text = TAG.replace_all(&text, "");
    let text = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    BLANK.replace_all(&text, "\n\n").trim().to_string()
}
