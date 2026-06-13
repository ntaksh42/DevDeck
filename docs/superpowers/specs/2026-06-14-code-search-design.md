# Code Search 設計 (領域 K 第1弾)

- 日付: 2026-06-14
- 領域: K (Search / Query UX)
- スコープ: 既存の PR/WorkItem/Commit メタ検索に無い **コード全文検索** を追加する。

## スコープ

IN:
- Azure DevOps Code Search API (`almsearch` サブドメイン) を使った横断コード検索。
- 結果はファイル単位 (fileName・path・project・repository・branch) + 「Azure DevOps で開く」リンク。
- 任意の project 名フィルタ。
- Code Search 拡張が未導入の org では明確なメッセージ (404 → 案内)。

OUT (将来): 行スニペット表示 (ファイル取得が必要)、ページング、Wiki/Package 検索、
ファセット絞り込み。

## バックエンド

### azdo-client
- `client.rs`: `post_json` を base URL 引数化 (`post_json_to_url`) し、`post_json_almsearch`
  を追加。`almsearch_base_url` で `almsearch.dev.azure.com/{org}` に切り替え。
- `code_search.rs`: `search_code(CodeSearchRequest) -> CodeSearchResponse`
  → `POST {almsearch}/_apis/search/codesearchresults`、body `{ searchText, $top, $skip, filters }`。

### src-tauri (`code_search.rs`)
- `CodeSearchService { db, secrets }`、`search(SearchCodeInput) -> CodeSearchResults`。
- 結果を `CodeSearchHit { fileName, path, projectName, repositoryName, branch, webUrl }` に変換。
  web URL は `{base}/{project}/_git/{repo}?path=...&_a=contents&version=GB{branch}` を組み立て。
- 404 は「Code Search 拡張が未導入」として `InvalidInput` で surface。

### IPC
- `search_code` (read)。

## フロントエンド
- `azdoCommands.ts`: `searchCode` wrapper + Zod + demo。
- 新規 `src/features/code/CodeSearchView.tsx`: 検索ボックス + org/project + 結果リスト
  (ファイル名・path・project/repo・branch、クリックで Azure DevOps を開く)。
- `App.tsx`: `Code` nav (`G d`)、コマンドパレット、header、ルーティング。

## 検証
- `cargo test --workspace` / `cargo clippy ... -D warnings`
- `pnpm tsc --noEmit` / focused `CodeSearchView.test.tsx`
