# PR通知 実装計画 (Pull Request Notifications)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規レビュー依頼・投票リセット・コメント返信/メンションの3イベントでデスクトップ通知を出す。

**Architecture:** 既存の作業項目通知パターン（同期前後スナップショットの差分 + イベント発火 + フロントで通知）を踏襲。前2トリガーはレビューPRキャッシュの差分（追加APIゼロ）、コメントは最大50件のレビューPRに対し `list_pull_request_threads` を取得して検知。再通知防止に新テーブル `pr_comment_seen`（スキーマ v11）。新Tauriコマンドは不要（バックエンド発イベント + 既存設定コマンドの拡張）。

**Tech Stack:** Rust (Tauri, rusqlite, tokio), TypeScript/React (Zod, TanStack Query), azdo-client (reqwest)。

参照スペック: `docs/superpowers/specs/2026-06-13-pr-notifications-design.md`

---

## ファイル構成（変更マップ）

| 層 | ファイル | 変更 |
|---|---|---|
| DB | `src-tauri/src/db.rs` | `AppSettings` 3項目、`get/update_app_settings`、migrate v11、`pr_comment_seen` の get/set |
| 設定 | `src-tauri/src/settings.rs` | `UpdateAppSettingsInput` + `normalize_app_settings` 3項目 |
| 同期 | `src-tauri/src/sync.rs` | PR通知の型、`pr_review_notification_items`（純）、オーケストレーション、emit |
| PR | `src-tauri/src/prs.rs` | `pr_comment_notification_items`（純）、`collect_pr_comment_notifications` |
| 境界 | `src/lib/azdoCommands.ts` | `appSettingsSchema` 3項目 |
| 境界 | `src/lib/azdoDemo.ts` | デモ設定に3項目 |
| 通知 | `src/lib/desktopNotifications.ts` | PR通知型 + `showPullRequestNotificationEvent` |
| 画面 | `src/App.tsx` | `notifications:pull-requests` リスナ |
| 画面 | `src/features/settings/OrganizationSettings.tsx` | PR用トグル3つ |

定数: `PR_COMMENT_SCAN_LIMIT = 50`。

---

## Task 1: AppSettings に PR通知3項目を追加（DB層）

**Files:**
- Modify: `src-tauri/src/db.rs`（`AppSettings` 構造体, `Default`, `get_app_settings`, `update_app_settings`, 既存テスト）

- [ ] **Step 1: `AppSettings` に3フィールド追加**

`pub struct AppSettings { ... }` の末尾に追加:
```rust
    pub notify_pr_review_requests: bool,
    pub notify_pr_vote_resets: bool,
    pub notify_pr_comment_replies: bool,
```
`impl Default for AppSettings` の末尾に追加（既定 true）:
```rust
            notify_pr_review_requests: true,
            notify_pr_vote_resets: true,
            notify_pr_comment_replies: true,
```

- [ ] **Step 2: `get_app_settings` / `update_app_settings` に読み書きを追加**

`get_app_settings` の構築に追加:
```rust
        notify_pr_review_requests: get_bool_setting(conn, "notify_pr_review_requests", true)?,
        notify_pr_vote_resets: get_bool_setting(conn, "notify_pr_vote_resets", true)?,
        notify_pr_comment_replies: get_bool_setting(conn, "notify_pr_comment_replies", true)?,
```
`update_app_settings` に追加:
```rust
    set_bool_setting(conn, "notify_pr_review_requests", settings.notify_pr_review_requests)?;
    set_bool_setting(conn, "notify_pr_vote_resets", settings.notify_pr_vote_resets)?;
    set_bool_setting(conn, "notify_pr_comment_replies", settings.notify_pr_comment_replies)?;
```

- [ ] **Step 3: ビルド確認（既存テストがコンパイルできるか）**

Run: `cargo test --package azdodeck --lib db:: 2>&1 | tail -20`（cargo が無ければ先頭で `$env:PATH += ";$env:USERPROFILE\.cargo\bin"`）
Expected: 既存 `app_settings_can_be_saved_and_cleared` 等がPASS（新フィールドは Default 経由で通る）。失敗時は `AppSettings { .. }` を構築している箇所に新フィールドを補う。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add PR notification settings fields"
```

---

## Task 2: 設定コマンド入力に3項目を反映（settings.rs）

**Files:**
- Modify: `src-tauri/src/settings.rs`（`UpdateAppSettingsInput`, `normalize_app_settings`）

- [ ] **Step 1: `UpdateAppSettingsInput` に3項目追加**

```rust
    pub notify_pr_review_requests: Option<bool>,
    pub notify_pr_vote_resets: Option<bool>,
    pub notify_pr_comment_replies: Option<bool>,
```

- [ ] **Step 2: `normalize_app_settings` に3項目（既定 true）追加**

```rust
        notify_pr_review_requests: input.notify_pr_review_requests.unwrap_or(true),
        notify_pr_vote_resets: input.notify_pr_vote_resets.unwrap_or(true),
        notify_pr_comment_replies: input.notify_pr_comment_replies.unwrap_or(true),
```

- [ ] **Step 3: ビルド確認**

Run: `cargo build --package azdodeck 2>&1 | tail -20`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(settings): accept PR notification toggles in update input"
```

---

## Task 3: pr_comment_seen テーブルと get/set（migrate v11）

**Files:**
- Modify: `src-tauri/src/db.rs`（`SCHEMA_VERSION`, `migrate`, 新 get/set 関数, テスト）

- [ ] **Step 1: 失敗するテストを書く**

`db.rs` の `#[cfg(test)] mod tests` 内に追加:
```rust
    #[test]
    fn pr_comment_seen_roundtrips() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(), None);
        set_pr_comment_seen(&conn, "org", "repo", 42, 100).unwrap();
        assert_eq!(get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(), Some(100));
        set_pr_comment_seen(&conn, "org", "repo", 42, 150).unwrap();
        assert_eq!(get_pr_comment_seen(&conn, "org", "repo", 42).unwrap(), Some(150));
    }
```

- [ ] **Step 2: テストが失敗（未定義）することを確認**

Run: `cargo test --package azdodeck --lib pr_comment_seen_roundtrips 2>&1 | tail -20`
Expected: コンパイルエラー（`get_pr_comment_seen` 未定義）。

- [ ] **Step 3: migrate v11 と get/set を実装**

`const SCHEMA_VERSION: i64 = 10;` を `11` に変更。
`migrate` の v10 ブロックの後ろ（`PRAGMA user_version = 10;` の `if` の後）に追加:
```rust
    if current < 11 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS pr_comment_seen(
                organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                repository_id TEXT NOT NULL,
                pull_request_id INTEGER NOT NULL,
                last_seen_comment_id INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (organization_id, repository_id, pull_request_id)
            );
            PRAGMA user_version = 11;
            "#,
        )?;
    }
```
モジュールの関数群（`get_setting` 付近）に追加:
```rust
fn get_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT last_seen_comment_id FROM pr_comment_seen \
             WHERE organization_id = ?1 AND repository_id = ?2 AND pull_request_id = ?3",
            params![org_id, repository_id, pull_request_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn set_pr_comment_seen(
    conn: &Connection,
    org_id: &str,
    repository_id: &str,
    pull_request_id: i64,
    last_seen_comment_id: i64,
) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO pr_comment_seen(organization_id, repository_id, pull_request_id, last_seen_comment_id, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(organization_id, repository_id, pull_request_id)
        DO UPDATE SET last_seen_comment_id = excluded.last_seen_comment_id, updated_at = excluded.updated_at
        "#,
        params![org_id, repository_id, pull_request_id, last_seen_comment_id, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
```

- [ ] **Step 4: `AppDatabase` の公開メソッドを追加**

`impl AppDatabase`（`get_app_settings` 付近）に追加:
```rust
    pub fn get_pr_comment_seen(&self, org_id: &str, repository_id: &str, pull_request_id: i64) -> Result<Option<i64>> {
        let conn = self.connect()?;
        get_pr_comment_seen(&conn, org_id, repository_id, pull_request_id)
    }

    pub fn set_pr_comment_seen(&self, org_id: &str, repository_id: &str, pull_request_id: i64, last_seen_comment_id: i64) -> Result<()> {
        let conn = self.connect()?;
        set_pr_comment_seen(&conn, org_id, repository_id, pull_request_id, last_seen_comment_id)
    }
```
（接続取得メソッド名 `connect()` は db.rs 内の既存私的メソッドに合わせる。実装時に既存の `get_app_settings` 公開メソッドの書き方を踏襲する。）

- [ ] **Step 5: テストと migrate 冪等性テストがPASSすることを確認**

Run: `cargo test --package azdodeck --lib pr_comment_seen_roundtrips 2>&1 | tail -20`
Run: `cargo test --package azdodeck --lib migrate 2>&1 | tail -20`
Expected: いずれもPASS（`migrate_is_repeatable` は `SCHEMA_VERSION` 参照のため自動追従）。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add pr_comment_seen table and accessors (schema v11)"
```

---

## Task 4: PR通知の型と差分純関数（sync.rs）

**Files:**
- Modify: `src-tauri/src/sync.rs`（型、`pr_review_notification_items`、テスト）

- [ ] **Step 1: 失敗するテストを書く**

`sync.rs` のテストモジュールに追加（`CachedReviewPr` ヘルパ込み）:
```rust
    fn review_pr(pr_id: i64, my_vote: i32) -> CachedReviewPr {
        CachedReviewPr {
            org_id: "o".into(), project_id: "p".into(), project_name: "Proj".into(),
            repository_id: "r".into(), repository_name: "Repo".into(),
            pull_request_id: pr_id, title: format!("PR {pr_id}"),
            created_by: None, creation_date: "2026-06-01T00:00:00Z".into(),
            target_ref_name: "main".into(), web_url: Some("https://x/pr".into()),
            my_vote, my_vote_label: String::new(), my_is_required: true,
            is_draft: false, merge_status: None,
        }
    }

    fn pr_settings(review: bool, reset: bool) -> AppSettings {
        AppSettings { desktop_notifications_enabled: true,
            notify_pr_review_requests: review, notify_pr_vote_resets: reset,
            ..AppSettings::default() }
    }

    #[test]
    fn pr_review_items_flags_new_review_and_vote_reset() {
        let prev = vec![review_pr(1, 10), review_pr(2, 0)];
        let curr = vec![review_pr(1, 0), review_pr(2, 0), review_pr(3, 0)];
        let items = pr_review_notification_items(&prev, &curr, &pr_settings(true, true));
        // PR1: 10 -> 0 = voteReset, PR3: new review request
        assert!(items.iter().any(|i| i.pull_request_id == 1 && i.kind == PrNotificationKind::VoteReset));
        assert!(items.iter().any(|i| i.pull_request_id == 3 && i.kind == PrNotificationKind::ReviewRequested));
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn pr_review_items_suppressed_on_first_snapshot() {
        let curr = vec![review_pr(1, 0), review_pr(2, 0)];
        let items = pr_review_notification_items(&[], &curr, &pr_settings(true, true));
        assert!(items.is_empty());
    }

    #[test]
    fn pr_review_items_respect_toggles() {
        let prev = vec![review_pr(1, 10)];
        let curr = vec![review_pr(1, 0), review_pr(2, 0)];
        let items = pr_review_notification_items(&prev, &curr, &pr_settings(false, false));
        assert!(items.is_empty());
    }
```

- [ ] **Step 2: テストが失敗（未定義）することを確認**

Run: `cargo test --package azdodeck --lib pr_review_items 2>&1 | tail -20`
Expected: コンパイルエラー（型・関数未定義）。

- [ ] **Step 3: 型と純関数を実装**

`sync.rs` に追加（`use crate::db::CachedReviewPr;` を追記）:
```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestNotificationEvent {
    pub organization_id: String,
    pub organization_name: String,
    pub items: Vec<PrNotificationItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrNotificationItem {
    pub kind: PrNotificationKind,
    pub pull_request_id: i64,
    pub title: String,
    pub repository_name: String,
    pub project_name: String,
    pub web_url: Option<String>,
    pub comment_author: Option<String>,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrNotificationKind { ReviewRequested, VoteReset, CommentReply }

fn pr_review_item(pr: &CachedReviewPr, kind: PrNotificationKind) -> PrNotificationItem {
    PrNotificationItem {
        kind,
        pull_request_id: pr.pull_request_id,
        title: pr.title.clone(),
        repository_name: pr.repository_name.clone(),
        project_name: pr.project_name.clone(),
        web_url: pr.web_url.clone(),
        comment_author: None,
        snippet: None,
    }
}

pub fn pr_review_notification_items(
    previous: &[CachedReviewPr],
    current: &[CachedReviewPr],
    settings: &AppSettings,
) -> Vec<PrNotificationItem> {
    use std::collections::HashMap;
    let prev_by_id: HashMap<i64, &CachedReviewPr> =
        previous.iter().map(|pr| (pr.pull_request_id, pr)).collect();
    let first_snapshot = previous.is_empty();
    let mut items = Vec::new();
    for pr in current {
        match prev_by_id.get(&pr.pull_request_id) {
            None => {
                // 初回スナップショットでは既存PRを「新規」と誤検知しないよう抑止
                if settings.notify_pr_review_requests && !first_snapshot {
                    items.push(pr_review_item(pr, PrNotificationKind::ReviewRequested));
                }
            }
            Some(prev) => {
                if settings.notify_pr_vote_resets && prev.my_vote != 0 && pr.my_vote == 0 {
                    items.push(pr_review_item(pr, PrNotificationKind::VoteReset));
                }
            }
        }
    }
    items
}
```

- [ ] **Step 4: テストPASS確認**

Run: `cargo test --package azdodeck --lib pr_review_items 2>&1 | tail -20`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync.rs
git commit -m "feat(sync): PR notification types and review/vote-reset diffing"
```

---

## Task 5: コメント検知の純関数（prs.rs）

**Files:**
- Modify: `src-tauri/src/prs.rs`（`pr_comment_notification_items`, `mentions_user`, テスト）

検知仕様: 作者が自分以外・system でない・`comment.id > last_seen` で、かつ
（そのスレッドに自分のコメントがある=返信） または （本文が自分へのメンションを含む）。
返り値は通知用の生データ（pr単位で sync 側が `PrNotificationItem` に変換、または prs 側で変換）。
ここでは prs 側で `PrNotificationItem`（kind=CommentReply）に変換して返す。

- [ ] **Step 1: 失敗するテストを書く**

`prs.rs` のテストモジュールに追加（azdo-client の `GitThread`/`GitThreadComment` を使う。`use azdo_client::pr_review::{GitThread, GitThreadComment};` と `use azdo_client::git::IdentityRef;` を test 内で）:
```rust
    fn comment(id: i64, author_id: &str, content: &str) -> GitThreadComment {
        GitThreadComment {
            id, parent_comment_id: None, content: Some(content.into()),
            comment_type: Some("text".into()),
            author: Some(IdentityRef { id: Some(author_id.into()), display_name: Some(author_id.into()), unique_name: None }),
            published_date: None, is_deleted: false,
        }
    }
    fn thread(id: i64, comments: Vec<GitThreadComment>) -> GitThread {
        GitThread { id, status: Some("active".into()), is_deleted: false, comments: Some(comments), thread_context: None }
    }

    #[test]
    fn comment_items_detects_reply_to_my_thread() {
        let threads = vec![thread(1, vec![comment(10, "me", "q"), comment(11, "other", "a")])];
        let items = pr_comment_notification_items(&threads, Some("me"), None, /*cap*/ None);
        // 初回(last_seen=None & seen未記録扱い)はバックフィル抑止のため空、max=11
        assert!(items.0.is_empty());
        assert_eq!(items.1, Some(11));
    }

    #[test]
    fn comment_items_detects_after_seen() {
        let threads = vec![thread(1, vec![comment(10, "me", "q"), comment(12, "other", "a")])];
        let (items, max) = pr_comment_notification_items(&threads, Some("me"), Some(11), None);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].pull_request_id, 0); // pr_id は呼び出し側で埋める or テストは author で確認
        assert_eq!(max, Some(12));
    }

    #[test]
    fn comment_items_detects_mention_without_my_thread() {
        let threads = vec![thread(1, vec![comment(20, "other", "hello @<me-guid> please")])];
        let (items, _max) = pr_comment_notification_items(&threads, Some("me-guid"), Some(0), None);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn comment_items_ignores_my_own_and_seen() {
        let threads = vec![thread(1, vec![comment(30, "me", "@<me> note"), comment(31, "other", "unrelated")])];
        // 自分のコメントは無視。otherはメンション無し&自分のスレッドだが last_seen=31 で除外
        let (items, _max) = pr_comment_notification_items(&threads, Some("me"), Some(31), None);
        assert!(items.is_empty());
    }
```

> 注: `PrNotificationItem` の `pull_request_id` 等PRメタは `collect_pr_comment_notifications` 側で埋める。
> 純関数の返す `PrNotificationItem` では PRメタ未設定（0/空）にしておき、呼び出し側で上書きする方が
> テストが単純。実装時に「純関数は `CommentHit { comment_id, author, snippet }` を返し、変換は呼び出し側」
> という形に整理してもよい（その場合テストの assert を `CommentHit` に合わせる）。**実装時にどちらかへ統一すること。**

- [ ] **Step 2: テストが失敗することを確認**

Run: `cargo test --package azdodeck --lib comment_items 2>&1 | tail -20`
Expected: コンパイルエラー。

- [ ] **Step 3: 純関数を実装**

```rust
use azdo_client::pr_review::GitThread;

pub(crate) struct CommentHit {
    pub comment_id: i64,
    pub author: Option<String>,
    pub snippet: Option<String>,
}

fn mentions_user(content: &str, me: &str) -> bool {
    // ADO はメンションを @<GUID> 形式で保持する。大小無視で GUID 出現を見る。
    let needle = me.to_ascii_lowercase();
    content.to_ascii_lowercase().contains(&needle)
}

/// 返り値: (新規ヒット, 観測した最大コメントid)。last_seen=None は「初回観測」で抑止のみ。
pub(crate) fn pr_comment_notification_items(
    threads: &[GitThread],
    me: Option<&str>,
    last_seen: Option<i64>,
    _cap: Option<usize>,
) -> (Vec<CommentHit>, Option<i64>) {
    let me = match me { Some(m) => m, None => return (Vec::new(), None) };
    let mut max_id: Option<i64> = None;
    let mut hits = Vec::new();
    let backfill = last_seen.is_none(); // seen未記録 = 初回 → 抑止
    let threshold = last_seen.unwrap_or(0);
    for thread in threads {
        if thread.is_deleted { continue; }
        let comments = match &thread.comments { Some(c) => c, None => continue };
        let i_am_in_thread = comments.iter().any(|c| {
            c.author.as_ref().and_then(|a| a.id.as_deref()) == Some(me)
        });
        for c in comments {
            if c.is_deleted { continue; }
            max_id = Some(max_id.map_or(c.id, |m| m.max(c.id)));
            if backfill { continue; }
            if c.id <= threshold { continue; }
            let author_id = c.author.as_ref().and_then(|a| a.id.as_deref());
            if author_id == Some(me) { continue; }                 // 自分のコメント除外
            if c.comment_type.as_deref() == Some("system") { continue; } // システム除外
            let content = c.content.as_deref().unwrap_or("");
            let is_mention = mentions_user(content, me);
            if i_am_in_thread || is_mention {
                hits.push(CommentHit {
                    comment_id: c.id,
                    author: c.author.as_ref().and_then(|a| a.display_name.clone()),
                    snippet: Some(truncate_snippet(content, 90)),
                });
            }
        }
    }
    (hits, max_id)
}

fn truncate_snippet(value: &str, max: usize) -> String {
    let t = value.trim();
    if t.chars().count() <= max { return t.to_string(); }
    let mut s: String = t.chars().take(max.saturating_sub(1)).collect();
    s.push('…');
    s
}
```

> テストは `CommentHit` ベースに統一する（Step 1 の注記どおり）。Step 1 の `items[0].pull_request_id` を
> 使うアサーションは `items[0].author` 等に置き換えること。

- [ ] **Step 4: テストPASS確認**

Run: `cargo test --package azdodeck --lib comment_items 2>&1 | tail -20`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/prs.rs
git commit -m "feat(prs): pure PR comment reply/mention detection"
```

---

## Task 6: スレッド取得とseen更新（collect_pr_comment_notifications）

**Files:**
- Modify: `src-tauri/src/prs.rs`（`collect_pr_comment_notifications`）

純関数ではないため単体テストは省略（純粋部分は Task 5 で網羅）。

- [ ] **Step 1: 関数を実装**

```rust
use crate::db::{AppDatabase, Organization};
use azdo_client::AdoClient;
use crate::sync::{PrNotificationItem, PrNotificationKind};

pub(crate) const PR_COMMENT_SCAN_LIMIT: usize = 50;

pub(crate) async fn collect_pr_comment_notifications(
    db: &AppDatabase,
    client: &AdoClient,
    org: &Organization,
) -> Vec<PrNotificationItem> {
    let reviews = match db.list_review_pull_requests(&org.id) {
        Ok(r) => r,
        Err(e) => { tracing::warn!(org = %org.name, error = ?e, "pr-notify: list reviews failed"); return Vec::new(); }
    };
    let me = org.authenticated_user_id.clone();
    let mut items = Vec::new();
    for pr in reviews.into_iter().take(PR_COMMENT_SCAN_LIMIT) {
        let threads = match client
            .list_pull_request_threads(&pr.project_id, &pr.repository_id, pr.pull_request_id)
            .await
        {
            Ok(t) => t,
            Err(e) => { tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "pr-notify: threads failed"); continue; }
        };
        let last_seen = db
            .get_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id)
            .unwrap_or(None);
        let (hits, max_id) = pr_comment_notification_items(&threads, me.as_deref(), last_seen, None);
        for hit in hits {
            items.push(PrNotificationItem {
                kind: PrNotificationKind::CommentReply,
                pull_request_id: pr.pull_request_id,
                title: pr.title.clone(),
                repository_name: pr.repository_name.clone(),
                project_name: pr.project_name.clone(),
                web_url: pr.web_url.clone(),
                comment_author: hit.author,
                snippet: hit.snippet,
            });
        }
        if let Some(max_id) = max_id {
            if let Err(e) = db.set_pr_comment_seen(&org.id, &pr.repository_id, pr.pull_request_id, max_id) {
                tracing::warn!(org = %org.name, pr = pr.pull_request_id, error = ?e, "pr-notify: set seen failed");
            }
        }
    }
    items
}
```

- [ ] **Step 2: ビルド確認**

Run: `cargo build --package azdodeck 2>&1 | tail -20`
Expected: 成功（型・可視性の不整合があれば修正）。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/prs.rs
git commit -m "feat(prs): fetch threads and collect PR comment notifications"
```

---

## Task 7: 同期ループへ組み込み + emit（sync.rs）

**Files:**
- Modify: `src-tauri/src/sync.rs`（`sync_once` の PR同期ブロック周辺）

- [ ] **Step 1: gating と前スナップショットを追加**

`should_collect_work_item_notifications` の定義付近に追加:
```rust
        let should_collect_pr_notifications = settings.desktop_notifications_enabled
            && (settings.notify_pr_review_requests
                || settings.notify_pr_vote_resets
                || settings.notify_pr_comment_replies);
```

- [ ] **Step 2: PR同期ブロックを差し替え**

現在の MyReviews 同期ブロック（`sync_prs_for_org` 呼び出し）を次に置換:
```rust
            if matches!(scope, SyncScope::All | SyncScope::Hot | SyncScope::MyReviews) {
                let previous_reviews = if should_collect_pr_notifications {
                    self.db.list_review_pull_requests(&org.id).unwrap_or_default()
                } else { Vec::new() };

                if let Err(e) = sync_prs_for_org(&self.db, &client, &org).await {
                    tracing::error!(org = %org.name, error = ?e, "sync: PR sync failed");
                } else {
                    emit_sync_updated(handle, &org.id, vec![SyncScope::MyReviews]);
                    if should_collect_pr_notifications {
                        let current_reviews = self.db.list_review_pull_requests(&org.id).unwrap_or_default();
                        let mut items = pr_review_notification_items(&previous_reviews, &current_reviews, &settings);
                        if settings.notify_pr_comment_replies {
                            items.extend(
                                crate::prs::collect_pr_comment_notifications(&self.db, &client, &org).await,
                            );
                        }
                        if !items.is_empty() {
                            let event = PullRequestNotificationEvent {
                                organization_id: org.id.clone(),
                                organization_name: org.name.clone(),
                                items,
                            };
                            if let Err(e) = handle.emit("notifications:pull-requests", event) {
                                tracing::warn!(org = %org.name, error = ?e, "sync: failed to emit PR notification event");
                            }
                        }
                    }
                }
            }
```

- [ ] **Step 3: ビルド + 全Rustテスト**

Run: `cargo test --workspace 2>&1 | tail -30`
Expected: 全PASS。

- [ ] **Step 4: clippy**

Run: `cargo clippy --workspace --all-targets -- -D warnings 2>&1 | tail -30`
Expected: 警告なし。`pub` 可視性は必要範囲のみ（`collect_pr_comment_notifications` は `pub(crate)`）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync.rs
git commit -m "feat(sync): emit notifications:pull-requests after MyReviews sync"
```

---

## Task 8: フロント境界の設定スキーマとデモ（azdoCommands.ts / azdoDemo.ts）

**Files:**
- Modify: `src/lib/azdoCommands.ts`（`appSettingsSchema`）
- Modify: `src/lib/azdoDemo.ts`（`get_app_settings` 相当のデモ）

- [ ] **Step 1: Zod スキーマに3項目追加**

`appSettingsSchema` に追記:
```ts
  notifyPrReviewRequests: z.boolean().default(true),
  notifyPrVoteResets: z.boolean().default(true),
  notifyPrCommentReplies: z.boolean().default(true),
```

- [ ] **Step 2: デモ設定に3項目追加**

`azdoDemo.ts` の `get_app_settings` が返すオブジェクトに追記（既存の `notifyWorkItemStateChanges` 付近）:
```ts
      notifyPrReviewRequests: true,
      notifyPrVoteResets: true,
      notifyPrCommentReplies: true,
```
（実装時に既存のデモ設定オブジェクトのキー命名・場所に合わせる。）

- [ ] **Step 3: 型チェック**

Run: `pnpm tsc --noEmit 2>&1 | tail -20`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add src/lib/azdoCommands.ts src/lib/azdoDemo.ts
git commit -m "feat(frontend): add PR notification settings to schema and demo"
```

---

## Task 9: デスクトップ通知表示（desktopNotifications.ts）

**Files:**
- Modify: `src/lib/desktopNotifications.ts`

- [ ] **Step 1: PR通知の型を追加**

```ts
export type PullRequestNotificationEvent = {
  organizationId: string;
  organizationName: string;
  items: PullRequestNotificationItem[];
};

type PullRequestNotificationItem = {
  kind: "reviewRequested" | "voteReset" | "commentReply";
  pullRequestId: number;
  title: string;
  repositoryName: string;
  projectName: string;
  webUrl: string | null;
  commentAuthor: string | null;
  snippet: string | null;
};
```

- [ ] **Step 2: 表示関数を実装**

```ts
export async function showPullRequestNotificationEvent(
  event: PullRequestNotificationEvent,
  settings: AppSettings,
): Promise<DesktopNotificationResult> {
  if (!settings.desktopNotificationsEnabled || event.items.length === 0) {
    return "skipped";
  }
  const contentPreview = settings.notificationContentPreviewEnabled;
  const items = event.items.slice(0, 20);
  if (items.length > 3) {
    return sendDesktopNotification(`${items.length} pull request updates`, {
      body: contentPreview
        ? `${event.organizationName}: ${items
            .slice(0, 3)
            .map((i) => `!${i.pullRequestId} ${i.title}`)
            .join(", ")}`
        : "Open AzDoDeck to review the latest pull request updates.",
    });
  }
  let result: DesktopNotificationResult = "denied";
  for (const item of items) {
    result = await sendDesktopNotification(prNotificationTitle(item), {
      body: contentPreview ? prNotificationBody(event.organizationName, item) : "Open AzDoDeck to review this pull request update.",
      onClick: item.webUrl ? () => { void openExternalUrl(item.webUrl!); } : undefined,
    });
  }
  return result;
}

function prNotificationTitle(item: PullRequestNotificationItem): string {
  switch (item.kind) {
    case "reviewRequested": return `Review requested: !${item.pullRequestId}`;
    case "voteReset": return `Vote reset: !${item.pullRequestId}`;
    case "commentReply": return `New reply: !${item.pullRequestId}`;
  }
}

function prNotificationBody(orgName: string, item: PullRequestNotificationItem): string {
  const title = truncate(item.title, 90);
  if (item.kind === "commentReply") {
    const who = item.commentAuthor ?? "Someone";
    const snippet = item.snippet ? `\n${truncate(item.snippet, 90)}` : "";
    return `${who} on "${title}"${snippet}\n${item.repositoryName} / ${orgName}`;
  }
  return `${title}\n${item.repositoryName} / ${orgName}`;
}
```
（`truncate` は既存のものを再利用。`prNotificationTitle` の網羅 switch は既存 lint 設定に合わせ default 不要。）

- [ ] **Step 3: 型チェック**

Run: `pnpm tsc --noEmit 2>&1 | tail -20`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add src/lib/desktopNotifications.ts
git commit -m "feat(frontend): render PR desktop notifications"
```

---

## Task 10: イベント購読（App.tsx）

**Files:**
- Modify: `src/App.tsx`（import と listener useEffect）

- [ ] **Step 1: import を追加**

`desktopNotifications` からの import に `showPullRequestNotificationEvent` と型 `PullRequestNotificationEvent` を追加。

- [ ] **Step 2: listener を追加**

既存の `notifications:work-items` の useEffect の直後に複製して追加:
```tsx
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cleanup: (() => void) | undefined;
    listen<PullRequestNotificationEvent>("notifications:pull-requests", (event) => {
      const settings = appSettingsRef.current;
      if (!settings) return;
      void showPullRequestNotificationEvent(event.payload, settings);
    })
      .then((unlisten) => { cleanup = unlisten; })
      .catch((e) => console.error("notifications:pull-requests listen failed", e));
    return () => cleanup?.();
  }, []);
```

- [ ] **Step 3: 型チェック**

Run: `pnpm tsc --noEmit 2>&1 | tail -20`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): subscribe to PR notification events"
```

---

## Task 11: 設定UIのトグル（OrganizationSettings.tsx）

**Files:**
- Modify: `src/features/settings/OrganizationSettings.tsx`（`DesktopNotificationSettings`）

- [ ] **Step 1: state を追加**

`DesktopNotificationSettings` 内に追加（既存 state 群の付近）:
```tsx
  const [prReviewRequests, setPrReviewRequests] = useState(true);
  const [prVoteResets, setPrVoteResets] = useState(true);
  const [prCommentReplies, setPrCommentReplies] = useState(true);
```
設定読込 useEffect に追加:
```tsx
    setPrReviewRequests(settings?.notifyPrReviewRequests ?? true);
    setPrVoteResets(settings?.notifyPrVoteResets ?? true);
    setPrCommentReplies(settings?.notifyPrCommentReplies ?? true);
```

- [ ] **Step 2: 保存ペイロードに追加**

`onSubmit` の `mutate(settingsInput(... { ... }))` に追加:
```tsx
        notifyPrReviewRequests: prReviewRequests,
        notifyPrVoteResets: prVoteResets,
        notifyPrCommentReplies: prCommentReplies,
```

- [ ] **Step 3: UI（Pull requests サブ区画）を追加**

作業項目用チェック群（`md:grid-cols-3` の div）の後に追加:
```tsx
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">Pull requests</p>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prReviewRequests}
                onChange={(e) => setPrReviewRequests(e.target.checked)}
                className="h-4 w-4 rounded border-input" />
              New review requests
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prVoteResets}
                onChange={(e) => setPrVoteResets(e.target.checked)}
                className="h-4 w-4 rounded border-input" />
              Vote resets
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prCommentReplies}
                onChange={(e) => setPrCommentReplies(e.target.checked)}
                className="h-4 w-4 rounded border-input" />
              Comment replies & mentions
            </label>
          </div>
        </div>
```
説明文（`Notify when assigned work items or states change after sync.`）も
「…and on review requests, vote resets, and replies.」へ更新する。

- [ ] **Step 4: 型チェック + フロントテスト**

Run: `pnpm tsc --noEmit 2>&1 | tail -20`
Run: `pnpm test -- --run 2>&1 | tail -30`
Expected: いずれも成功。

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/OrganizationSettings.tsx
git commit -m "feat(settings-ui): add PR notification toggles"
```

---

## Task 12: 最終検証

- [ ] **Step 1: フロント型 + テスト**

Run: `pnpm tsc --noEmit && pnpm test -- --run 2>&1 | tail -30`
Expected: 成功。

- [ ] **Step 2: Rust テスト + clippy**

Run: `cargo test --workspace 2>&1 | tail -30`
Run: `cargo clippy --workspace --all-targets -- -D warnings 2>&1 | tail -30`
Expected: 成功・警告なし。

- [ ] **Step 3: （任意）デモUIで設定トグルが表示されることを確認**

`pnpm dev` で Settings を開き、Desktop notifications に「Pull requests」3トグルが出ること。

---

## Self-Review メモ（計画作成者による確認）

- スペック §2 の3トリガー → Task 4（review/vote）・Task 5,6（comment）で網羅。
- §3 初回抑止 → Task 4（previous空）・Task 5（last_seen=None）で実装。
- §5 v11/pr_comment_seen → Task 3。 §6 設定3項目 → Task 1,2,8,11。
- §7 型/関数分離 → Task 4（sync 純関数）・Task 5,6（prs）。
- §8 フロント4点 → Task 8,9,10,11。 §11 テスト → Task 3,4,5,12。
- メンション厳密形式は `mentions_user`（GUID 部分一致）で近似。Task 5 実装時に既存メンション符号化を確認し、必要なら `@<{guid}>` 厳密一致へ寄せる（**実装時の確認事項**）。
- 型整合: `PrNotificationItem` / `PrNotificationKind` は sync.rs で定義し prs.rs から参照。`CommentHit` は prs.rs 内部。`CachedReviewPr` は db.rs 既存。
