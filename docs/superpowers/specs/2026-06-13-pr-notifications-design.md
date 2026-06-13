# PR通知 設計仕様 (Pull Request Notifications)

- 日付: 2026-06-13
- 対象アプリ: AzDoDeck (Tauri + React + Rust)
- ステータス: 設計合意済み（実装計画はこの後 writing-plans で作成）

## 1. 概要 / 背景

現状、デスクトップ通知は **作業項目（Work Item）** のみが対象で、PR（プルリクエスト）に
関する通知は存在しない（`sync.rs` は `notifications:work-items` のみ emit、設定UIも作業項目用のみ）。

本仕様は、Azure DevOps が通知を送るのと同等のタイミング（ただし本アプリは5分間隔の
ポーリング同期のため「最大5分以内」）で、以下の3種類のPRイベントをデスクトップ通知する
機能を追加する。

## 2. ゴール / 非ゴール

### ゴール
- 次の3トリガーでデスクトップ通知を出す:
  1. **新規レビュー依頼** — 自分がレビュアーに追加されたPR
  2. **投票リセット** — 自分の投票が「非0 → 0」に戻った（新規プッシュ等によるリセット相当）
  3. **コメント返信＋メンション** — 自分が参加するスレッドへの他者の返信、または自分への@メンション
- 既存の作業項目通知の構造・設定パターンを踏襲し、一貫性を保つ。
- ブラウザ（デモ）モードを壊さない。

### 非ゴール
- リアルタイム（サーバープッシュ/Webhook）通知。ポーリング同期前提。
- レビュー対象外PR（自分がレビュアーでないPR）の通知。
- 通知の inbox 集約・既読管理・Quiet hours 等（`spec-ideas-market-research.md` の将来案。範囲外）。
- 「レビュー対象PRの全コメント」通知（ノイズ回避のため、返信＋メンションに限定）。

## 3. トリガー定義と検知ルール

検知は既存の作業項目通知と同じく「**同期前スナップショット → 同期 → 差分**」で行う。
コメント返信のみ、スレッド取得という追加のAPI呼び出しを伴う。

| トリガー | kind | 検知ロジック | 初回（バックフィル）抑止 |
|---|---|---|---|
| 新規レビュー依頼 | `reviewRequested` | 同期前後の `review_pull_requests` を比較し、previous に無く current に有る `pull_request_id` | previous が空（初回同期）なら抑止 |
| 投票リセット | `voteReset` | 同一 `pull_request_id` で `my_vote` が **非0 → 0** に変化 | previous にそのPRが非0で存在する場合のみ発火 |
| コメント返信＋メンション | `commentReply` | 下記「コメント検知ルール」参照 | seen記録の無いPRは現在の最大コメントidを記録し通知抑止 |

### 投票値の前提
`review_pull_requests.my_vote` は Azure DevOps の投票値（10=approve, 5=approve with suggestions,
0=no vote, -5=waiting for author, -10=rejected）。「投票リセット」は **非0 → 0**。
新規レビュー依頼で最初から 0 のものは「previous に存在しない」ため voteReset にはならない。

### コメント検知ルール（`commentReply`）
対象: current のレビューPRのうち、最大 `PR_COMMENT_SCAN_LIMIT`（=50）件。
`db.list_review_pull_requests` は `creation_date DESC` 順で返るため、その先頭から `limit` 件を取る
（新しいPR優先）。
各PRについて `list_pull_request_threads` を取得し、各スレッドの各コメントを評価:

あるコメント `c` を通知対象とする条件（すべて満たす）:
1. `c.author` が自分以外（`c.is_mine == false` / system でない）
2. `c.id > last_seen_comment_id`（そのPRの `pr_comment_seen` 記録値。未記録は下記参照）
3. 次のいずれか:
   - **返信**: `c` の属するスレッドに、自分のコメント（`is_mine == true`）が1つ以上含まれる
   - **メンション**: `c.content` に自分への mention トークンが含まれる
     （Azure DevOps のPRコメントはメンションを `@<GUID>` 形式で保持する。
     `organization.authenticated_user_id` の GUID を含むかで判定。
     **厳密なトークン形式は実装時に既存のメンション符号化コードで確認する**）

処理後、そのPRの `last_seen_comment_id` を「今回観測したコメントidの最大値」に更新する。
seen記録が無いPR（初めて観測したPR）は、通知せずに現在の最大idだけ記録する（過去コメントの
一斉通知を防ぐ。作業項目通知の「初回スナップショットでは assignment を出さない」と同じ思想）。

## 4. アーキテクチャ / データフロー

`sync.rs` の MyReviews 同期パス（`SyncScope::All | Hot | MyReviews`）内に組み込む。

```
1. settings 読込
   should_collect_pr_notifications =
       desktop_notifications_enabled && (notify_pr_review_requests
            || notify_pr_vote_resets || notify_pr_comment_replies)
2. should_collect_pr_notifications なら:
       previous = db.list_review_pull_requests(org)   // 同期前スナップショット
3. sync_prs_for_org(db, client, org)                  // 既存処理
4. emit_sync_updated(MyReviews)                        // 既存
5. should_collect_pr_notifications なら:
       current = db.list_review_pull_requests(org)     // 同期後スナップショット
       items  = pr_review_notification_items(previous, current, settings)   // reviewRequested / voteReset
       if settings.notify_pr_comment_replies:
           items += collect_pr_comment_notifications(db, client, org, settings, PR_COMMENT_SCAN_LIMIT)
       if !items.is_empty():
           handle.emit("notifications:pull-requests", PullRequestNotificationEvent { org_id, org_name, items })
```

フロント側:
```
App.tsx: listen("notifications:pull-requests", e =>
    showPullRequestNotificationEvent(e.payload, currentSettings))
```

## 5. データモデル変更（スキーマ v11）

`src-tauri/src/db.rs` の `migrate()` に v11 ステップを追加（現行は v10）。

新テーブル:
```sql
CREATE TABLE IF NOT EXISTS pr_comment_seen(
    organization_id     TEXT NOT NULL,
    repository_id       TEXT NOT NULL,
    pull_request_id     INTEGER NOT NULL,
    last_seen_comment_id INTEGER NOT NULL,
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (organization_id, repository_id, pull_request_id)
);
PRAGMA user_version = 11;
```

DBアクセス関数（`db.rs`）:
- `get_pr_comment_seen(org_id, repo_id, pr_id) -> Option<i64>`
- `set_pr_comment_seen(org_id, repo_id, pr_id, last_seen_comment_id)`（upsert）

組織削除時のクリーンアップ: `organizations` 削除に伴い当該 org の `pr_comment_seen` も削除
（既存の組織削除処理に合わせる。他キャッシュテーブルと同様の扱い）。

## 6. 設定（Settings）

`app_settings` は key/value 方式のためテーブルのスキーマ変更は不要。コード側で新キーと既定値を扱う。

`AppSettings`（`db.rs`）に追加するフィールド（すべて `bool`、**既定 true**）:
- `notify_pr_review_requests`
- `notify_pr_vote_resets`
- `notify_pr_comment_replies`

対応箇所:
- `db.rs`: `AppSettings` 構造体、`Default`、`get_app_settings`（読込キー）、保存ロジック。
- `settings.rs`: `normalize_app_settings` / `UpdateAppSettingsInput` に3項目を反映。
- `azdoCommands.ts`: `appSettingsSchema` に3項目（`z.boolean().default(true)`）。
- デモ設定（`azdoDemo.ts` の `get_app_settings` 相当）に既定値を反映。

マスタースイッチは既存の `desktop_notifications_enabled` を共用（作業項目通知と同じ）。

## 7. バックエンド構成と型

### 型（`sync.rs` もしくは新規 `pr_notifications` 補助。実装時に判断。既存パターンは sync.rs 内定義）
```rust
#[serde(rename_all = "camelCase")]
struct PullRequestNotificationEvent {
    organization_id: String,
    organization_name: String,
    items: Vec<PrNotificationItem>,
}

#[serde(rename_all = "camelCase")]
struct PrNotificationItem {
    kind: PrNotificationKind,        // reviewRequested | voteReset | commentReply
    pull_request_id: i64,
    title: String,
    repository_name: String,
    project_name: String,
    web_url: Option<String>,
    comment_author: Option<String>,  // commentReply のみ
    snippet: Option<String>,         // commentReply のみ（本文の短い抜粋）
}

#[serde(rename_all = "camelCase")]
enum PrNotificationKind { ReviewRequested, VoteReset, CommentReply }
```

### 関数の責務分離
- `sync.rs`:
  - `pr_review_notification_items(previous: &[CachedReviewPr], current: &[CachedReviewPr], settings: &AppSettings) -> Vec<PrNotificationItem>`（**純関数**。reviewRequested / voteReset を生成。単体テスト対象。`CachedReviewPr` は `db.rs` 既存型で `pull_request_id` / `title` / `repository_name` / `project_name` / `web_url` / `my_vote` 等を持つ）
  - オーケストレーション（スナップショット取得・emit）
- `prs.rs`:
  - `collect_pr_comment_notifications(db, client, org, settings, limit) -> Vec<PrNotificationItem>`
    （スレッド取得＋seen更新というコスト処理をPRドメインに集約）
  - コメント評価の純粋部分は `pr_comment_notification_items(threads, me, last_seen, settings) -> (Vec<PrNotificationItem>, new_max_id)` のように切り出し、単体テスト可能にする。
  - 1PRのスレッド取得失敗は warn ログでスキップし、他PRの処理を止めない（既存の per-project/per-repo エラー分離方針に倣う）。

azdo-client: `list_pull_request_threads` は既存（`pr_review.get_review` が使用）。再利用する。

## 8. フロントエンド変更（IPC 4点契約のうち frontend 側）

- `src/lib/desktopNotifications.ts`:
  - 型 `PullRequestNotificationEvent` / `PullRequestNotificationItem`
  - `showPullRequestNotificationEvent(event, settings): Promise<DesktopNotificationResult>`
    - `desktopNotificationsEnabled` が false or items 空なら `skipped`
    - 件数が多い場合（>3）は「N件のPR更新」に集約。各 kind に応じたタイトル/本文。
    - クリックで `web_url` を `openExternalUrl` で開く（既存の作業項目通知と同じ作法）。
  - タイトル例: `Review requested: !{id}` / `Vote reset: !{id}` / `Reply: !{id}`（最終文言は実装時に調整）
- `src/App.tsx`:
  - `listen<PullRequestNotificationEvent>("notifications:pull-requests", ...)` を追加。
    現在の settings を参照して `showPullRequestNotificationEvent` を呼ぶ（work-items リスナと同形）。
- `src/features/settings/OrganizationSettings.tsx`:
  - `DesktopNotificationSettings` 内に「Pull requests」サブ区画を追加。
    チェックボックス3つ: New review requests / Vote resets / Comment replies & mentions。
  - 保存ペイロードに3項目を含める。

## 9. パフォーマンス・エラー処理・上限

- `PR_COMMENT_SCAN_LIMIT = 50`（定数）。`list_review_pull_requests` の `creation_date DESC` 順の先頭50件のみスレッド取得。
- スレッド取得は `notify_pr_comment_replies` 有効時のみ実行（無効ならコストゼロ）。
- 通知バースト抑止: 1イベント内の items が多い場合はフロントで集約表示（作業項目の「N件まとめ」に倣う）。
- すべての通知失敗・取得失敗は warn ログ。同期処理本体（キャッシュ更新）は通知の失敗に影響されない。

## 10. エッジケース

- **初回同期**: previous が空 → reviewRequested は出さない。seen 未記録PR → commentReply は出さず max id 記録のみ。
- **自分で投票を0に戻した場合**: my_vote が非0→0 となり voteReset として検知され得る。
  Azure 側の挙動とほぼ同義（投票が無くなった事実）なので許容。必要なら将来「直近の自分の操作を除外」する余地あり（本仕様では非対応）。
- **PRがレビュー一覧から外れた（マージ/完了）**: current に無くなるだけで通知は出さない。
- **複数組織**: org ごとにスナップショット・seen を分離（テーブルキーに organization_id 含む）。
- **read-only バリデーションモード**: 通知は読み取りのみのため影響なし（書き込みガード対象外）。

## 11. テスト計画

- Rust 単体（`src-tauri`）:
  - `pr_review_notification_items`: 新規レビュー、投票リセット（非0→0のみ）、初回 previous 空の抑止、無関係な変化を出さないこと。
  - コメント検知純関数: 返信検知、メンション検知、自分のコメント除外、last_seen 以下の除外、初回 seen 未記録時の抑止＋max id 算出。
- フロント（`vitest`）:
  - `showPullRequestNotificationEvent` の整形（単一/集約、settings 無効時の skipped）を軽くテスト。
- ブラウザ（demo）モードが壊れていないこと（settings スキーマにデフォルトが入ること）。

## 12. 検証コマンド

- `pnpm tsc --noEmit`
- `pnpm test -- --run`
- `cargo test --workspace`（PATH に cargo が無ければ `$env:PATH += ";$env:USERPROFILE\.cargo\bin"`）
- `cargo clippy --workspace --all-targets -- -D warnings`

## 13. 影響を受けるファイル（IPC 4点契約 + DB/設定/通知）

| 層 | ファイル | 変更内容 |
|---|---|---|
| DB | `src-tauri/src/db.rs` | v11 マイグレーション、`pr_comment_seen` テーブル、seen の get/set、`AppSettings` 3項目 |
| 設定 | `src-tauri/src/settings.rs` | `normalize_app_settings` / 入力に3項目 |
| 同期 | `src-tauri/src/sync.rs` | PR通知の型、`pr_review_notification_items`、オーケストレーション、`notifications:pull-requests` emit |
| PR | `src-tauri/src/prs.rs` | `collect_pr_comment_notifications` ＋コメント検知純関数 |
| フロント境界 | `src/lib/azdoCommands.ts` | `appSettingsSchema` 3項目、（必要なら）型 |
| フロント境界 | `src/lib/azdoDemo.ts` | デモ設定に3項目の既定値 |
| 通知 | `src/lib/desktopNotifications.ts` | PR通知の型と `showPullRequestNotificationEvent` |
| 画面 | `src/App.tsx` | `notifications:pull-requests` リスナ |
| 画面 | `src/features/settings/OrganizationSettings.tsx` | PRサブ区画の3トグル |

> 注: 新コマンド（`#[tauri::command]`）の追加は不要。通知はバックエンド発の **イベント** で
> 既存の設定コマンド（`update_app_settings` / `get_app_settings`）に項目を足すだけ。
> そのため「4点契約」のうち lib.rs への新規ハンドラ登録は発生しない。
