//! Moves notes from where older versions kept them
//! (`{result_folder}/.to-agent-msg/{wi|pr}-{id}/`) into the notes root.

use std::fs;
use std::path::Path;

use super::NoteTarget;
use crate::error::Result;

const LEGACY_DIR: &str = ".to-agent-msg";

/// Moves the target's item folders out of `result_folder`'s legacy notes
/// folder into `notes_root`, file by file so a partly migrated item merges.
/// A file that already exists at the destination is left in place rather than
/// overwritten. Safe to run repeatedly; empty legacy folders are removed.
pub(crate) fn migrate_legacy_notes(
    result_folder: &Path,
    target: NoteTarget,
    notes_root: &Path,
) -> Result<()> {
    let legacy = result_folder.join(LEGACY_DIR);
    let Ok(entries) = fs::read_dir(&legacy) else {
        return Ok(());
    };
    let prefix = format!("{}-", target.dir_prefix());
    for entry in entries {
        let src = entry?.path();
        let is_item = src.is_dir()
            && src
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix));
        if is_item {
            move_tree(&src, &notes_root.join(src.file_name().unwrap_or_default()))?;
        }
    }
    // Only succeeds once both targets' items are gone.
    let _ = fs::remove_dir(&legacy);
    Ok(())
}

fn move_tree(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let from = entry?.path();
        let to = dest.join(from.file_name().unwrap_or_default());
        if from.is_dir() {
            move_tree(&from, &to)?;
        } else if !to.exists() {
            // The notes root is usually on another volume than the result
            // folder, where a rename fails.
            if fs::rename(&from, &to).is_err() {
                fs::copy(&from, &to)?;
                fs::remove_file(&from)?;
            }
        }
    }
    let _ = fs::remove_dir(src);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_the_targets_items_and_keeps_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let result = temp.path().join("results");
        let root = temp.path().join("agent-notes");
        let legacy = result.join(LEGACY_DIR);
        fs::create_dir_all(legacy.join("wi-7").join("_done")).unwrap();
        fs::create_dir_all(legacy.join("pr-3")).unwrap();
        fs::write(legacy.join("wi-7").join("a.md"), "old a").unwrap();
        fs::write(legacy.join("wi-7").join("_done").join("b.md"), "b").unwrap();
        fs::write(legacy.join("pr-3").join("c.md"), "c").unwrap();
        // Already present at the destination: must not be overwritten.
        fs::create_dir_all(root.join("wi-7")).unwrap();
        fs::write(root.join("wi-7").join("a.md"), "new a").unwrap();

        migrate_legacy_notes(&result, NoteTarget::WorkItem, &root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("wi-7/_done/b.md")).unwrap(),
            "b"
        );
        assert_eq!(fs::read_to_string(root.join("wi-7/a.md")).unwrap(), "new a");
        assert!(legacy.join("wi-7/a.md").exists());
        assert!(!legacy.join("wi-7/_done").exists());
        // The other target's items stay until that target is migrated.
        assert!(legacy.join("pr-3/c.md").exists());

        fs::remove_file(legacy.join("wi-7/a.md")).unwrap();
        migrate_legacy_notes(&result, NoteTarget::WorkItem, &root).unwrap();
        migrate_legacy_notes(&result, NoteTarget::PullRequest, &root).unwrap();
        assert_eq!(fs::read_to_string(root.join("pr-3/c.md")).unwrap(), "c");
        assert!(!legacy.exists());

        // Nothing to migrate is fine.
        migrate_legacy_notes(&result, NoteTarget::WorkItem, &root).unwrap();
    }
}
