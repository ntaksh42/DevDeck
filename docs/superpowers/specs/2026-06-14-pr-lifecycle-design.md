# PR ライフサイクル操作 設計 (領域 F 第1弾)

- 日付: 2026-06-14
- 領域: F (Pull Requests)
- スコープ: 既存 PR レビュー画面から **PR のステータス操作** を可能にする。

## スコープ

IN (PR ステータス遷移、すべて `PATCH .../pullrequests/{id}`):
- Abandon (`{ status: "abandoned" }`)
- Reactivate (`{ status: "active" }`)
- Publish draft → active (`{ isDraft: false }`)
- Complete = マージ
  (`{ status: "completed", lastMergeSourceCommit: {...}, completionOptions: { mergeStrategy, deleteSourceBranch } }`)
  - mergeStrategy: `noFastForward`(merge) / `squash` / `rebase` / `rebaseMerge`
  - deleteSourceBranch: 任意 (既定 false)
- すべて `ensure_write_enabled` ゲート + confirm 必須、read-only mode 時は無効化。

OUT (将来): reviewer 追加削除、PR 作成、retarget、cherry-pick/revert、work item link、
policy/build status 表示、auto-complete 設定。

## バックエンド

### azdo-client (`pr_review.rs`)
- `GitPullRequestDetail` に `status: Option<String>` と
  `last_merge_source_commit: Option<GitCommitRefId>` を追加 (serde optional、後方互換)。
- `update_pull_request(project, repo, pr_id, body: &serde_json::Value) -> GitPullRequestDetail`
  → `PATCH {project}/_apis/git/repositories/{repo}/pullrequests/{pr_id}`

### src-tauri (`pr_review.rs`)
- `UpdatePullRequestInput { pr: PrLocator, action: String, merge_strategy?: String, delete_source_branch?: bool }`
- `PrStatusResult { status: Option<String>, is_draft: bool }`
- `update_pull_request(input)`:
  - action ごとに body を組み立て PATCH。
  - `complete` のみ: 先に `get_pull_request_detail` で `last_merge_source_commit.commit_id` を取得し
    body に含める (古い PR の誤マージ防止)。merge_strategy 必須 (無ければ InvalidInput)。
  - 不正 action は InvalidInput。

### IPC (`lib.rs`)
- `update_pull_request`(write、`ensure_write_enabled`)。

## フロントエンド

- `azdoCommands.ts`: wrapper + Zod + demo (write 系として `writeCommands` に追加)。
- `PrReviewPanel` のヘッダに操作を追加:
  - status により出し分け: active かつ draft → `Publish`; active → `Complete` / `Abandon`;
    abandoned → `Reactivate`。
  - `Complete` は merge strategy 選択 (squash/rebase/rebaseMerge/merge) + delete source branch
    チェック + confirm。
  - read-only mode 時は無効化し理由表示。
  - 成功時に該当 PR review と `myReviews` を invalidate。

## 検証
- `cargo test --workspace` / `cargo clippy ... -D warnings`
- `pnpm tsc --noEmit` / `pnpm test -- --run`(worktree 除外)
