//! Shallow clone of a pull request's repository into the agent workspace, so an
//! automatic review can read the code around a diff. A clone made here carries
//! a marker file and is moved to the PR's head commit before each run; a folder
//! the user made (no marker) is never touched. Failures only cost the agent the
//! surrounding code, so callers log them and go on.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::agent_notes::launch::is_plain_folder_name;
use crate::db::{CachedReviewPr, Organization};

const MARKER: &str = ".devdeck-shallow";
const GIT_TIMEOUT: Duration = Duration::from_secs(300);

/// Clones (or refreshes a clone made earlier by this function) the repository
/// of `pr` as `workspace/<repository name>`, at `head` when known.
pub(super) fn prepare(
    workspace: &Path,
    org: &Organization,
    pr: &CachedReviewPr,
    head: Option<&str>,
) -> Result<(), String> {
    if org.provider_kind != "azdo" || !is_plain_folder_name(&pr.repository_name) {
        return Ok(());
    }
    let url = clone_url(&org.base_url, &pr.project_name, &pr.repository_name)
        .ok_or("the clone URL could not be built")?;
    sync_clone(&workspace.join(&pr.repository_name), &url, head)
}

fn clone_url(base_url: &str, project: &str, repository: &str) -> Option<String> {
    let mut url = url::Url::parse(base_url).ok()?;
    url.path_segments_mut()
        .ok()?
        .pop_if_empty()
        .extend([project, "_git", repository]);
    Some(url.into())
}

fn sync_clone(dir: &Path, url: &str, head: Option<&str>) -> Result<(), String> {
    if dir.exists() {
        let Ok(marker) = std::fs::read_to_string(dir.join(MARKER)) else {
            return Ok(());
        };
        // Folders are named by repository name alone, so a same-named
        // repository of another project must not be given this checkout.
        // Markers written before the URL was recorded carry no second line.
        if let Some(owner) = marker.lines().nth(1).filter(|owner| *owner != url) {
            return Err(format!("{} holds a clone of {owner}", dir.display()));
        }
    } else {
        let target = dir.to_string_lossy();
        let cloned = git(None, &["clone", "--depth", "1", url, &target]).and_then(|()| {
            std::fs::write(
                dir.join(MARKER),
                format!("Shallow clone made by DevDeck.\n{url}\n"),
            )
            .map_err(|e| e.to_string())
        });
        if let Err(error) = cloned {
            // A killed clone leaves a half-made folder that would later pass
            // for the user's own clone and never be refreshed.
            let _ = std::fs::remove_dir_all(dir);
            return Err(error);
        }
    }
    if let Some(head) = head {
        git(Some(dir), &["fetch", "--depth", "1", "origin", head])?;
        git(
            Some(dir),
            &["checkout", "--force", "--detach", "FETCH_HEAD"],
        )?;
    }
    Ok(())
}

/// Runs git with the user's stored credentials and without ever prompting.
fn git(dir: Option<&Path>, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("git did not start: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                let message = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "git {} failed ({status}): {}",
                    args[0],
                    message.trim()
                ));
            }
            Ok(None) if start.elapsed() >= GIT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("git {} timed out", args[0]));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn commit(dir: &Path, file: &str) -> String {
        std::fs::write(dir.join(file), file).unwrap();
        run(dir, &["add", "."]);
        run(dir, &["commit", "-m", file]);
        let out = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn the_url_is_built_from_the_organization_project_and_repository() {
        assert_eq!(
            clone_url("https://dev.azure.com/org", "My Project", "repo").unwrap(),
            "https://dev.azure.com/org/My%20Project/_git/repo"
        );
    }

    #[test]
    fn a_shallow_clone_follows_the_head_and_a_users_own_clone_is_left_alone() {
        let root = tempfile::tempdir().unwrap();
        let origin = root.path().join("origin");
        std::fs::create_dir(&origin).unwrap();
        run(&origin, &["init", "-q", "-b", "main"]);
        let first = commit(&origin, "a.txt");
        let url = format!(
            "file:///{}",
            origin.display().to_string().replace('\\', "/")
        );

        let ours = root.path().join("ws").join("ours");
        sync_clone(&ours, &url, Some(&first)).unwrap();
        assert!(ours.join("a.txt").exists() && ours.join(MARKER).exists());

        let second = commit(&origin, "b.txt");
        sync_clone(&ours, &url, Some(&second)).unwrap();
        assert!(ours.join("b.txt").exists(), "moved to the newer head");

        let users = root.path().join("ws").join("users");
        std::fs::create_dir_all(&users).unwrap();
        sync_clone(&users, &url, Some(&second)).unwrap();
        assert!(std::fs::read_dir(&users).unwrap().next().is_none());
    }

    #[test]
    fn a_clone_of_another_repository_is_not_reused_and_a_failed_clone_leaves_nothing() {
        let root = tempfile::tempdir().unwrap();
        let origin = root.path().join("origin");
        std::fs::create_dir(&origin).unwrap();
        run(&origin, &["init", "-q", "-b", "main"]);
        let head = commit(&origin, "a.txt");
        let url = format!(
            "file:///{}",
            origin.display().to_string().replace('\\', "/")
        );

        let ours = root.path().join("ws").join("repo");
        sync_clone(&ours, &url, Some(&head)).unwrap();
        let error = sync_clone(&ours, "file:///elsewhere/repo", Some(&head)).unwrap_err();
        assert!(error.contains(&url), "{error}");

        let missing = root.path().join("ws").join("missing");
        assert!(sync_clone(&missing, "file:///nowhere/none", None).is_err());
        assert!(!missing.exists());
    }
}
