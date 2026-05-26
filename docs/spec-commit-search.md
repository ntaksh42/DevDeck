# Commit Search 外部仕様

## 概要

Azure DevOps の複数 Project / Repository を横断して Commit を検索する。  
主な用途は「最近入った変更を人・ブランチ・期間・キーワードから素早く探し、Azure DevOps の Commit 詳細へ移動する」こと。

既存の M5 実装は Commit Search の最小縦断を提供済み。ここでは次に実装する完成形を定義する。

## 対象ユーザー

- 複数 repository をまたいで変更履歴を確認する開発者
- 特定の author / branch / SHA / message から commit を探したいレビュワー
- PR や Work Item ではなく commit 単位で変更を追いたい保守担当者

## ゴール

| ID | 要件 |
|----|------|
| C1 | Organization を選択して Commit を検索できる |
| C2 | Commit message、author、repository、project、SHA をキーワード検索できる |
| C3 | Author を個別条件として指定できる |
| C4 | Branch を個別条件として指定できる |
| C5 | From / To の日付レンジを指定できる |
| C6 | Project と Repository を任意で絞り込める |
| C7 | 結果一覧に SHA、message、project/repository、author、date を表示する |
| C8 | 結果行から Azure DevOps の Commit 詳細を開ける |
| C9 | 結果は新しい commit が上に来る |
| C10 | 0 件、未検索、検索中、エラーの状態を明確に表示する |

## 非ゴール

- Commit diff のアプリ内表示
- Commit graph / branch graph の可視化
- ローカル Git repository との照合
- Azure DevOps Server / on-prem 対応
- Organization 横断の同時検索
- 完全な offline search

## 画面構成

Commits は左ナビゲーションのトップレベルページとして表示する。

```
AzDoDeck
Azure DevOps
─────────────────────────────
▼ Pull Requests
    Search
    My Reviews
  Work Items
  Commits
─────────────────────────────
  Settings
```

Organization が 0 件の場合、Commits は disabled になる。

## 検索フォーム

| 項目 | UI | 仕様 |
|------|----|------|
| Search | テキスト入力 | message / author / repository / project / SHA を対象に部分一致 |
| Organization | select | 検索対象 organization。既定は先頭 organization |
| Author | テキスト入力 | Azure DevOps API の `searchCriteria.author` に渡す。名前またはメールを想定 |
| Branch | テキスト入力 | Azure DevOps API の branch 条件に渡す。`refs/heads/` は入力不要 |
| From | date input | この日付以降の commit |
| To | date input | この日付以前の commit |
| Project | select / combobox | `All projects` または特定 project |
| Repository | select / combobox | `All repositories` または特定 repository。Project 指定時は対象 project 内に絞る |
| Search button | button | 検索実行。検索中は disabled |

### 入力ルール

- Search、Author、Branch は前後空白を trim する。
- 空文字は条件なしとして扱う。
- Branch は `refs/heads/main` が入力された場合も `main` と同等に扱う。
- From が To より後の日付の場合は検索前に validation error を表示する。
- To は日付だけ指定された場合、その日の終端までを含める。
- Project / Repository の候補取得に失敗した場合でも、既存の横断検索は実行できる。

## 結果一覧

一覧はコンパクト表示を優先する。

| カラム / 要素 | 仕様 |
|---------------|------|
| SHA | 8 桁の short SHA。monospace。クリックで Azure DevOps を開く |
| Message | Commit comment。1 行目を主表示、長い場合は truncate |
| Project / Repository | `Project / Repository` 形式 |
| Author | 表示名。メールがあれば補助表示 |
| Date | 相対表示を主表示、hover / title で絶対日時 |
| Open action | `Open in Azure DevOps` ボタン |

### ソート

- 初期表示は Author Date 降順。
- UI 上の明示ソートは次の順で追加する。
  - Date
  - Repository
  - Author
- 同一日時の場合は `repositoryName`、`commitId` の順で安定化する。

### 状態表示

| 状態 | 表示 |
|------|------|
| 未検索 | `Run a search to load commits.` |
| 検索中 | ボタンに spinner、結果領域に `Searching` |
| 0 件 | `No commits matched.` |
| エラー | 既存 `ErrorState` で Tauri command error を表示 |

## Backend API

Tauri command:

```ts
search_commits(input: SearchCommitsInput): Promise<CommitSummary[]>
```

Input:

```ts
type SearchCommitsInput = {
  organizationId?: string;
  query?: string;
  author?: string;
  branch?: string;
  fromDate?: string;
  toDate?: string;
  projectId?: string;
  repositoryId?: string;
};
```

Output:

```ts
type CommitSummary = {
  organizationId: string;
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  commitId: string;
  shortCommitId: string;
  comment: string;
  authorName: string | null;
  authorEmail: string | null;
  authorDate: string | null;
  webUrl: string | null;
};
```

## Azure DevOps API 方針

Repository 単位の commit list API を使う。

```http
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repositoryId}/commits
```

主な query:

| 条件 | API query |
|------|-----------|
| author | `searchCriteria.author` |
| branch | `searchCriteria.itemVersion.versionType=branch`、`searchCriteria.itemVersion.version` |
| from | `searchCriteria.fromDate` |
| to | `searchCriteria.toDate` |
| 件数 | `$top` |

Search の free text は Azure DevOps 側に直接渡さず、取得後に local filter する。対象は message、project、repository、author name、author email、commit id。

## 探索方針

### Project / Repository 未指定

1. Organization の projects を取得
2. 各 project の repositories を取得
3. 各 repository の commits を取得
4. local filter
5. Author Date 降順に sort
6. 最大 100 件に truncate

### Project 指定

- 指定 project の repositories のみ探索する。

### Repository 指定

- 指定 repository のみ探索する。
- Repository は project に属するため、backend input では `projectId` と `repositoryId` の両方が指定されている状態を推奨する。

## 件数と性能

- Repository ごとの `$top` は既定 50。
- 最終結果は最大 100 件。
- 初期実装では逐次探索を許容する。
- 大規模 organization 向けには後続で以下を追加する。
  - Project / repository metadata cache
  - bounded concurrency
  - cancellation
  - progress 表示

## URL 生成

Commit API の `remoteUrl` があれば優先する。ない場合は既知情報から生成する。

```text
{organization.base_url}/{projectName}/_git/{repositoryName}/commit/{commitId}
```

Project / repository 名に URL escape が必要な場合は backend で encode する。

## テスト観点

### Rust / azdo-client

- `list_commits` が author / branch / fromDate / toDate / top を query に含める
- branch の `refs/heads/` 正規化
- date range query の受け渡し

### Rust / Tauri service

- organization 未設定時の error
- organization id 不正時の error
- query が message / author / repository / project / SHA に一致する
- projectId 指定で project traversal が絞られる
- repositoryId 指定で repository traversal が絞られる
- sort と truncate が期待通り
- `remoteUrl` なしの場合に `webUrl` を生成する

### TypeScript / UI

- Commit 検索フォームが `search_commits` に正しい input を渡す
- date range validation
- 結果表示
- Open in Azure DevOps action
- 未検索 / 検索中 / 0 件 / error 状態

### E2E / Browser preview

- Commits タブを開ける
- demo data を検索できる
- date / project / repository 条件が UI 上で操作できる

## 実装優先順位

1. Date range UI と validation を追加する
2. Backend / client の branch 正規化と fallback URL 生成を追加する
3. Project / Repository filter を input と backend に追加する
4. Project / Repository selector の候補取得を追加する
5. 結果一覧をコンパクト化し、SHA click / sort を追加する
6. 大規模 organization 向けの cache / bounded concurrency は M7 以降へ送る

## 未決事項

| ID | 論点 | 推奨 |
|----|------|------|
| U1 | Project / Repository 候補をいつ取得するか | Commits ページ表示時ではなく、Organization 選択後に lazy load |
| U2 | Repository のみ指定を許可するか | UI では Project 選択後に Repository 選択。backend は両方指定を推奨 |
| U3 | Date の既定値 | 既定は空。前回検索条件の保存は後続 |
| U4 | 期間未指定の横断検索上限 | repository ごとに `$top=50`、最終 100 件 |
| U5 | Commit message の複数行表示 | 一覧では 1 行目のみ。詳細表示は後続 |
