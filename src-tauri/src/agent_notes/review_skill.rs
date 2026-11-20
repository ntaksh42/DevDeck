//! `devdeck-pr-review`: the PR review criteria and result HTML layout as a
//! skill the user edits. DevDeck writes the default once and never overwrites
//! it. The editable copy lives in Claude Code's skill folder (or under the
//! notes root when Claude Code is not installed); Codex gets a managed mirror
//! of it, refreshed at startup, so both agents review the same way. Prompts
//! name the editable file by its absolute path, so neither agent has to find
//! the skill on its own.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::Result;

const NAME: &str = "devdeck-pr-review";
const FILE: &str = "SKILL.md";
const DEFAULT: &str = include_str!("review_skill.md");
const MIRROR_MARK: &str = "<!-- devdeck:mirror (DevDeck が起動時に Claude Code 側の SKILL.md から写します。編集はそちらで) -->";

fn config_dir(var: &str, default: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).or_else(|| {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(|home| PathBuf::from(home).join(default))
    })
}

/// The editable skill file.
pub(crate) fn skill_path(notes_root: &Path) -> PathBuf {
    let base = config_dir("CLAUDE_CONFIG_DIR", ".claude")
        .filter(|dir| dir.is_dir())
        .map(|dir| dir.join("skills"))
        .unwrap_or_else(|| notes_root.join("skills"));
    base.join(NAME).join(FILE)
}

/// Writes the default skill if there is none, then mirrors it for Codex.
/// Best effort: a folder that cannot take it must not block starting the app.
pub(crate) fn ensure_review_skill(notes_root: &Path) {
    let path = skill_path(notes_root);
    if let Err(err) = place(&path, None) {
        tracing::warn!(path = %path.display(), error = %err, "could not place the PR review skill");
        return;
    }
    if let Some(codex) = config_dir("CODEX_HOME", ".codex").filter(|dir| dir.is_dir()) {
        let mirror = codex.join("skills").join(NAME).join(FILE);
        if let Err(err) = place(&mirror, Some(&path)) {
            tracing::warn!(path = %mirror.display(), error = %err, "could not mirror the PR review skill");
        }
    }
}

/// `source` None: write the default only when `path` is missing. `source`
/// given: copy it with the mirror mark, unless `path` is the user's own file.
pub(crate) fn place(path: &Path, source: Option<&Path>) -> Result<()> {
    let existing = match fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.into()),
    };
    let next = match source {
        None if existing.is_some() => return Ok(()),
        None => DEFAULT.to_string(),
        Some(source) => {
            if existing
                .as_deref()
                .is_some_and(|text| !text.contains(MIRROR_MARK))
            {
                return Ok(());
            }
            let text = fs::read_to_string(source)?;
            // Keep the front matter first so the agent still reads it as a skill.
            match text
                .strip_prefix("---\n")
                .and_then(|rest| rest.split_once("\n---\n"))
            {
                Some((front, body)) => format!("---\n{front}\n---\n{MIRROR_MARK}\n{body}"),
                None => format!("{MIRROR_MARK}\n{text}"),
            }
        }
    };
    if existing.as_deref() == Some(next.as_str()) {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(path, next)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_written_once_and_the_users_edits_stay() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("devdeck-pr-review").join("SKILL.md");
        place(&path, None).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("---\nname: devdeck-pr-review"));
        assert!(text.contains("バグの起きる仕組み"));
        assert!(text.contains("追加された機能"));
        fs::write(&path, "my own").unwrap();
        place(&path, None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "my own");
    }

    #[test]
    fn the_mirror_follows_the_source_but_not_a_users_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.md");
        fs::write(&source, "---\nname: devdeck-pr-review\n---\nbody v1\n").unwrap();
        let mirror = dir.path().join("codex").join("SKILL.md");
        place(&mirror, Some(&source)).unwrap();
        let text = fs::read_to_string(&mirror).unwrap();
        assert!(text.starts_with("---\nname: devdeck-pr-review\n---\n"));
        assert!(text.contains(MIRROR_MARK));
        fs::write(&source, "---\nname: devdeck-pr-review\n---\nbody v2\n").unwrap();
        place(&mirror, Some(&source)).unwrap();
        assert!(fs::read_to_string(&mirror).unwrap().contains("body v2"));
        fs::write(&mirror, "user's codex skill").unwrap();
        place(&mirror, Some(&source)).unwrap();
        assert_eq!(fs::read_to_string(&mirror).unwrap(), "user's codex skill");
    }
}
