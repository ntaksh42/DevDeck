# In-App PR Review Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub の Web PR ビューとのギャップ補填(spec: `docs/spec-pr-review.md` 第 2 弾)。
差分内スレッド表示・インラインコメント作成・Markdown 描画・コミット一覧タブ・side-by-side 切替。

**Architecture:** 既存の PR レビュー基盤(フェーズ 1)を拡張。新規バックエンドはコミット一覧
1 コマンドのみ。残りはフロントエンド(共有 ThreadCard 抽出、diffView の split ビルダー、
MarkdownView コンポーネント)。

**Tech Stack:** 追加 deps: `marked`, `dompurify`(両方 TS 型同梱)。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `crates/azdo-client/src/pr_review.rs` | `list_pull_request_commits` 追加 |
| `src-tauri/src/pr_review.rs` | `PrCommit` 型 + `list_commits` + コマンド |
| `src-tauri/src/lib.rs` | `list_pull_request_commits` 登録 |
| `src/lib/azdoCommands.ts` | `prCommitSchema` + ラッパー |
| `src/lib/azdoDemo.ts` | コミットのデモ fixture |
| `src/lib/markdown.tsx` | 新規: `MarkdownView`(marked + DOMPurify、リンクは openExternalUrl) |
| `src/lib/markdown.test.tsx` | サニタイズと描画のテスト |
| `src/lib/diffView.ts` | `buildSideBySideRows` 追加 |
| `src/lib/diffView.test.ts` | split ビルダーのテスト |
| `src/features/pull-requests/PrThreadCard.tsx` | 新規: 共有スレッドカード(返信状態を内包) |
| `src/features/pull-requests/PrReviewPanel.tsx` | Commits タブ、Markdown 化、ThreadCard 差替 |
| `src/features/pull-requests/PrFilesTab.tsx` | インラインスレッド・行コメント作成・split 切替 |

## Task 1: azdo-client — PR コミット一覧

- [ ] `list_pull_request_commits(project, repo, pr_id) -> Vec<GitCommitRef>`
      (`GET .../pullRequests/{id}/commits`, ListResponse, 既存 `GitCommitRef` を再利用)
- [ ] wiremock テスト(commitId / comment / author.date をアサート)
- [ ] `cargo test --package azdo-client` → コミット

## Task 2: src-tauri — list_pull_request_commits コマンド

- [ ] `ListPullRequestCommitsInput { #[serde(flatten)] pr: PrLocator }`
- [ ] `PrCommit { commit_id, short_commit_id(先頭8), comment(1行目), author_name, author_date }`
- [ ] `PrReviewService::list_commits` → client 呼び出し + マップ
- [ ] lib.rs にコマンド追加・登録、`cargo test --workspace` + clippy → コミット

## Task 3: フロント配線 + デモ

- [ ] azdoCommands.ts: `prCommitSchema`(commitId, shortCommitId, comment, authorName,
      authorDate nullable)+ `listPullRequestCommits` ラッパー
- [ ] azdoDemo.ts: `list_pull_request_commits` fixture(3 件)
- [ ] `pnpm tsc --noEmit` → コミット

## Task 4: MarkdownView

- [ ] `pnpm add marked dompurify`
- [ ] `src/lib/markdown.tsx`:
      `renderMarkdownHtml(text): string` = DOMPurify.sanitize(marked.parse(text, {async:false}))
      + `MarkdownView({ text, className })` コンポーネント。クリックを intercept して
      `<a>` は `openExternalUrl(href)`(preventDefault)。最低限のタイポグラフィは
      コンポーネント内の Tailwind クラス(`[&_p]:my-1` 系の arbitrary variants)で付与。
- [ ] テスト: script タグ除去、リスト/コードの描画、リンク href 保持
- [ ] `pnpm test -- --run src/lib/markdown.test.tsx` → コミット

## Task 5: diffView split ビルダー

- [ ] `SideBySideRow = { left: {line,text,kind:"context"|"del"} | null, right: {line,text,kind:"context"|"add"} | null }`
- [ ] `buildSideBySideRows(base, target)`: diffLines のパートを走査し、del 連続 + add 連続を
      インデックスでペアリング。context は両側同行
- [ ] テスト 3 件(編集・追加のみ・削除のみ)→ コミット

## Task 6: PrThreadCard 抽出

- [ ] `PrThreadCard.tsx`: 返信テキストの state を内部に持つ。
      props: `{ thread, busy, compact?, onReply(content), onToggleStatus() }`
      コメント本文は `MarkdownView` で描画
- [ ] `PrReviewPanel.tsx` の ReviewTab を新カードに差し替え(reply 系 state 削除)、
      説明文も `MarkdownView` に
- [ ] 検証: tsc + vitest + デモ目視 → コミット

## Task 7: Files タブ(インラインスレッド・行コメント・split)

- [ ] props に threads と PR を既に持つ → 選択ファイルのスレッドを
      `rightLine` でグルーピング(`filePath === file.path`)
- [ ] unified: `targetLine` が一致する行の直下に `PrThreadCard`(compact)
- [ ] 行 hover で「+」ボタン(targetLine がある行のみ)→ コメント入力ボックス →
      `postPullRequestComment({filePath, rightLine, content})`
- [ ] mutations(post/status)は PrFilesTab 内で useMutation、
      成功時 `invalidateQueries(["prReview"])`
- [ ] unified/split トグル(useState、ボタンはファイルリスト上部)。split は
      `buildSideBySideRows` で 2 カラム描画、スレッド/コメントボックスは right 行の下に全幅表示
- [ ] 検証: tsc + vitest + デモ目視 → コミット

## Task 8: Commits タブ

- [ ] PrReviewPanel に Commits タブ追加(Review | Files | Commits | Result)
- [ ] `useQuery(["prCommits", ...])`、一覧: short sha(クリックで
      `pr.webUrl.replace(/\/pullrequest\/\d+$/, "/commit/"+sha)` を openExternalUrl)、
      メッセージ 1 行目、author、相対日時
- [ ] 検証 → コミット

## Task 9: 全体検証

- [ ] `pnpm tsc --noEmit` / `pnpm test -- --run` / `cargo test --workspace` /
      clippy / fmt / `pnpm test:e2e`(壊れたら新 UI に合わせ更新)
- [ ] デモモードでスクリーンショット確認(インラインコメント作成、split 表示、
      Commits タブ、Markdown 描画)
