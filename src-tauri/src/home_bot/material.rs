//! What a pull request worker gets before it starts: DevDeck fetches the
//! diff, description and threads (as an automatic review does) into the
//! note's context file and refreshes a shallow clone in the agent workspace.
//! Workers have no Azure DevOps access of their own, so without this they
//! could only see the PR's title.

use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};

use super::dispatch::last_note;
use super::store_chat::DispatchRow;
use super::types::WorkerSubject;
use super::HomeBot;
use crate::db::CachedReviewPr;

const MARKER: &str = "<!-- devdeck-pr-material -->";

/// The item a PR / WI worker answers in, for opening it in the Agent panel.
pub(crate) fn worker_subject(conn: &Connection, row: &DispatchRow) -> Option<WorkerSubject> {
    match row.note_target.as_str() {
        "pull-request" => {
            let (org, repo, id) = parse_pr_key(&row.target)?;
            let pr = find_pr(conn, &org, &repo, id)?;
            Some(WorkerSubject {
                kind: "pull-request".into(),
                id,
                title: pr.title,
                organization_id: org,
                project_id: pr.project_id,
                repository_id: Some(repo),
                repository_name: Some(pr.repository_name),
                web_url: pr.web_url,
            })
        }
        "work-item" => {
            let (org, id) = row.target.strip_prefix("wi:")?.rsplit_once('/')?;
            let id: i64 = id.parse().ok()?;
            let read = |sql: &str| {
                conn.query_row(sql, params![org, id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                })
                .ok()
            };
            let (project_id, title, web_url) = read(
                "SELECT project_id, title, web_url FROM work_items WHERE org_id = ?1 AND id = ?2",
            )
            .or_else(|| {
                read(
                    "SELECT project_id, title, web_url FROM action_inbox_items
                     WHERE org_id = ?1 AND subject_id = ?2 AND kind LIKE 'wi_%' LIMIT 1",
                )
            })?;
            Some(WorkerSubject {
                kind: "work-item".into(),
                id,
                title,
                organization_id: org.to_string(),
                project_id,
                repository_id: None,
                repository_name: None,
                web_url,
            })
        }
        _ => None,
    }
}

/// `pr:{org}/{repositoryId}/{id}` → its parts.
pub(crate) fn parse_pr_key(key: &str) -> Option<(String, String, i64)> {
    let rest = key.strip_prefix("pr:")?;
    let (head, id) = rest.rsplit_once('/')?;
    let (org, repo) = head.rsplit_once('/')?;
    Some((org.to_string(), repo.to_string(), id.parse().ok()?))
}

/// The PR as DevDeck has it cached: its own active PRs, the PRs the user
/// reviews, or an Inbox row about it.
fn find_pr(conn: &Connection, org: &str, repo: &str, id: i64) -> Option<CachedReviewPr> {
    let queries = [
        "SELECT project_id, project_name, repository_name, title, web_url FROM pull_requests
         WHERE org_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
        "SELECT project_id, project_name, repository_name, title, web_url FROM review_pull_requests
         WHERE org_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
        "SELECT project_id, project_name, repository_name, title, web_url FROM action_inbox_items
         WHERE org_id = ?1 AND repository_id = ?2 AND subject_id = ?3 LIMIT 1",
    ];
    queries.iter().find_map(|sql| {
        conn.query_row(sql, params![org, repo, id], |row| {
            Ok(CachedReviewPr {
                org_id: org.to_string(),
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                repository_id: repo.to_string(),
                repository_name: row.get(2)?,
                pull_request_id: id,
                title: row.get(3)?,
                created_by: None,
                creation_date: String::new(),
                target_ref_name: String::new(),
                web_url: row.get(4)?,
                my_vote: 0,
                my_vote_label: String::new(),
                my_is_required: false,
                is_draft: false,
                merge_status: None,
                ci_status: None,
                ci_context: None,
                ci_check_count: 0,
            })
        })
        .optional()
        .ok()
        .flatten()
    })
}

/// Adds the PR material to the worker's context file once (follow-ups reuse
/// it). Failures are written there too, so the worker says what is missing
/// instead of guessing.
pub(crate) fn prepare(bot: &HomeBot, row: &DispatchRow) {
    let Some((org, repo, id)) = parse_pr_key(&row.target) else {
        return;
    };
    let Some(path) = last_note(bot, row)
        .ok()
        .flatten()
        .and_then(|note| note.context_file)
        .map(PathBuf::from)
    else {
        return;
    };
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.contains(MARKER) {
        return;
    }
    let section = match material(bot, &org, &repo, id) {
        Ok(document) => format!(
            "{MARKER}\n## Material DevDeck gathered\n\nThe diff, description and threads below were fetched by DevDeck. \
             When the agent workspace is set, the working folder is a clone of the repository at the PR head (fetching works; pushing does not).\n\n{document}\n"
        ),
        Err(error) => format!(
            "{MARKER}\n## Material DevDeck gathered\n\nDevDeck could not fetch this pull request's diff: {error}\n\
             Do not guess the code. Say in your reply what you could not check and ask for the diff.\n"
        ),
    };
    if let Err(error) = std::fs::write(&path, format!("{existing}\n\n{section}")) {
        tracing::warn!(worker = %row.id, %error, "home bot: could not write the PR material");
    }
}

fn material(bot: &HomeBot, org: &str, repo: &str, id: i64) -> Result<String, String> {
    let conn = bot.db.open().map_err(|e| e.to_string())?;
    let pr = find_pr(&conn, org, repo, id).ok_or("the pull request is not in DevDeck's cache")?;
    drop(conn);
    let workspace = bot
        .db
        .get_app_settings()
        .ok()
        .and_then(|s| s.agent_workspace_path)
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime
        .block_on(crate::auto_agent::material::pull_request_document(
            &bot.db,
            workspace.as_deref(),
            &pr,
        ))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pr_key() {
        assert_eq!(
            parse_pr_key("pr:org-1/repo-guid/798"),
            Some(("org-1".into(), "repo-guid".into(), 798))
        );
        assert_eq!(parse_pr_key("wi:org/1"), None);
        assert_eq!(parse_pr_key("pr:org/x"), None);
    }
}

/// Fetches a real PR's material with the user's stored credentials.
/// `DEVDECK_HOME_BOT_DB=<folder with azdodeck.sqlite3> DEVDECK_HOME_BOT_PR=pr:{org}/{repo}/{id}
///  cargo test -p azdo-dashboard real_pr_material -- --ignored --nocapture`
#[cfg(test)]
#[test]
#[ignore]
fn real_pr_material() {
    let dir = std::env::var("DEVDECK_HOME_BOT_DB").unwrap();
    let key = std::env::var("DEVDECK_HOME_BOT_PR").unwrap();
    let db = crate::db::AppDatabase::new(std::path::Path::new(&dir).join("azdodeck.sqlite3"));
    db.initialize().unwrap();
    let bot = HomeBot::new(db, None);
    let (org, repo, id) = parse_pr_key(&key).unwrap();
    let document = material(&bot, &org, &repo, id).unwrap();
    println!(
        "{} chars\n{}",
        document.len(),
        document.chars().take(1500).collect::<String>()
    );
    assert!(document.contains(&format!("Pull request !{id}")));
}

/// A real worker reviews a real PR with the material DevDeck gathered.
/// Same variables as `real_pr_material`.
#[cfg(test)]
#[test]
#[ignore]
fn real_pr_worker() {
    let dir = std::env::var("DEVDECK_HOME_BOT_DB").unwrap();
    let key = std::env::var("DEVDECK_HOME_BOT_PR").unwrap();
    let db = crate::db::AppDatabase::new(std::path::Path::new(&dir).join("azdodeck.sqlite3"));
    db.initialize().unwrap();
    let bot = HomeBot::new(db.clone(), None);
    // As the app does at startup: refresh the result folder's guide.
    if let Some(folder) = db.get_app_settings().unwrap().review_result_folder_path {
        crate::agent_notes::ensure_guide(
            std::path::Path::new(&folder),
            crate::agent_notes::NoteTarget::PullRequest,
            &crate::agent_notes::notes_root(&db),
        )
        .unwrap();
    }
    let snapshot = super::snapshot::build(&db, chrono::Utc::now()).unwrap();
    let target = snapshot
        .target(&key)
        .expect("the PR is in the overview")
        .clone();
    let chat = super::store_chat::new_chat(&db.open().unwrap(), super::types::now_ms()).unwrap();
    let id = super::dispatch::create(
        &bot,
        &chat,
        Some(&target),
        "この PR をレビューして、問題点と承認してよいかを日本語で短くまとめて。",
        "claude",
        Some("sonnet"),
    )
    .unwrap();
    for _ in 0..900 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let row = super::store_chat::get_dispatch(&db.open().unwrap(), &id)
            .unwrap()
            .unwrap();
        if !row.is_active() {
            println!(
                "status: {}\n{}",
                row.status,
                super::dispatch::result_text(&bot, &row)
            );
            assert_ne!(row.status, "failed");
            return;
        }
    }
    panic!("the worker did not finish");
}
