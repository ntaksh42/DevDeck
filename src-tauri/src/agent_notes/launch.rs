//! Starts the user's agent command (Settings) for one item's notes, so a note
//! can be handed over without switching to a terminal.

use std::path::Path;
use std::process::{Command, Stdio};

use super::{notes_dir, NoteTarget};
use crate::error::{AppError, Result};

/// Placeholders in the command: `{target}` (`work-item` / `pull-request`),
/// `{id}` (item id) and `{notes}` (the item's notes folder). The command runs
/// through the system shell with the result folder as its working directory
/// and is not waited on.
pub(crate) fn run_agent(
    folder: &Path,
    command: Option<&str>,
    target: NoteTarget,
    item_id: i64,
) -> Result<()> {
    let command = expand(command, folder, target, item_id)?;
    let mut shell = if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &command]);
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", &command]);
        cmd
    };
    shell
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

fn expand(
    command: Option<&str>,
    folder: &Path,
    target: NoteTarget,
    item_id: i64,
) -> Result<String> {
    let command = command
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput("Set an agent command in Settings to run the agent".to_string())
        })?;
    let notes = notes_dir(folder, target, item_id);
    Ok(command
        .replace("{target}", target.as_str())
        .replace("{id}", &item_id.to_string())
        .replace("{notes}", &notes.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_placeholders_and_requires_a_command() {
        let folder = Path::new("C:/r");
        let cmd = expand(
            Some(" claude -p \"handle {target} {id} in {notes}\" "),
            folder,
            NoteTarget::PullRequest,
            7,
        )
        .unwrap();
        assert!(cmd.starts_with("claude -p \"handle pull-request 7 in C:/r"));
        assert!(cmd.contains("pr-7"));
        assert!(expand(Some("  "), folder, NoteTarget::WorkItem, 1).is_err());
        assert!(expand(None, folder, NoteTarget::WorkItem, 1).is_err());
    }
}
