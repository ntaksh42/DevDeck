use azdo_client::GitVersionType;

use super::GetFileInput;
use crate::error::{AppError, Result};

pub(super) fn strip_heads_prefix(ref_name: &str) -> &str {
    ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name)
}

/// Resolves the ref a file request targets: the explicit
/// `versionType`/`version` pair when present, otherwise the branch.
pub(super) fn resolve_version(input: &GetFileInput) -> Result<(GitVersionType, &str)> {
    let version_type = match input.version_type.as_deref() {
        None => return Ok((GitVersionType::Branch, &input.branch)),
        Some("branch") => GitVersionType::Branch,
        Some("commit") => GitVersionType::Commit,
        Some("tag") => GitVersionType::Tag,
        Some(other) => {
            return Err(AppError::InvalidInput(format!(
                "unknown versionType: {other}"
            )))
        }
    };
    match input.version.as_deref() {
        Some(version) if !version.trim().is_empty() => Ok((version_type, version)),
        _ => Err(AppError::InvalidInput(
            "version is required when versionType is set".to_string(),
        )),
    }
}

/// The MIME type for paths we inline as image previews, by extension.
pub(super) fn image_mime(path: &str) -> Option<&'static str> {
    let extension = path.rsplit('.').next()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// The longest prefix of `s` that is at most `max` bytes and ends on a char
/// boundary, so truncation never splits a multi-byte character.
pub(super) fn truncate_at_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Normalizes a tree scope path: blank/`""` becomes `/`, trailing slashes are
/// trimmed (except the root) so it matches the path the API echoes back.
pub(super) fn normalize_scope(path: Option<&str>) -> String {
    let trimmed = path.unwrap_or("/").trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

pub(super) fn leaf_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_scope_defaults_to_root() {
        assert_eq!(normalize_scope(None), "/");
        assert_eq!(normalize_scope(Some("")), "/");
        assert_eq!(normalize_scope(Some("  ")), "/");
        assert_eq!(normalize_scope(Some("/src/")), "/src");
        assert_eq!(normalize_scope(Some("/src")), "/src");
    }

    #[test]
    fn leaf_name_takes_last_segment() {
        assert_eq!(leaf_name("/src/main.py"), "main.py");
        assert_eq!(leaf_name("/README.md"), "README.md");
        assert_eq!(leaf_name("/src/lib"), "lib");
    }

    #[test]
    fn strip_heads_prefix_shortens_branch() {
        assert_eq!(strip_heads_prefix("refs/heads/main"), "main");
        assert_eq!(strip_heads_prefix("refs/heads/feature/x"), "feature/x");
        assert_eq!(strip_heads_prefix("main"), "main");
    }

    #[test]
    fn image_mime_maps_known_extensions_only() {
        assert_eq!(image_mime("/assets/logo.PNG"), Some("image/png"));
        assert_eq!(image_mime("/photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("/icon.svg"), Some("image/svg+xml"));
        assert_eq!(image_mime("/src/main.py"), None);
        assert_eq!(image_mime("/no-extension"), None);
    }

    #[test]
    fn truncate_at_char_boundary_never_splits_chars() {
        assert_eq!(truncate_at_char_boundary("hello", 10), "hello");
        assert_eq!(truncate_at_char_boundary("hello", 3), "hel");
        // "あ" is 3 bytes; cutting at 4 must back up to the boundary.
        assert_eq!(truncate_at_char_boundary("ああ", 4), "あ");
    }

    fn file_input(version_type: Option<&str>, version: Option<&str>) -> GetFileInput {
        GetFileInput {
            organization_id: None,
            project: "p".to_string(),
            repository: "r".to_string(),
            branch: "main".to_string(),
            path: "/a.txt".to_string(),
            version_type: version_type.map(ToString::to_string),
            version: version.map(ToString::to_string),
            operation_id: None,
        }
    }

    #[test]
    fn resolve_version_defaults_to_branch() {
        let input = file_input(None, None);
        let (version_type, version) = resolve_version(&input).unwrap();
        assert_eq!(version_type, GitVersionType::Branch);
        assert_eq!(version, "main");
    }

    #[test]
    fn resolve_version_uses_explicit_ref() {
        let input = file_input(Some("commit"), Some("abc123"));
        let (version_type, version) = resolve_version(&input).unwrap();
        assert_eq!(version_type, GitVersionType::Commit);
        assert_eq!(version, "abc123");
    }

    #[test]
    fn resolve_version_rejects_missing_or_unknown() {
        assert!(resolve_version(&file_input(Some("commit"), None)).is_err());
        assert!(resolve_version(&file_input(Some("commit"), Some("  "))).is_err());
        assert!(resolve_version(&file_input(Some("bogus"), Some("x"))).is_err());
    }
}
