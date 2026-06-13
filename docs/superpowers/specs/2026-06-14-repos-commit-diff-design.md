# Commit Detail + Diff 設計 (領域 E 第1弾)

- 日付: 2026-06-14
- 領域: E (Repos)
- スコープ: 既存「Commits 検索」を完成させる。選択 commit の **変更ファイル一覧 + インライン diff**
  (read-only, unified) を preview に追加する。

## スコープ

IN:
- commit の変更ファイル一覧 (path・change type・rename 元)
- ファイル選択でその commit と第1親の差分を unified で表示 (read-only)
- diff 計算は既存 `@/lib/diffView` を再利用 (PR diff と同じエンジン)

OUT (将来):
- Branches / Tags 一覧、ファイルブラウズ、blame、split view、コメント
- merge commit の複数親比較 (第1親のみ使用)

## データ取得

PR diff と同じく **on-demand ライブ取得**。SQLite キャッシュは既存 commit 一覧のみ。

## バックエンド

### azdo-client (`git.rs`)
- `GitCommitRef` に `parents: Option<Vec<String>>` を追加 (serde default、後方互換)。
- `get_commit(project, repo, commit_id) -> GitCommitRef`
  → `GET {project}/_apis/git/repositories/{repo}/commits/{commitId}`
- `get_commit_changes(project, repo, commit_id) -> Vec<GitChangeEntry>`
  → `GET .../commits/{commitId}/changes` (レスポンスは `{ changes: [...] }`)
  → `GitChangeEntry` は `pr_review` のものを再利用。
- ファイル内容は既存 `get_item_content(project, repo, path, commit_id)` を再利用。

### src-tauri (`commits.rs`)
`CommitService` に async メソッドを追加 (既存は sync キャッシュ検索):
- `get_commit_changes(input{org?, projectId, repositoryId, commitId})`
  → `CommitChangeSet { commitId, parentCommitId: Option<String>, files: Vec<CommitChangedFile{path, changeType, originalPath}> }`
  - `parentCommitId` = `get_commit` の parents の先頭 (なければ None)
  - フォルダ item は除外
- `get_commit_file_diff(input{org?, projectId, repositoryId, filePath, originalPath?, changeType, commitId, parentCommitId?})`
  → `CommitFileDiff { filePath, baseContent, targetContent, baseUnavailableReason, targetUnavailableReason }`
    (= 既存 `PrFileDiff` と同形)
  - target = `commitId` の filePath 内容、base = `parentCommitId` の originalPath(無ければ filePath) 内容
  - add は base 省略、delete は target 省略 (change type で判定)
  - 取得は `fetch_side` 相当 (binary / tooLarge / missing の理由付き、256KB 上限)

### IPC (`lib.rs`)
- `get_commit_changes`、`get_commit_file_diff` (どちらも read、write ゲート不要)

## フロントエンド

- `azdoCommands.ts`: 2コマンドの wrapper + Zod + demo。
- 新規 `src/features/commits/CommitFilesPanel.tsx`:
  - commit 選択時に `get_commit_changes` を取得し、変更ファイルを flat list (change badge 付き) で表示。
  - ファイル選択で `get_commit_file_diff` を取得し、read-only unified diff を表示
    (`buildDiffLines` + `collapseDiff` を再利用、gap は "expand all" のみ、最大2000行)。
- `CommitSearch` の preview pane に「Changed files」セクションとして組み込む。

## 検証
- `cargo test --workspace` / `cargo clippy ... -D warnings`
- `pnpm tsc --noEmit` / `pnpm test -- --run`
- browser demo で commit 選択 → 変更ファイル → diff 表示
