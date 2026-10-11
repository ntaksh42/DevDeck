//! Starts the user's agent command (Settings) for one item's notes, so a note
//! can be handed over without switching to a terminal.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use super::{notes_dir, NoteTarget};
use crate::error::{AppError, Result};

const GUIDE_FILE: &str = "AGENTS.md";

/// Where the agent runs and what the command placeholders resolve to.
pub(crate) struct AgentLaunch<'a> {
    /// The result folder of the item's target (holds `.to-agent-msg` and the
    /// guide).
    pub result_folder: &'a Path,
    /// The single folder holding repository clones, when configured.
    pub workspace: Option<&'a Path>,
    /// Name of the pull request's repository, to pick its clone.
    pub repository: Option<&'a str>,
}

impl AgentLaunch<'_> {
    /// The clone of the repository inside the workspace when there is one, else
    /// the workspace itself, else the result folder. DevDeck never clones or
    /// checks out anything; the folder is only where the agent starts.
    pub(crate) fn work_dir(&self) -> PathBuf {
        let Some(workspace) = self.workspace else {
            return self.result_folder.to_path_buf();
        };
        if let Some(clone) = self
            .repository
            .filter(|name| is_plain_folder_name(name))
            .map(|name| workspace.join(name))
            .filter(|candidate| candidate.is_dir())
        {
            return clone;
        }
        workspace.to_path_buf()
    }
}

/// A repository name becomes a path segment, so it must not be able to leave
/// the workspace (`..`, separators, drive prefixes).
fn is_plain_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}

/// Folders an agent was started in and has not exited yet: two agents editing
/// the same working tree would collide.
fn running_dirs() -> &'static Mutex<HashSet<PathBuf>> {
    static RUNNING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Placeholders in the command: `{target}` (`work-item` / `pull-request`),
/// `{id}` (item id), `{notes}` (the item's notes folder), `{workspace}` (the
/// workspace folder, empty when unset), `{repo}` (the repository name, empty
/// for work items) and `{guide}` (the agent guide in the result folder). The
/// command runs through the system shell in [`AgentLaunch::work_dir`] and is
/// not waited on by the caller.
pub(crate) fn run_agent(
    launch: &AgentLaunch<'_>,
    command: Option<&str>,
    target: NoteTarget,
    item_id: i64,
) -> Result<()> {
    let command = expand(command, launch, target, item_id)?;
    let work_dir = launch.work_dir();

    {
        let mut running = running_dirs()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !running.insert(work_dir.clone()) {
            return Err(AppError::InvalidInput(format!(
                "An agent is already running in {}",
                work_dir.display()
            )));
        }
    }

    let spawned = shell_command(&command)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        Ok(mut child) => {
            // The command is not waited on by the request, but something has
            // to reap it and free the folder once it exits.
            std::thread::spawn(move || {
                let _ = child.wait();
                running_dirs()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(&work_dir);
            });
            Ok(())
        }
        Err(e) => {
            running_dirs()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&work_dir);
            Err(e.into())
        }
    }
}

/// The system shell running `command`. On Windows the string is handed to
/// `cmd` verbatim: `Command::arg` would re-escape its `"` as `\"`, which
/// cmd.exe does not understand, so a quoted argument such as
/// `claude -p "handle {id}"` would be split apart. `/S` plus the outer quotes
/// makes cmd strip exactly that pair and keep the rest as written.
fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.args(["/S", "/C"]).raw_arg(format!("\"{command}\""));
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
}

fn expand(
    command: Option<&str>,
    launch: &AgentLaunch<'_>,
    target: NoteTarget,
    item_id: i64,
) -> Result<String> {
    let command = command
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput("Set an agent command in Settings to run the agent".to_string())
        })?;
    let notes = notes_dir(launch.result_folder, target, item_id);
    let guide = launch.result_folder.join(GUIDE_FILE);
    let workspace = launch
        .workspace
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    // An unsafe repository name is dropped from the command as well as from
    // the folder lookup, so it can never reach the shell.
    let repo = launch
        .repository
        .filter(|name| is_plain_folder_name(name))
        .unwrap_or_default();
    Ok(command
        .replace("{target}", target.as_str())
        .replace("{id}", &item_id.to_string())
        .replace("{notes}", &notes.display().to_string())
        .replace("{workspace}", &workspace)
        .replace("{repo}", repo)
        .replace("{guide}", &guide.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch<'a>(
        result: &'a Path,
        workspace: Option<&'a Path>,
        repository: Option<&'a str>,
    ) -> AgentLaunch<'a> {
        AgentLaunch {
            result_folder: result,
            workspace,
            repository,
        }
    }

    #[cfg(windows)]
    #[test]
    fn shell_command_keeps_quoted_arguments_intact() {
        let output = shell_command("echo \"handle 7 in C:\\dir\"")
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "\"handle 7 in C:\\dir\""
        );
    }

    #[test]
    fn expands_placeholders_and_requires_a_command() {
        let folder = Path::new("C:/r");
        let ctx = launch(folder, None, None);
        let cmd = expand(
            Some(" claude -p \"handle {target} {id} in {notes}\" "),
            &ctx,
            NoteTarget::PullRequest,
            7,
        )
        .unwrap();
        assert!(cmd.starts_with("claude -p \"handle pull-request 7 in C:/r"));
        assert!(cmd.contains("pr-7"));
        assert!(expand(Some("  "), &ctx, NoteTarget::WorkItem, 1).is_err());
        assert!(expand(None, &ctx, NoteTarget::WorkItem, 1).is_err());
    }

    #[test]
    fn expands_workspace_repo_and_guide() {
        let result = Path::new("C:/r");
        let workspace = Path::new("C:/ws");
        let ctx = launch(result, Some(workspace), Some("api-gateway"));
        let cmd = expand(
            Some("agent --cwd {workspace} --repo {repo} --guide {guide}"),
            &ctx,
            NoteTarget::PullRequest,
            7,
        )
        .unwrap();
        assert!(cmd.contains("--cwd C:/ws"));
        assert!(cmd.contains("--repo api-gateway"));
        assert!(cmd.contains("--guide C:/r"));
        assert!(cmd.ends_with("AGENTS.md"));

        // Without a workspace or repository the placeholders are empty.
        let bare = launch(result, None, None);
        let cmd = expand(
            Some("a {workspace}|{repo}|"),
            &bare,
            NoteTarget::WorkItem,
            1,
        )
        .unwrap();
        assert_eq!(cmd, "a ||");
    }

    #[test]
    fn work_dir_prefers_the_repository_clone_then_the_workspace() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("ws");
        let result = root.path().join("results");
        std::fs::create_dir_all(workspace.join("api-gateway")).unwrap();
        std::fs::create_dir_all(&result).unwrap();

        assert_eq!(
            launch(&result, Some(&workspace), Some("api-gateway")).work_dir(),
            workspace.join("api-gateway")
        );
        // No clone of that repository: fall back to the workspace root.
        assert_eq!(
            launch(&result, Some(&workspace), Some("infra")).work_dir(),
            workspace
        );
        assert_eq!(
            launch(&result, Some(&workspace), None).work_dir(),
            workspace
        );
        // No workspace: the result folder, as before.
        assert_eq!(
            launch(&result, None, Some("api-gateway")).work_dir(),
            result
        );
    }

    #[test]
    fn a_repository_name_cannot_leave_the_workspace() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("ws");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let result = root.path().join("results");

        for name in ["..", "../outside", "a/b", "a\\b", "C:", ""] {
            let ctx = launch(&result, Some(&workspace), Some(name));
            assert_eq!(ctx.work_dir(), workspace, "name {name:?}");
            let cmd = expand(Some("run {repo}"), &ctx, NoteTarget::WorkItem, 1).unwrap();
            assert_eq!(cmd, "run ", "name {name:?}");
        }
    }

    #[test]
    fn a_second_agent_in_the_same_folder_is_refused_until_the_first_exits() {
        let root = tempfile::tempdir().unwrap();
        let result = root.path().join("results");
        std::fs::create_dir_all(&result).unwrap();
        let ctx = launch(&result, None, None);

        // A long-lived command keeps the folder busy.
        #[cfg(windows)]
        let slow = "ping -n 4 127.0.0.1 > NUL";
        #[cfg(not(windows))]
        let slow = "sleep 3";

        run_agent(&ctx, Some(slow), NoteTarget::WorkItem, 1).unwrap();
        let second = run_agent(&ctx, Some(slow), NoteTarget::WorkItem, 2);
        assert!(
            matches!(second, Err(AppError::InvalidInput(message)) if message.contains("already running"))
        );

        // Another folder is independent.
        let other = root.path().join("other");
        std::fs::create_dir_all(&other).unwrap();
        run_agent(
            &launch(&other, None, None),
            Some(slow),
            NoteTarget::WorkItem,
            3,
        )
        .unwrap();
    }
}
