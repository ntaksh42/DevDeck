//! Bounded, line-numbered review material. Missing coverage is always explicit.

use std::collections::HashMap;
use std::ops::Range;

use crate::error::Result;
use crate::pr_review::{
    GetPullRequestFileDiffInput, PrFileDiff, PrLocator, PrReviewService, PullRequestChanges,
};

const MAX_FILES: usize = 40;
const MAX_BYTES: usize = 350_000;
const RESERVED_BYTES: usize = 8_000;
const CONTEXT_LINES: usize = 3;

pub(super) struct DiffMaterial {
    pub document: String,
    pub complete: bool,
    pub has_content: bool,
}

pub(super) async fn section(
    service: &PrReviewService,
    locator: impl Fn() -> PrLocator,
    changes: &PullRequestChanges,
) -> Result<DiffMaterial> {
    let mut material = MaterialBuilder::new(changes);
    for (index, file) in changes.files.iter().enumerate() {
        if index >= MAX_FILES {
            material.omit(&format!("{}: file limit", file.path));
            continue;
        }
        // A transient error must retry the review rather than permanently
        // marking an incomplete snapshot as reviewed.
        let diff = service
            .get_file_diff(GetPullRequestFileDiffInput {
                pr: locator(),
                file_path: file.path.clone(),
                original_path: file.original_path.clone(),
                change_type: file.change_type.clone(),
                base_commit_id: changes.base_commit_id.clone(),
                target_commit_id: changes.target_commit_id.clone(),
            })
            .await?;
        material.file(&file.change_type, file.original_path.as_deref(), &diff);
    }
    Ok(material.finish())
}

struct MaterialBuilder {
    document: String,
    omitted: Vec<String>,
    omitted_count: usize,
    has_content: bool,
}

impl MaterialBuilder {
    fn new(changes: &PullRequestChanges) -> Self {
        Self {
            document: format!(
                "## Changes\n\nBase commit: {}\nHead commit: {}\n",
                changes.base_commit_id.as_deref().unwrap_or("unavailable"),
                changes.target_commit_id.as_deref().unwrap_or("unavailable")
            ),
            omitted: Vec::new(),
            omitted_count: 0,
            has_content: changes.files.is_empty(),
        }
    }

    fn omit(&mut self, reason: &str) {
        self.omitted_count += 1;
        if self.omitted.iter().map(String::len).sum::<usize>() + reason.len()
            < RESERVED_BYTES - 1000
        {
            self.omitted.push(reason.into());
        }
    }

    fn file(&mut self, change_type: &str, original: Option<&str>, diff: &PrFileDiff) {
        let missing = [
            ("Before", &diff.base_unavailable_reason),
            ("After", &diff.target_unavailable_reason),
        ];
        if let Some((side, Some(reason))) = missing.iter().find(|(_, reason)| reason.is_some()) {
            self.omit(&format!(
                "{}: {side} unavailable ({reason})",
                diff.file_path
            ));
            return;
        }
        if diff.base_content.is_none() && diff.target_content.is_none() {
            self.omit(&format!("{}: both contents unavailable", diff.file_path));
            return;
        }
        let before = diff.base_content.as_deref().unwrap_or_default();
        let after = diff.target_content.as_deref().unwrap_or_default();
        let old_lines: Vec<&str> = before.split_inclusive('\n').collect();
        let new_lines: Vec<&str> = after.split_inclusive('\n').collect();
        let ranges = change_ranges(&old_lines, &new_lines);
        let mut title = format!("\n### {change_type} {}", diff.file_path);
        if let Some(original) = original {
            title.push_str(&format!(" (from {original})"));
        }
        title.push_str(&format!(
            "\nFinal newline: Before={}, After={}\n",
            before.ends_with('\n'),
            after.ends_with('\n')
        ));
        if self.document.len() + title.len() > MAX_BYTES - RESERVED_BYTES {
            self.omit(&format!("{}: byte budget", diff.file_path));
            return;
        }
        self.document.push_str(&title);
        if ranges.is_empty() {
            self.has_content = true;
            self.document
                .push_str("No textual changes (empty file or rename).\n");
        }
        for (old, new) in ranges {
            let block = format!(
                "\n@@ Before {}..{} / After {}..{} @@\nBefore:\n```\n{}\n```\nAfter:\n```\n{}\n```\n",
                old.start + 1, old.end, new.start + 1, new.end,
                numbered(&old_lines, &old), numbered(&new_lines, &new)
            );
            if self.document.len() + block.len() <= MAX_BYTES - RESERVED_BYTES {
                self.has_content = true;
                self.document.push_str(&block);
            } else {
                self.omit(&format!(
                    "{}: Before {}..{}, After {}..{} (byte budget)",
                    diff.file_path,
                    old.start + 1,
                    old.end,
                    new.start + 1,
                    new.end
                ));
            }
        }
    }

    fn finish(mut self) -> DiffMaterial {
        if self.omitted_count > 0 {
            self.document.push_str(&format!(
                "\n## Unreviewed coverage\n\n{} omitted files/hunks; do not report full coverage.\n",
                self.omitted_count
            ));
            for reason in self.omitted {
                self.document.push_str(&format!("- {reason}\n"));
            }
        }
        DiffMaterial {
            document: self.document,
            complete: self.omitted_count == 0,
            has_content: self.has_content,
        }
    }
}

fn numbered(lines: &[&str], range: &Range<usize>) -> String {
    lines[range.clone()]
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "{}: {}",
                range.start + index + 1,
                line.trim_end_matches('\n')
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Patience anchors split separated edits without quadratic LCS memory. In
/// repeated regions with no unique anchor we include the entire gap instead
/// of guessing an alignment and losing a change.
fn change_ranges(before: &[&str], after: &[&str]) -> Vec<(Range<usize>, Range<usize>)> {
    let prefix = before.iter().zip(after).take_while(|(a, b)| a == b).count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    if prefix == before.len() && prefix == after.len() {
        return Vec::new();
    }
    let old_end = before.len() - suffix;
    let new_end = after.len() - suffix;
    let positions = |lines: &[&str], end: usize| {
        let mut entries = HashMap::new();
        for (index, line) in lines.iter().enumerate().take(end).skip(prefix) {
            entries
                .entry((*line).to_string())
                .and_modify(|entry: &mut Option<usize>| *entry = None)
                .or_insert(Some(index));
        }
        entries
    };
    let old_pos = positions(before, old_end);
    let new_pos = positions(after, new_end);
    let mut pairs: Vec<(usize, usize)> = old_pos
        .iter()
        .filter_map(|(line, old)| Some(((*old)?, (*new_pos.get(line)?)?)))
        .collect();
    pairs.sort_unstable();
    let mut tails: Vec<usize> = Vec::new();
    let mut parents = vec![None; pairs.len()];
    for (index, &(_, new)) in pairs.iter().enumerate() {
        let slot = tails.partition_point(|&tail| pairs[tail].1 < new);
        if slot > 0 {
            parents[index] = Some(tails[slot - 1]);
        }
        if slot == tails.len() {
            tails.push(index);
        } else {
            tails[slot] = index;
        }
    }
    let mut anchors = Vec::new();
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        anchors.push(pairs[index]);
        cursor = parents[index];
    }
    anchors.reverse();
    anchors.push((old_end, new_end));
    let (mut old_start, mut new_start) = (prefix, prefix);
    let mut ranges: Vec<(Range<usize>, Range<usize>)> = Vec::new();
    for (old, new) in anchors {
        if old > old_start || new > new_start {
            let old_range =
                old_start.saturating_sub(CONTEXT_LINES)..(old + CONTEXT_LINES).min(before.len());
            let new_range =
                new_start.saturating_sub(CONTEXT_LINES)..(new + CONTEXT_LINES).min(after.len());
            if let Some((prev_old, prev_new)) = ranges
                .last_mut()
                .filter(|(a, b)| a.end >= old_range.start || b.end >= new_range.start)
            {
                prev_old.end = old_range.end;
                prev_new.end = new_range.end;
            } else {
                ranges.push((old_range, new_range));
            }
        }
        old_start = old + 1;
        new_start = new + 1;
    }
    ranges
}

// Kept for the existing small-range regression tests.
#[cfg(test)]
pub(super) fn changed_region(before: &str, after: &str) -> (String, String) {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    let ranges = change_ranges(&old, &new);
    match (ranges.first(), ranges.last()) {
        (Some((a, b)), Some((c, d))) => (
            old[a.start..c.end].join("\n"),
            new[b.start..d.end].join("\n"),
        ),
        _ => (String::new(), String::new()),
    }
}

#[cfg(test)]
mod tests;
