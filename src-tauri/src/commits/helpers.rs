use azdo_client::{AdoClient, AdoError, GitCommitRef};
use chrono::{DateTime, NaiveDate, Utc};

use crate::db::{CachedCommit, Organization};
use crate::error::{AppError, Result};

use super::CommitSummary;

const MAX_DIFF_CONTENT_BYTES: usize = 256 * 1024;

pub(super) struct ChangeFlags {
    pub(super) is_add: bool,
    pub(super) is_delete: bool,
}

impl ChangeFlags {
    pub(super) fn parse(change_type: &str) -> Self {
        let tokens: Vec<&str> = change_type.split(',').map(|token| token.trim()).collect();
        Self {
            is_add: tokens.contains(&"add") || tokens.contains(&"undelete"),
            is_delete: tokens.contains(&"delete"),
        }
    }
}

pub(super) async fn fetch_commit_side(
    client: &AdoClient,
    project_id: &str,
    repository_id: &str,
    path: &str,
    commit_id: &str,
) -> Result<(Option<String>, Option<String>)> {
    match client
        .get_item_content(project_id, repository_id, path, commit_id)
        .await
    {
        Ok(item) => {
            if item
                .content_metadata
                .as_ref()
                .and_then(|metadata| metadata.is_binary)
                .unwrap_or(false)
            {
                return Ok((None, Some("binary".to_string())));
            }
            match item.content {
                Some(content) if content.len() > MAX_DIFF_CONTENT_BYTES => {
                    Ok((None, Some("tooLarge".to_string())))
                }
                Some(content) => Ok((Some(content), None)),
                None => Ok((None, Some("binary".to_string()))),
            }
        }
        Err(AdoError::Api { status: 404, .. }) => Ok((None, Some("missing".to_string()))),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Azure DevOps `searchCriteria.itemPath` expects a server-relative path with a
/// leading slash (e.g. `/src/auth`). Accept user input with or without it.
pub(super) fn normalize_item_path(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

/// Trims and drops blank entries from a multi-value filter, returning `None`
/// when nothing is left so callers can treat "no values" as "no filter".
pub(super) fn normalize_set(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let cleaned: Vec<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

pub(super) fn normalize_date(
    value: Option<&str>,
    end_of_day: bool,
) -> Result<Option<DateTime<Utc>>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let time = if end_of_day {
            date.and_hms_opt(23, 59, 59)
        } else {
            date.and_hms_opt(0, 0, 0)
        }
        .expect("valid date time");
        return Ok(Some(DateTime::<Utc>::from_naive_utc_and_offset(time, Utc)));
    }

    DateTime::parse_from_rfc3339(value)
        .map(|date| Some(date.with_timezone(&Utc)))
        .map_err(|_| AppError::InvalidInput(format!("invalid commit date: {value}")))
}

pub(super) fn commit_web_url(
    organization: &Organization,
    project_name: &str,
    repository_name: &str,
    commit_id: &str,
) -> String {
    format!(
        "{}/{}/_git/{}/commit/{}",
        organization.base_url.trim_end_matches('/'),
        encode_path_segment(project_name),
        encode_path_segment(repository_name),
        commit_id
    )
}

pub(crate) fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char);
            }
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub(super) fn cached_commit_to_summary(c: CachedCommit) -> CommitSummary {
    let short_commit_id = c.commit_id.chars().take(8).collect();
    CommitSummary {
        organization_id: c.org_id,
        project_id: c.project_id,
        project_name: c.project_name,
        repository_id: c.repository_id,
        repository_name: c.repository_name,
        short_commit_id,
        commit_id: c.commit_id,
        comment: c.comment,
        author_name: c.author_name,
        author_email: c.author_email,
        author_date: c.author_date,
        web_url: c.web_url,
    }
}

pub(super) fn commit_to_cached(
    org: &Organization,
    project_id: &str,
    project_name: &str,
    repository_id: &str,
    repository_name: &str,
    commit: GitCommitRef,
) -> CachedCommit {
    let author_name = commit.author.as_ref().and_then(|a| a.name.clone());
    let author_email = commit.author.as_ref().and_then(|a| a.email.clone());
    let author_date = commit
        .author
        .as_ref()
        .and_then(|a| a.date.map(|d| d.to_rfc3339()));
    let commit_id = commit.commit_id;
    // commit.url is a REST endpoint, never a browser URL; only remoteUrl or a
    // constructed _git link may be shown to the user.
    let web_url = commit.remote_url.or_else(|| {
        Some(commit_web_url(
            org,
            project_name,
            repository_name,
            &commit_id,
        ))
    });
    CachedCommit {
        org_id: org.id.clone(),
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        repository_id: repository_id.to_string(),
        repository_name: repository_name.to_string(),
        commit_id,
        comment: commit.comment.unwrap_or_else(|| "(no comment)".to_string()),
        author_name,
        author_email,
        author_date,
        web_url,
    }
}
