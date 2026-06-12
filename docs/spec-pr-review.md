# 仕様書: アプリ内 PR レビュー(試作)

作成日: 2026-06-13 / ブランチ: `feature/pr-review`

## 概要

My Reviews から選択した Pull Request のレビューを、ブラウザに移動せずアプリ内で完結
できるようにする試作。対象は **投票・コメント閲覧・コメント投稿/返信・ファイル差分表示**。

既存のプレビューペイン(現在はローカル HTML レビュー結果の表示のみ)をタブ化して拡張する。

## アーキテクチャ方針

- **オンデマンド取得**: 選択中 PR の詳細(説明・スレッド・差分)は選択時に REST から
  直接取得する(TanStack Query)。SQLite には保存しない。コメント・投票は鮮度が重要で、
  同期キャッシュ方式は試作には過剰なため。
- 既存の 4 層 IPC 契約(AGENTS.md)に従う: azdo-client → Tauri command → azdoCommands.ts
  (Zod + デモモード) → React。

## バックエンド

### crates/azdo-client(新規モジュール `pr_review.rs`)

| メソッド | REST |
|---|---|
| `get_pull_request` | `GET .../pullrequests/{id}` (説明・レビュアー含む) |
| `list_pull_request_threads` | `GET .../pullrequests/{id}/threads` |
| `create_pull_request_thread` | `POST .../threads` (新規スレッド。`threadContext` 対応) |
| `add_pull_request_comment` | `POST .../threads/{threadId}/comments` (返信) |
| `update_pull_request_thread_status` | `PATCH .../threads/{threadId}` (resolve/reactivate) |
| `submit_pull_request_vote` | `PUT .../reviewers/{reviewerId}` (vote) |
| `list_pull_request_iterations` | `GET .../iterations` |
| `list_pull_request_iteration_changes` | `GET .../iterations/{n}/changes` |
| `get_item_content` | `GET .../items?path=...&versionDescriptor...` (ファイル内容取得) |

- `client.rs` に `put_json` を追加(既存 `patch_json` と同パターン、リトライ共通化)。
- 投票の reviewerId には組織の `authenticated_user_id` を使う(My Reviews 同期と同じ)。
- テストは wiremock(既存 `git.rs` のテストパターンに従う)。

### src-tauri(新規サービス `pr_review.rs`)

`PrReviewService { db, secrets }`。新規 IPC コマンド 6 本:

| コマンド | 内容 |
|---|---|
| `get_pull_request_review` | PR 説明・レビュアー一覧・スレッド一覧をまとめて返す |
| `list_pull_request_changes` | 最新 iteration の変更ファイル一覧(追加/変更/削除種別付き) |
| `get_pull_request_file_diff` | 1 ファイルの base/target テキスト内容。バイナリ・サイズ上限超過はフラグで返す |
| `post_pull_request_comment` | 新規スレッド作成 or 返信。**入力に任意の `filePath`+行番号アンカーを持つ**(後述) |
| `set_pull_request_thread_status` | スレッドの解決/再開 |
| `submit_pull_request_vote` | -10 / -5 / 0 / 5 / 10 の投票 |

- PR 特定は `organizationId` + `projectId` + `repositoryId` + `pullRequestId` で行う
  (`ReviewPullRequestSummary` が既に保持)。
- 差分のサイズ上限: 1 ファイルあたり片側 256 KiB。超過・バイナリは内容なし+理由フラグを返す。

### 将来のインラインコメント対応(今回 UI なし)

`post_pull_request_comment` とスレッド型は最初から行アンカーを持つ:

- 入力: `filePath?`, `rightLine?`(target 側行番号)→ REST の `threadContext.filePath` /
  `rightFileStart/rightFileEnd` にマップ。
- 出力: スレッドに `filePath` / `rightLine` を含め、Files タブのバッジ表示と
  将来の行アンカー UI にそのまま使える形にする。

## フロントエンド

### プレビューペインのタブ化(MyReviewsGrid)

`[Review] [Files] [Result]` の 3 タブ。Result は既存ローカル HTML プレビューの移設。

- **Review タブ**
  - ヘッダーに投票ボタン群(Approve / w/ suggestions / Wait for author / Reject / Reset)。
    現在の自分の投票を強調表示。
  - PR 説明文(プレーンテキスト、pre-wrap。Markdown レンダリングは試作スコープ外)。
  - コメントスレッド一覧: 投稿者・日時・解決状態。ファイルアンカー付きスレッドは
    ファイルパスを表示。返信入力・解決/再開トグル・新規 PR コメント入力。
  - システム生成スレッド(vote 変更等)は折りたたみ/簡略表示。
- **Files タブ**
  - 変更ファイルリスト(変更種別バッジ、スレッド数バッジ)。
  - 選択ファイルの unified diff をクライアント側で計算(`diff` npm パッケージ)。
    遅延計算: ファイル選択時のみ `get_pull_request_file_diff` を取得。
  - バイナリ・上限超過は「ブラウザで開く」リンクにフォールバック。
- 投票・コメント・スレッド状態の変更後は `myReviews` と該当 PR の詳細クエリを invalidate。

### デモモード

`azdoCommands.ts` の demo 分岐に、スレッド・差分・投票のフィクスチャを実装。
投票・コメント投稿はデモ内のメモリ状態を更新し、UI の動作確認ができるようにする。

## スコープ外(試作第 1 弾では実装しない)

- 差分行を選択しての**新規**インラインコメント作成 UI(データ型・IPC は対応済みにする)
- Markdown レンダリング(説明・コメントはプレーンテキスト表示)
- iteration 間の比較(常に base vs 最新 iteration)
- PR の complete / abandon / reply with suggestion
- 画像・バイナリの差分表示

## 検証

- `crates/azdo-client`: wiremock テスト(threads / vote / iterations / items)
- diff 表示ユーティリティの unit テスト(vitest)
- `pnpm tsc --noEmit` / `pnpm test -- --run` / `cargo test --workspace` /
  `cargo clippy --workspace --all-targets -- -D warnings` / `cargo fmt --all --check`
- デモモード(`pnpm dev`)で 3 タブ・投票・コメント投稿の動作確認
