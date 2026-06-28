# 05 — プロバイダ抽象化と GitHub Mode

DevDeck を Azure DevOps 専用から、複数の開発プラットフォーム（まず Azure
DevOps と GitHub）を扱える汎用ダッシュボードへ拡張するための設計。

## ゴールと非ゴール

- ゴール: GitHub に対しても Azure DevOps と同等（フルパリティ）の閲覧・操作を
  提供する。最終的に PR / Issue(=WorkItem 相当) / Commits / Code 検索 /
  Actions(=Pipelines 相当) / PR レビュー / 横断検索 / バックグラウンド同期を
  GitHub でも動かす。
- 非ゴール（現時点）: GitLab/Bitbucket 等の追加プロバイダ。OAuth デバイスフロー
  （初期は PAT のみ）。GitHub Enterprise Server も将来対応（base_url 差し替えで
  入る余地を残すが初期検証対象は github.com）。

## 中心概念: Connection（接続）

既存の「Organization（組織）」を、プロバイダ非依存の「Connection（接続）」概念へ
一般化する。実装上は **DB テーブル名 `organizations` と Rust 構造体
`Organization` は据え置き**（移行コストを避ける）、`provider_kind` 列を追加して
種別を持たせる。

| フィールド | Azure DevOps | GitHub |
| --- | --- | --- |
| `provider_kind` | `"azdo"` | `"github"` |
| `id` / `name` | org slug（例 `contoso`） | owner（user/org ログイン名） |
| `base_url` | `https://dev.azure.com/{org}` | `https://api.github.com`（GHE は将来） |
| `auth_provider` | `pat` \| `azure_cli` | `github_pat` |
| `credential_key` | `azdodeck:org:{org}:pat` 等 | `azdodeck:github:{owner}:pat` |
| `authenticated_user_*` | connection_data から | `GET /user` から |

「**GitHub Mode**」とは UI 上の独立モードではなく、**選択中の Connection が
GitHub 種別であること**。接続ピッカーが azdo/github 双方の接続を一覧し、選択に
応じて各画面が対応プロバイダのデータを表示する。これにより画面側の分岐を最小化
する。

## アーキテクチャ方針: 正規化 DTO + ディスパッチ

フルパリティをコスト最小で実現する鍵は **フロントエンドの DTO をプロバイダ非依存
に保つ** こと。GitHub サービスは GitHub REST 応答を、既存の AzDO サービスが返すのと
同じシリアライズ形（`PrSummary`, `WorkItemSummary` 等）へマップして返す。結果、
画面・Zod スキーマ・TanStack Query キーは原則変更不要で「GitHub Mode」がほぼ無償。

```
React component
  -> azdoCommands.ts（プロバイダ非依存の DTO / Zod は共通）
  -> Tauri invoke()
  -> #[tauri::command]（src-tauri/src/lib.rs）
  -> provider dispatch（org.provider_kind で分岐）
       ├─ azdo: 既存サービス（prs.rs 等） -> AdoClient -> Azure DevOps REST
       └─ github: 新サービス（github/*.rs） -> GitHubClient -> GitHub REST
```

### ディスパッチの実装

各 `#[tauri::command]` 内で `db.resolve_organization(org_id)` 後に
`organization.provider_kind` で azdo/github のサービスへ振り分ける薄いルータを
置く。重い trait 化は避け、まずは enum/match による分岐とする（必要が出た領域だけ
trait を切る）。サービスメソッドのシグネチャ（入力型・戻り DTO）は azdo/github で
一致させる。

### クレート構成

- `crates/azdo-client/` は現状維持（Tauri 非依存の AzDO REST クライアント）。
- `crates/github-client/` を **新設**（同じく Tauri 非依存の GitHub REST
  クライアント）。`reqwest` ベースで `get_json`/`post_json` のリトライ・401/403・
  429(`Retry-After`)・5xx リトライ方針を azdo-client と揃える。GitHub 固有の
  ページネーション（Link ヘッダ）と Rate Limit ヘッダを扱う。
- `src-tauri/src/github/` に GitHub ドメインサービス（`prs.rs` 等、azdo 側と対称）。

## 認証とシークレット

- `auth_provider` に `github_pat` を追加。`client_for_organization` を
  `provider_kind` も見るディスパッチへ拡張（azdo→AdoClient, github→GitHubClient）。
- keyring サービス名は `AzDoDeck` のまま（保存済み認証情報の互換）。資格情報キーは
  `azdodeck:github:{owner}:pat`。GitHub PAT は `Authorization: Bearer {pat}`
  （fine-grained/classic 双方）または `token {pat}`。
- PAT は SQLite/ログ/テスト/デモに保存しない（既存ルール踏襲）。

## DB スキーマ

`SCHEMA_VERSION` を 17 へ。`migrate()` に `if current < 17` を追加:

```sql
ALTER TABLE organizations ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'azdo';
```

既存行は `azdo` 既定で互換。キャッシュ用テーブル（pull_requests 等）は org 単位で
分離済みのため、GitHub データも同テーブルへ格納する。カラム意味のズレ
（例: project=AzDO は必須、GitHub は repo owner/リポジトリで代替）は GitHub 側で
妥当な値へマップして格納（`project_id`/`project_name` に owner を入れる等）。

## フロントエンド

- 接続追加 UI（SetupPanel/OrganizationSettings）に種別選択（Azure DevOps /
  GitHub）を追加。GitHub は「owner + PAT」を入力。
- 接続ピッカーは provider_kind を示すアイコン/ラベル付きで azdo/github を併記。
- 画面側は DTO 非依存のため大きな変更なし。プロバイダ非依存にできない箇所
  （例: AzDO 固有の vote 概念 vs GitHub の review state）は DTO 段階で共通語彙へ
  マップし、ラベルのみ差し替える。

## デモ（ブラウザ）モード

`azdoCommands.ts` の demo 分岐に GitHub 種別のデモ接続とデモデータを追加し、
`pnpm dev` のブラウザプレビューで GitHub Mode も確認できるようにする。

## フェーズ計画

1. 基盤: `provider_kind` 移行(v17) + auth ディスパッチ + 接続追加(GitHub PAT) +
   `github-client` クレート雛形 + `GET /user` 検証。
2. PR 縦スライス: My Pull Requests / Reviews を GitHub で表示（list→DTO マップ→
   キャッシュ→画面）。**パターン確立の検証点**。
3. 以降パリティ: Issues / Commits / Code 検索 / Actions / PR レビュー(threads,
   diffs) / 横断検索 / 同期 を順次 GitHub 対応。

各フェーズで TypeScript 型チェック・Rust テスト・必要なら Playwright を通す。
GitHub REST の挙動は `crates/github-client/` で `wiremock` テストを置く。

## 実装状況

**実装済み（GitHub 接続で動作）**:

- 接続追加: GitHub PAT（`add_github_organization`、`GET /user` 検証、SetupPanel の
  Azure DevOps / GitHub トグル、デモ分岐）。
- Pull Requests: My Pull Requests（authored）、My Reviews（review-requested）、
  PR 検索（`involves:@me` スコープ、`is:open` 等）。`src-tauri/src/github/prs.rs`。
- Work Items → Issues: My Work Items（assignee:@me）、Issue 検索。
  `src-tauri/src/github/work_items.rs`。
- Commits: コミット検索（`GET /search/commits`、`author:@me` 既定）。
  `src-tauri/src/github/commits.rs`。
- Code 検索: `GET /search/code`（`user:` スコープ）。`src-tauri/src/github/code.rs`。
- 一覧/フィルタ系の互換: Work Items / Pipelines の projects 一覧は GitHub 接続では
  空を返し、画面がエラーにならないようにしている。

すべて service 層で `organization.provider_kind == "github"` を分岐し、GitHub REST 応答を
既存の DTO（`PullRequestSummary` / `WorkItemSummary` / `CommitSummary` 等）へマップする
方式。フロントの画面・Zod スキーマは変更不要。

**未実装（残課題）**:

- Pipelines → GitHub Actions: Actions はリポジトリ単位のため、リポジトリ一覧 →
  workflow → runs という別 UI スコープが必要。現状は projects 空で degrade。
- PR レビュー詳細（threads / diffs / vote / コメント投稿）と Issue/Work Item の詳細・
  編集系コマンド: GitHub のモデル差が大きく、各 `#[tauri::command]` 単位で GitHub REST
  への対応が必要。現状 GitHub 接続でこれらを開くと `AppError`（明示エラー）になる。
- バックグラウンド同期 / デスクトップ通知の GitHub 対応: 現状 GitHub の読み取りは
  すべて on-demand。`sync.rs` への GitHub 取り込みは未対応。
- 横断検索（command palette `search_all`）の GitHub 対応。
- ブラウザデモでの GitHub Mode 表示（デモは Azure DevOps 接続のまま）。

## 互換と移行の注意

- 既存ユーザーの AzDO 接続・保存済み PAT・ローカルキャッシュは無変更で動作継続
  （keyring サービス名と Tauri identifier 据え置き、移行は列追加のみ）。
- 仕様の正典 `docs/spec-overview.md` は各フェーズ着地時に追随更新する。
