//! Locates the result HTML file for a pull request / work item inside the
//! configured result folders, by file name.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::error::Result;

pub(super) fn find_review_result_file(
    folder: &Path,
    pull_request_id: i64,
) -> Result<Option<PathBuf>> {
    find_result_file(folder, |name| file_name_matches_pr(name, pull_request_id))
}

pub(super) fn find_work_item_result_file(
    folder: &Path,
    work_item_id: i64,
) -> Result<Option<PathBuf>> {
    find_result_file(folder, |name| {
        file_name_matches_work_item(name, work_item_id)
    })
}

fn find_result_file(folder: &Path, matches_name: impl Fn(&str) -> bool) -> Result<Option<PathBuf>> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(folder)? {
        let path = entry?.path();
        if !path.is_file() || !is_html_file(&path) {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if matches_name(file_name) {
            matches.push(path);
        }
    }
    Ok(newest_result_file(matches))
}

/// Picks the most recently modified file (ties broken by file name) so that a
/// re-run which leaves several generations of a result never pins the preview
/// to the oldest one.
fn newest_result_file(matches: Vec<PathBuf>) -> Option<PathBuf> {
    fn name_key(path: &Path) -> String {
        path.file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default()
    }
    matches.into_iter().min_by_key(|path| {
        let modified = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok();
        (std::cmp::Reverse(modified), name_key(path))
    })
}

/// Unlike `file_name_matches_pr`, this matches on the work item id alone (no
/// "WIT"/"WI" prefix required) since result files are not guaranteed to carry
/// one. A match requires the id to appear as a standalone digit run that starts
/// the name, follows a separator, or follows a `WIT` / `WI` / `WORKITEM` prefix:
/// id 42 does not match "1042", "422" or "v42-report", and the digits of a
/// `YYYY-MM-DD` date in the name are never mistaken for an id.
fn file_name_matches_work_item(file_name: &str, work_item_id: i64) -> bool {
    static DATE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\d{4}[-_.]\d{2}[-_.]\d{2}").unwrap());
    let name = DATE.replace_all(file_name, "-");
    let needle = work_item_id.to_string();
    let bytes = name.as_bytes();
    let mut index = 0;

    while let Some(relative) = name[index..].find(needle.as_str()) {
        let start = index + relative;
        let end = start + needle.len();
        let before_is_digit = start > 0 && bytes[start - 1].is_ascii_digit();
        let after_is_digit = bytes.get(end).is_some_and(|value| value.is_ascii_digit());
        if !before_is_digit && !after_is_digit && starts_at_id_boundary(&name[..start]) {
            return true;
        }
        index = start + 1;
    }

    false
}

/// Whether the text before an id run is empty, ends in a separator, or ends in a
/// work item prefix that itself starts at a word boundary.
fn starts_at_id_boundary(before: &str) -> bool {
    let Some(last) = before.chars().last() else {
        return true;
    };
    if !last.is_ascii_alphanumeric() {
        return true;
    }
    let upper = before.to_ascii_uppercase();
    ["WORKITEM", "WIT", "WI"].iter().any(|prefix| {
        upper.strip_suffix(prefix).is_some_and(|rest| {
            rest.chars()
                .last()
                .is_none_or(|before_prefix| !before_prefix.is_ascii_alphanumeric())
        })
    })
}

fn is_html_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "html" | "htm"))
        .unwrap_or(false)
}

/// Matches a `PR<id>` token (optionally zero-padded) that starts a word: the
/// character before `PR` must not be a letter, so "apr12" is not "PR 12".
fn file_name_matches_pr(file_name: &str, pull_request_id: i64) -> bool {
    let needle = pull_request_id.to_string();
    let upper = file_name.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    let mut index = 0;

    while let Some(relative) = upper[index..].find("PR") {
        let pr_start = index + relative;
        let start = pr_start + 2;
        let starts_word = pr_start == 0 || !bytes[pr_start - 1].is_ascii_alphabetic();
        let mut number_start = start;
        while bytes.get(number_start) == Some(&b'0') {
            number_start += 1;
        }

        if starts_word && upper[number_start..].starts_with(&needle) {
            let end = number_start + needle.len();
            if !bytes.get(end).is_some_and(|value| value.is_ascii_digit()) {
                return true;
            }
        }

        index = start;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn file_name_matches_pr_token_with_optional_zero_padding() {
        assert!(file_name_matches_pr("review-PR1234.html", 1234));
        assert!(file_name_matches_pr("PR0007-result.htm", 7));
        assert!(file_name_matches_pr("prefix-pr42-suffix.html", 42));
        assert!(!file_name_matches_pr("review-PR12345.html", 1234));
        assert!(!file_name_matches_pr("review-1234.html", 1234));
    }

    #[test]
    fn file_name_matches_pr_requires_pr_to_start_a_word() {
        assert!(!file_name_matches_pr("apr12-summary.html", 12));
        assert!(!file_name_matches_pr("sprint12.html", 12));
        assert!(file_name_matches_pr("2024-PR12.html", 12));
        assert!(file_name_matches_pr("review_pr12.html", 12));
    }

    #[test]
    fn find_review_result_file_returns_first_matching_html_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("notes-PR42.txt"), "ignored").unwrap();
        fs::write(temp.path().join("b-PR42.html"), "<html>b</html>").unwrap();
        fs::write(temp.path().join("a-PR42.htm"), "<html>a</html>").unwrap();
        let same_time = SystemTime::now();
        for name in ["b-PR42.html", "a-PR42.htm"] {
            fs::File::options()
                .write(true)
                .open(temp.path().join(name))
                .unwrap()
                .set_modified(same_time)
                .unwrap();
        }

        let found = find_review_result_file(temp.path(), 42).unwrap().unwrap();
        assert_eq!(found.file_name().unwrap(), "a-PR42.htm");
    }

    #[test]
    fn file_name_matches_work_item_on_standalone_digit_run() {
        assert!(file_name_matches_work_item("WIT1234.html", 1234));
        assert!(file_name_matches_work_item("1234-result.html", 1234));
        assert!(file_name_matches_work_item("result-1234.html", 1234));
        assert!(file_name_matches_work_item("wi-1234.html", 1234));
        assert!(file_name_matches_work_item("workitem1234.html", 1234));
        assert!(!file_name_matches_work_item("result-11234.html", 1234));
        assert!(!file_name_matches_work_item("result-12345.html", 1234));
        assert!(!file_name_matches_work_item("result-999.html", 1234));
    }

    #[test]
    fn file_name_matches_work_item_ignores_dates_and_embedded_digits() {
        assert!(!file_name_matches_work_item("2024-05-12-notes.html", 12));
        assert!(!file_name_matches_work_item("2024-05-12-notes.html", 5));
        assert!(!file_name_matches_work_item("2024-05-12-notes.html", 2024));
        assert!(!file_name_matches_work_item("v2-report.html", 2));
        assert!(file_name_matches_work_item("2024-05-12-wit12.html", 12));
        assert!(file_name_matches_work_item("12-2024-05-12.html", 12));
    }

    #[test]
    fn find_work_item_result_file_returns_first_matching_html_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("notes-1234.txt"), "ignored").unwrap();
        fs::write(temp.path().join("b-1234.html"), "<html>b</html>").unwrap();
        fs::write(temp.path().join("a-1234.htm"), "<html>a</html>").unwrap();
        let same_time = SystemTime::now();
        for name in ["b-1234.html", "a-1234.htm"] {
            fs::File::options()
                .write(true)
                .open(temp.path().join(name))
                .unwrap()
                .set_modified(same_time)
                .unwrap();
        }

        let found = find_work_item_result_file(temp.path(), 1234)
            .unwrap()
            .unwrap();
        assert_eq!(found.file_name().unwrap(), "a-1234.htm");
    }

    #[test]
    fn find_result_file_prefers_the_most_recently_modified_match() {
        let temp = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        for (name, age_secs) in [("1234-v1.html", 600), ("1234-v2.html", 0)] {
            let path = temp.path().join(name);
            fs::write(&path, "<html></html>").unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(now - Duration::from_secs(age_secs))
                .unwrap();
        }

        let found = find_work_item_result_file(temp.path(), 1234)
            .unwrap()
            .unwrap();
        assert_eq!(found.file_name().unwrap(), "1234-v2.html");
    }
}
