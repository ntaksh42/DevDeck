//! The agent-facing instructions (`AGENTS.md`) placed in each result folder
//! (and in the notes root for free-standing requests).

use std::fs;
use std::path::Path;

use super::NoteTarget;
use crate::error::Result;

const GUIDE_FILE: &str = "AGENTS.md";
const START: &str =
    "<!-- devdeck:agent-notes:start (DevDeck が更新します。この区間は編集しないでください) -->";
const END: &str = "<!-- devdeck:agent-notes:end -->";
/// First line of the guide written before it had markers; such a file is
/// DevDeck's own and is replaced whole.
const LEGACY_HEADING: &str = "# 申し送りの読み方";

/// Places or refreshes the agent-facing instructions for notes in a result
/// folder, so an agent working there can find them without knowing DevDeck.
/// DevDeck owns only the marked block: a user-written `AGENTS.md` without it
/// is left alone. `notes_root` is written into the guide as an absolute path,
/// since the notes live outside the result folder.
pub(crate) fn ensure_guide(folder: &Path, target: NoteTarget, notes_root: &Path) -> Result<()> {
    if !folder.is_dir() {
        return Ok(());
    }
    let path = folder.join(GUIDE_FILE);
    let block = format!("{START}\n{}{END}\n", render(target, notes_root));
    let next = match fs::read_to_string(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => block,
        Err(err) => return Err(err.into()),
        Ok(current) => match (current.find(START), current.find(END)) {
            (Some(start), Some(end)) if start < end => format!(
                "{}{block}{}",
                &current[..start],
                current[end + END.len()..].trim_start_matches(['\r', '\n'])
            ),
            _ if current
                .trim_start_matches('\u{feff}')
                .starts_with(LEGACY_HEADING) =>
            {
                block
            }
            _ => return Ok(()),
        },
    };
    if fs::read_to_string(&path).ok().as_deref() != Some(next.as_str()) {
        fs::write(path, next)?;
    }
    Ok(())
}

fn render(target: NoteTarget, notes_root: &Path) -> String {
    let kind = match target {
        NoteTarget::WorkItem => "Work Item の調査",
        NoteTarget::PullRequest => "Pull Request のレビュー",
        NoteTarget::Ask => "対象に紐づかない依頼",
    };
    format!(
        "このフォルダの Note ({kind}): `{}\\{}-{{番号}}\\*.md`\n\n{}",
        notes_root.display(),
        target.dir_prefix(),
        render_common(notes_root)
    )
}

/// The target-neutral guide, shared by every `AGENTS.md` block and the
/// `devdeck-notes` skill so the two never drift apart.
pub(crate) fn render_common(notes_root: &Path) -> String {
    include_str!("notes_guide.md").replace("{notes_root}", &notes_root.display().to_string())
}
