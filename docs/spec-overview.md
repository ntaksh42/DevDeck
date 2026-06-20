# 仕様書: AzDoDeck 全体仕様 (現状版)

作成日: 2026-06-20 / ステータス: 現状コードの実装に基づく確定仕様

---

## 1. 製品概要

AzDoDeck は Azure DevOps 用の **Windows デスクトップダッシュボード**である。
プルリクエスト (レビュー依頼)、作業項目 (チケット)、コミット、パイプライン、
コードを 1 つのウィンドウから横断検索・操作し、対応が必要なものはブラウザの
Azure DevOps に直接ジャンプできる。キーボード中心・高密度な「デッキ型」運用を
目指す。

- 配布形態: Windows x64 のみ。NSIS (`.exe`) と MSI (`.msi`) インストーラ。
- ランタイム: システムの Microsoft Edge WebView2 を利用 (ブラウザエンジンを同梱しない)。
- ステータス: プレリリース (v0.x)。インストーラ未署名、自動アップデート未対応。

---

## 2. アーキテクチャ

```text
React + Vite + TypeScript (src/)
    ↓  Tauri IPC invoke()  /  ブラウザ時は demoInvoke()
Rust バックエンド (src-tauri/src/)
    ├── prs.rs / work_items/ / commits.rs / search.rs / pipelines.rs / code_search.rs / pr_review.rs
    │                                          — ドメインサービス
    ├── sync.rs                                — バックグラウンド同期ループ + sync:updated イベント
    ├── snooze.rs                              — スヌーズ規則
    ├── orgs.rs / projects.rs / settings.rs    — 組織・プロジェクト・アプリ設定
    ├── auth.rs                                — PAT / Azure CLI 認証プロバイダ
    ├── db.rs                                  — SQLite キャッシュ (rusqlite, スキーマ移行)
    ├── secrets.rs                             — keyring (Windows 資格情報マネージャ)
    ├── cancellation.rs                        — 実行中コマンドの協調キャンセル
    └── error.rs                               — AppError (IPC 向けエラー型)
         ↓
crates/azdo-client/                            — Tauri 非依存の独立 ADO REST クライアント
    Azure DevOps REST API 7.1
```

### ランタイム境界 (重要)

`src/lib/azdoCommands.ts` が `isTauriRuntime()` でランタイムを判定する。

- **デスクトップ (Tauri)**: `invoke()` で Rust の `#[tauri::command]` を呼ぶ。
- **ブラウザ (`pnpm dev`)**: `demoInvoke()` がデモ用フィクスチャを返す。実 API は呼ばない。

両ランタイムを常に動作させること。新規コマンドはデモ実装と Zod スキーマを必須成果物とする。

### IPC 4 層契約

新規・変更コマンドは次の 4 箇所を一貫して更新する。

1. `src-tauri/src/lib.rs` の `#[tauri::command]` 関数 + `generate_handler![]` 登録。
2. 対応するドメインサービスモジュール (`prs.rs` 等) のロジック。
3. `src/lib/azdoCommands.ts` のラッパ + Zod スキーマ + ブラウザデモ分岐。
4. 呼び出し元の React フィーチャ/コンポーネント。

---

## 3. 機能 / ビュー一覧

サイドバーのナビには件数バッジを表示する: My Reviews (未投票=要レビューの件数)、
My Items (割当件数)、ピン留めした Work Item View (最後に取得した件数)。0/未取得時は非表示。

| ビュー | 用途 |
|---|---|
| **My Reviews** | 自分がレビュアーの PR。投票状態・マージコンフリクト/CI バッジ・stale 強調・ローカルの done/archive トリアージ・ローカルのレビュー結果プレビュー。自分のレビュー後に author の push で投票がリセットされた PR を「Returned」バッジで強調（投票スナップショットの差分でローカル検出、開く/再投票で解除）。ソート可能な「Review age」列 (作成からの経過日数、stale 閾値超過で強調)。 |
| **Pull Request Search** | プロジェクト/リポジトリ/ステータスで PR を検索。ソート可能グリッド、列リサイズ、`C` で URL コピー。 |
| **My Work Items** | 自分に割当中の作業項目 (最大 200 件キャッシュ)。状態・種別・割当先・更新日時。最後に開いてから変更された項目に未読マーカー (ChangedDate の差分でローカル検出、開くと消える)。 |
| **Work Item Views** | 保存済み WIQL クエリ。件数表示、ナビへのピン留め、並べ替え、ビュー別ソート/列。 |
| **Work Item Search** | キーワード + プロジェクト/状態/種別での作業項目検索。全文検索 (FTS)。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。 |
| **Release Notes** | プロジェクト + 期間からマージ済み (completed) PR を集約し、リポジトリ別にグルーピングした Markdown リリースノートを生成 (`generate_release_notes`、オンデマンド・非キャッシュ)。クリップボードコピー対応。 |
| **My Commits** | author = 自分のコミットを検索操作なしに自動ロード (Commits ビューを `myCommitsMode` で流用、組織の認証ユーザー名で seed・90 日窓・組織切替で再取得)。Commits と同じグリッド/プレビュー/関連 PR ルックアップ。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。 |
| **Code Search** | リポジトリ横断のコード検索。ファイル/パス/ブランチとリンク。進行中の検索を Cancel でき (`operationId` + `cancel_operation`、`CancellationRegistry` が `tokio::select!` で実行中 future を drop)、キャンセル後も直近の結果が残る。 |
| **Settings** | 組織設定 (PAT / Azure CLI)、通知設定、フォルダパス、グローバルホットキー、キーバインド上書き。Software update パネル (opt-in: 手動で更新確認→適用、失敗時は安全にスキップ。`tauri-plugin-updater`、ブラウザでは無効)。 |

### 横断機能

- **コマンドパレット (`Ctrl+K`)**: コマンド実行 + 作業項目/アクティブ PR/コミットの横断検索。
  接頭辞 `wi:` / `pr:` / `c:` で種別を限定。`Enter` でアプリ内、`Ctrl+Enter` でブラウザ。
- **スヌーズ**: PR / 作業項目の通知を一定期間繰り延べ。新たなアクティビティまたは期限で復帰。
- **作業項目の一括操作**: 複数項目の状態変更・割当・優先度設定をまとめて適用。
- **作業項目編集**: state / assignee / priority / フィールドをステージし 1 リクエストで適用。
  @メンション付きコメント、フィールドプリセット。

---

## 4. 認証とシークレット

- **認証プロバイダ**: `auth_provider` は厳密に `pat` または `azure_cli` (アンダースコア形)。
  - **PAT**: `Authorization: Basic base64(":{pat}")`。必要スコープは Code(Read)/Work Items(Read)/Project and Team(Read)。
  - **Azure CLI**: `az account get-access-token` を実行し Bearer トークンを取得。メモリに 5 分キャッシュ。
- **シークレット保管**: Windows 資格情報マネージャ (`keyring`) のみ。
  - サービス名: `AzDoDeck`。
  - 資格情報キー: `azdodeck:org:{org}:pat` / `azdodeck:org:{org}:azure-cli`。
  - PAT / トークンを SQLite・設定ファイル・ログ・テスト・デモに**一切残さない**。
- **複数組織**: 複数組織を登録でき、各検索フォームの組織セレクタで切替。

---

## 5. データとバックグラウンド同期

### SQLite キャッシュ

- アクセス: `AppDatabase` がパスラッパとして呼び出しごとに接続を開く (`rusqlite`)。
- 移行: `src-tauri/src/db.rs` の `migrate()` が `PRAGMA user_version` を使用。
  **現行スキーマバージョン: 14**。
- 主なテーブル: 組織、アクティブ/レビュー対象 PR、作業項目、My Work Items スナップショット
  (最大 200)、コミット、コミット↔PR 関連、各種 FTS インデックス、同期状態、スヌーズ、
  PR コメント既読、メンション/割当先履歴、アプリ設定。
- ジャーナル: WAL、`synchronous=NORMAL`、外部キー ON。

### 同期ループ (`sync.rs`)

- スコープ: `All` / `Hot` (MyReviews + MyWorkItems の高速更新) / `MyReviews` / `MyWorkItems` / `Commits`。
- 間隔: フル同期は約 5 分間隔。起動時とウィンドウ復帰時は Hot 同期 (復帰はスロットル)。手動トリガは間隔を無視。
- イベント: 同期完了で `sync:updated` (org_id + 完了スコープ)。
  通知イベントは PR / 作業項目向けに別途 emit。
- デスクトップ通知: 設定が有効な場合のみ。初回スナップショットでは過去分を通知しない。
  スヌーズ対象は通知から除外。コメント返信は `pr_comment_seen` で追跡。

### REST クライアントの信頼性 (`azdo-client`)

- HTTP は `AdoClient::get_json` / `post_json` 経由に統一 (リトライ・401・429・5xx 挙動を一貫させる)。
- 既定: 3 回試行、ベース遅延 250ms の指数バックオフ。
- 401: 即時 `Unauthorized`。429: `Retry-After` を尊重 (上限付き)。5xx/タイムアウト/ネットワーク: リトライ。
- `azdo-client` は Tauri 非依存を維持し、`wiremock` でテストする。

### `azdo-client` モジュール構成

`git` (PR/コミット/リポジトリ)、`work_items`、`pipelines`、`code_search`、
`pr_review` (スレッド/コメント/差分)、`pr_status` (CI 集約)、`identity`、`auth`、`client`、`error`。

---

## 6. アプリ設定 (AppSettings)

| 設定 | 内容 |
|---|---|
| `review_result_folder_path` | レビュー結果 HTML を格納するフォルダ。My Reviews のプレビューが PR 番号を含むファイルを照合。 |
| `show_window_hotkey` | ウィンドウを前面化するグローバルホットキー。 |
| `read_only_validation_mode_enabled` | 読み取り専用モード (誤操作によるミューテーションを抑止)。既定 false。 |
| `desktop_notifications_enabled` | デスクトップ通知の総合トグル。既定 false。 |
| `notification_content_preview_enabled` | 通知に本文プレビューを含めるか。既定 true。 |
| `notify_work_item_assignments` | 作業項目の新規割当を通知。 |
| `notify_work_item_state_changes` | 作業項目の状態変化を通知。 |
| `notify_pr_review_requests` | PR レビュー依頼を通知。 |
| `notify_pr_vote_resets` | 自分の PR 投票リセットを通知。 |
| `notify_pr_comment_replies` | 自分の PR コメントへの返信を通知。 |
| `review_stale_threshold_days` | レビュー PR を stale 扱いする日数 (候補 2/3/5/7、既定 3)。 |

---

## 7. キーボード操作

キーボード操作可能性は**ハード要件**。すべてのインタラクティブ要素にキーボード経路を用意する。

### グローバル

| キー | 動作 |
|---|---|
| `Ctrl+K` | コマンドパレット |
| `?` / `F1` | ヘルプ (全ショートカット一覧) |
| `G` → 第 2 キー | ビュー切替 (下表) |
| `Ctrl+F` / `/` | フィルタにフォーカス |

アプリに割り当てていない WebView 既定ショートカット (`Ctrl+P` 印刷、`Ctrl+G`
find-next) は、入力欄以外では抑止し、ネイティブ動作が素通りしないようにする。

### Go-To チェーン (`G` リーダー + 第 2 キー)

`R` My Reviews / `P` PR Search / `W` My Work Items / `I` Work Item Search /
`V` Work Item Views / `C` Commits / `B` Pipelines / `D` Code Search / `S` Settings。

### グリッド内

`↑ ↓ / J K / Home / End / PageUp / PageDown` で移動、`Enter` でプレビュー/オープン、
`Ctrl+Enter` でブラウザを開く、`C` で URL コピー。作業項目グリッドでは
`S` 状態 / `A` 割当 / `P` 優先度 / `F` フィールド循環、`Ctrl+S` で適用、`M` でコメント。
行を1件選択中は、ステータスバーに主要な行ショートカットのコンパクトな凡例を表示する
(My Reviews / 作業項目グリッド)。

ポップオーバー/メニュー/ダイアログは、最初の妥当なコントロールにフォーカスして開き、
矢印/Enter/Space/Escape で完結し、閉じる際は呼び出し元へフォーカスを返す。
ナビゲーションキーはポップアップ内に閉じ込め、背後グリッドが反応しないようにする。

---

## 8. Azure DevOps URL の組み立て

PR の Web リンクは REST メタデータを再利用せず、信頼できるフィールドから構築する。

```rust
format!(
    "{}/{}/_git/{}/pullrequest/{}",
    organization.base_url, proj_name, repo_name, pr.pull_request_id
)
```

`organization.base_url` は末尾スラッシュ無しの `https://dev.azure.com/{org}` 形を想定。

---

## 9. 制約・方針

- PR ビューはローカル同期された **active** PR データから動作する。サービス/キャッシュ層を
  同時に更新しない限り「all statuses」のような未対応を示唆する UI を出さない。
- Azure DevOps のリッチテキストは表示前にサニタイズ・正規化し、生の HTML を可視テキストに漏らさない。
- サーバ状態は TanStack Query 経由。ミューテーションで画面表示が変わる場合は該当クエリキーを更新/無効化する。
- 長いリストは既存のローカル windowing で仮想化する。
- 広範なリファクタは要求された変更に必要な場合のみ行う。

---

## 10. 検証

| 変更対象 | コマンド |
|---|---|
| フロント/型 | `pnpm tsc --noEmit` |
| React 単体 | `pnpm test -- --run` |
| ブラウザ動線 | `pnpm test:e2e` |
| Rust サービス/クライアント | `cargo test --workspace` |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` |
| リリース確認 | `pnpm tauri build` |

---

## 関連ドキュメント

- 設計解説 (初心者向け): [`docs/design/README.md`](design/README.md)
- 提案/将来計画: `docs/spec-cross-cutting-efficiency.md` (横断・運用効率),
  `docs/spec-reliability-foundation.md` (信頼性・基盤),
  `docs/spec-pr-review.md`, `docs/spec-keyboard-ux.md`,
  `docs/spec-ideas-market-research.md`, `docs/product-improvement-ideas.md`
- デモ/E2E: `docs/demo-harness.md`, `docs/e2e-agent-ui-checks.md`
- エージェント向け規約: [`AGENTS.md`](../AGENTS.md)
</content>
</invoke>
