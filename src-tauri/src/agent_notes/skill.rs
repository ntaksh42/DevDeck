//! DevDeck's Claude Code / Codex skill, placed in the user's skill folders so
//! an agent started anywhere knows it: `devdeck-notes` (how to read and answer
//! notes; the same text as the `AGENTS.md` guide).

use std::fs;
use std::path::{Path, PathBuf};

use super::guide::render_common;
use crate::error::Result;

const SKILL_NAME: &str = "devdeck-notes";
const SKILL_FILE: &str = "SKILL.md";
const FRONT_MATTER: &str = "---
name: devdeck-notes
description: \"DevDeck の Agent notes (人が DevDeck から残した依頼メモ) を読み、対応して返信する手順。agent-notes フォルダの wi- / pr- / ask- 配下の .md を処理するとき、DevDeck の Note や Agent パネルからの依頼に答えるときに使う。\"
---
";
/// A skill DevDeck used to place for the result HTML layout; see [`remove_retired_skill`].
const RETIRED_RESULT_SKILL_NAME: &str = "devdeck-result-html";
/// Marks a skill file DevDeck wrote; one without it is the user's and is left alone.
const MANAGED: &str =
    "<!-- devdeck:managed (DevDeck が起動時に上書きします。編集しないでください) -->";

/// Places or refreshes the skill for every installed agent. Best effort: a
/// folder that cannot take it must not block starting the app.
pub(crate) fn ensure_skills(notes_root: &Path) {
    for skills_dir in skill_dirs() {
        if let Err(err) = ensure_skill(&skills_dir, notes_root) {
            tracing::warn!(dir = %skills_dir.display(), error = %err, "could not place agent notes skill");
        }
    }
}

/// `skills/` under the Claude Code and Codex config folders that exist; an
/// agent that is not installed gets no folder created for it.
fn skill_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let config = |var: &str, default: &str| {
        std::env::var_os(var)
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|home| home.join(default)))
    };
    [
        config("CLAUDE_CONFIG_DIR", ".claude"),
        config("CODEX_HOME", ".codex"),
    ]
    .into_iter()
    .flatten()
    .filter(|dir| dir.is_dir())
    .map(|dir| dir.join("skills"))
    .collect()
}

pub(crate) fn ensure_skill(skills_dir: &Path, notes_root: &Path) -> Result<()> {
    remove_retired_skill(skills_dir)?;
    write_skill(
        skills_dir,
        SKILL_NAME,
        FRONT_MATTER,
        &render_common(notes_root),
    )
}

/// The result HTML layout now lives only in the result folders' `AGENTS.md`,
/// so the skill DevDeck once placed for it is removed (a user-written one, with
/// no managed mark, stays).
fn remove_retired_skill(skills_dir: &Path) -> Result<()> {
    let dir = skills_dir.join(RETIRED_RESULT_SKILL_NAME);
    let path = dir.join(SKILL_FILE);
    match fs::read_to_string(&path) {
        Ok(current) if current.contains(MANAGED) => {
            fs::remove_file(&path)?;
            // Only an empty folder goes; anything else the user put there stays.
            let _ = fs::remove_dir(&dir);
            Ok(())
        }
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

fn write_skill(skills_dir: &Path, name: &str, front_matter: &str, body: &str) -> Result<()> {
    let path = skills_dir.join(name).join(SKILL_FILE);
    let next = format!("{front_matter}{MANAGED}\n\n{body}");
    match fs::read_to_string(&path) {
        Ok(current) if current == next || !current.contains(MANAGED) => return Ok(()),
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err.into()),
        _ => {}
    }
    fs::create_dir_all(skills_dir.join(name))?;
    fs::write(path, next)?;
    Ok(())
}
