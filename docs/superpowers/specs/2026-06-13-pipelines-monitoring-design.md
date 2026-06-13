# Pipelines 監視ビュー 設計 (領域 A 第1弾)

- 日付: 2026-06-13
- 領域: A (Pipelines / Builds)
- スコープ: standalone な「Pipelines 監視ビュー」の第1弾。Build API ベースの
  read 監視 + re-run / cancel まで。
- 関連: `docs/spec-ideas-market-research.md` (PL-01〜PL-07)、
  `docs/product-improvement-ideas.md`

## 1. 目的とスコープ

### 目的

Azure DevOps 本家にあって本アプリに完全に欠けている **Pipelines (CI/CD)** の
うち、まず「自分が見るべき build 実行を、project/repo 単位で監視し、失敗の原因を
即把握し、必要なら再実行・キャンセルできる」状態を作る。

### このビューの位置づけ

- 既存 `My Reviews` のような常時 background sync の inbox ではなく、既存
  `Commits` 検索ビューに近い「**org + project を選んで直近 build 実行を引く**」
  browse 型。
- build の状態 (queued → running → completed) は揮発的なので、SQLite に sync
  せず **on-demand でライブ取得**する (後述「データ取得アーキテクチャ」)。

### スコープ (IN)

- project スコープでの build 実行一覧 (フィルタ: pipeline / branch / result /
  status / mine only / failed only)
- 実行詳細: Timeline (stage → job) と、失敗 job のログ末尾 (既定 200 行)
- 失敗 build の re-run (同 definition・同 source branch で新規 queue)
- 実行中 build の cancel
- in-progress run がある間の自動リフレッシュ (15 秒間隔)

### スコープ外 (OUT / YAGNI)

明示的に今回はやらない。各々が別 spec 級:

- Releases / Environments / デプロイ承認 (classic Release pipelines)
- 任意パラメータ指定の手動 queue (再実行は同 definition・同 branch のみ)
- 失敗ステージのみの retry (multi-stage retry API)
- background sync / SQLite キャッシュ / コマンドパレット連携
- build 失敗の desktop 通知 (領域 J で扱う)
- PR 行への build / policy status 表示 (領域 F 付近の後続: PL-01)

## 2. データ取得アーキテクチャ

**採用: on-demand ライブ取得・SQLite キャッシュなし。**

`list_pipeline_runs` は呼び出しごとに Build API を叩いて結果を返す。詳細
(timeline / log) も選択時にライブ取得する。

理由:

- build 状態は数秒〜数分で変わるため、sync 間の陳腐化が監視用途に致命的。
- 「project/repo を選んで見る」決定と、全 project 横断 pre-sync は相性が悪い。
- schema migration (user_version) も background sync 負荷も不要。

トレードオフ (許容する):

- オフライン不可。ビューを開くたびに API を呼ぶ。
- build 失敗の desktop 通知はこの spec では作れない → 領域 J で軽い仕組みを足す。

将来 J で通知を入れる際は「pipeline ごとの最後に観測した result」だけを軽く
永続化する hybrid を別途検討する (この spec では持たない)。

## 3. バックエンド設計

### 3.1 `crates/azdo-client/src/pipelines.rs` (新規・Tauri 非依存)

Build API (YAML / classic 両対応) をラップする。HTTP は既存
`AdoClient::get_json / post_json / patch_json` を経由し、retry / 401 / 429 の
扱いを共通化する。api-version は既存呼び出しに合わせる (`7.1`)。

メソッド:

| メソッド | HTTP | 用途 |
| --- | --- | --- |
| `list_builds(project_id, criteria)` | `GET {project}/_apis/build/builds` | 実行一覧。query: `definitions, statusFilter, resultFilter, branchName, requestedFor, reasonFilter, minTime, maxTime, queryOrder=queueTimeDescending, $top` |
| `list_build_definitions(project_id, name_filter)` | `GET {project}/_apis/build/definitions` | pipeline フィルタ用候補。`name=*filter*`, `$top` |
| `get_build(project_id, build_id)` | `GET {project}/_apis/build/builds/{id}` | 単一 run |
| `get_build_timeline(project_id, build_id)` | `GET {project}/_apis/build/builds/{id}/Timeline` | stage/job/task の result・state・時刻・`log.id`・error/warning 件数 |
| `get_build_log_lines(project_id, build_id, log_id, max_lines)` | `GET {project}/_apis/build/builds/{id}/logs/{logId}` | ログ取得。Rust 側で末尾 `max_lines` 行に切る |
| `queue_build(project_id, {definition_id, source_branch})` | `POST {project}/_apis/build/builds` | 再実行。body `{ definition: { id }, sourceBranch }` |
| `cancel_build(project_id, build_id)` | `PATCH {project}/_apis/build/builds/{id}` | body `{ status: "cancelling" }` |

返却する struct (azdo-client 側、REST 命名に忠実):

- `Build`: `id, build_number, status, result, source_branch, reason,
  requested_for (display_name), definition (id, name), queue_time,
  start_time, finish_time`
- `BuildDefinitionRef`: `id, name`
- `Timeline`: `records: Vec<TimelineRecord>`
- `TimelineRecord`: `id, parent_id, record_type (Stage/Phase/Job/Task), name,
  state, result, start_time, finish_time, log_id (Option), error_count,
  warning_count, order`

> 注: `build.url` は API エンドポイントであり browser URL ではない。web URL は
> `{org.base_url}/{project}/_build/results?buildId={id}` を Rust 側で組み立てる
> (commits の `commit_web_url` と同じ方針)。

### 3.2 `src-tauri/src/pipelines.rs` (新規)

```rust
PipelineService {
    db: AppDatabase,     // org 解決のみ
    secrets: SecretStore,
}
```

- project ピッカーは既存 `src-tauri/src/projects.rs` を再利用する (新規に
  project 一覧 API を増やさない)。
- メソッドは IPC と 1:1。`AdoClient` を `client_for_organization` で得て呼ぶ。
- frontend へ返す型 (`#[serde(rename_all = "camelCase")]`):
  - `PipelineRunSummary`: `organizationId, projectId, projectName, buildId,
    buildNumber, definitionId, definitionName, status, result, sourceBranch,
    reason, requestedFor, queueTime, startTime, finishTime, webUrl`
  - `PipelineRunDetail`: `run: PipelineRunSummary` + `timeline: Vec<TimelineNode>`
  - `TimelineNode`: `id, parentId, type, name, state, result, startTime,
    finishTime, logId, errorCount, warningCount` (フラットで返し、ツリー化は
    frontend)
  - `PipelineDefinitionOption`: `id, name`
  - `PipelineLogTail`: `lines: Vec<String>, truncated: bool`

### 3.3 IPC コマンド (`src-tauri/src/lib.rs` + `generate_handler!`)

| コマンド | 入力 (camelCase) | write? |
| --- | --- | --- |
| `list_pipeline_runs` | `organizationId?, projectId, definitionId?, branch?, result?, status?, requestedForMe?, top?` | no |
| `list_pipeline_definitions` | `organizationId?, projectId, nameFilter?` | no |
| `get_pipeline_run` | `organizationId?, projectId, buildId` | no |
| `get_pipeline_run_log_tail` | `organizationId?, projectId, buildId, logId, maxLines?` | no |
| `rerun_pipeline_run` | `organizationId?, projectId, definitionId, sourceBranch` | **yes** |
| `cancel_pipeline_run` | `organizationId?, projectId, buildId` | **yes** |

- `rerun_pipeline_run` / `cancel_pipeline_run` は他の write コマンドと同様
  `ensure_write_enabled(&state)?` を先頭で呼ぶ (read-only validation mode 連携)。
- `requestedForMe` が true の場合、`organization.authenticated_user_id` を
  `requestedFor` フィルタに使う。

### 3.4 `requestedForMe` / "mine only" の解決

`Organization.authenticated_user_id` を既に保持しているのでそれを使う。Build API
の `requestedFor` は identity id を受け付ける。id 不明の org では mine only を
無効 (disabled) 表示にする。

## 4. フロントエンド設計

### 4.1 `src/lib/azdoCommands.ts`

各コマンドの wrapper + Zod schema + `isTauriRuntime()` 偽の場合の demo 分岐
(`demoInvoke`)。demo は固定の build 実行サンプル数件 + timeline + ログ末尾を返す
(成功 / 失敗 / 実行中 を1件ずつ)。re-run / cancel demo は no-op 成功。

### 4.2 `src/features/pipelines/PipelinesView.tsx` (新規)

既存 `CommitSearch` / `MyReviewsGrid` のレイアウトと keyboard 規約を踏襲。

- 上部: org セレクタ + project セレクタ + フィルタ (pipeline 検索 / branch /
  result / status / mine only / failed only) + 手動リフレッシュ。
- 左: 仮想化 run グリッド (既存 windowing パターンを流用)。
- 右: 詳細 pane。

列: status/result バッジ・pipeline 名・build 番号・branch (短縮)・reason
(CI/PR/manual/scheduled)・requestedFor・queued (相対時刻)・duration。
既定 sort は queue time 降順 (API 側 `queryOrder`)。

詳細 pane:

1. ヘッダ: pipeline 名・build 番号・状態・branch・reason・requestedFor・
   queued/started/finished・duration・`Open in Azure DevOps`。
2. Timeline ツリー: stage → job を折りたたみ表示。各ノードに result アイコン・
   duration・error/warning 件数。
3. 失敗 (または任意) job を選択 → `get_pipeline_run_log_tail` で**末尾 200 行**を
   on-demand 取得し monospace 表示。「フルログを Azure DevOps で開く」リンク。
4. アクション: `Re-run` / `Cancel`。confirm ダイアログ必須。read-only validation
   mode 有効時は無効化し理由を表示。

### 4.3 TanStack Query キーと mutation

- `["pipelineRuns", orgId, projectId, filters]`
- `["pipelineDefinitions", orgId, projectId, nameFilter]`
- `["pipelineRun", orgId, projectId, buildId]`
- `["pipelineRunLog", orgId, projectId, buildId, logId]`
- re-run / cancel は `useMutation`。成功時に `["pipelineRuns", …]` と該当
  `["pipelineRun", …]` を invalidate。

### 4.4 自動リフレッシュ

表示中 run 一覧、または開いている詳細 run に `status` が in-progress
(`inProgress` / `notStarted` / `postponed` / `cancelling`) のものがあれば、
該当クエリの `refetchInterval` を 15 秒に設定。すべて completed になったら停止
(`refetchInterval: false`)。手動リフレッシュ + 既存 `Ctrl+R` も流用。

### 4.5 ナビゲーション統合 (`src/App.tsx`)

- `View` 型に `"pipelines"` を追加。
- nav に `Pipelines` 項目を追加 (Commits の隣、`GitBranch` 系アイコン)。
- 二段キー goto に `b` を割当 (`G` → `b`)。`GOTO_VIEW_KEYS` に追加。
- コマンドパレットに `Go to Pipelines` nav アクション追加。
- ヘッダのタイトル/説明文の分岐に `pipelines` を追加。
- `currentViewSyncScope()`: pipelines はライブ取得で sync 対象外。`Ctrl+R` での
  「現ビュー更新」は sync ではなく run クエリの refetch にマップする (分岐追加)。

## 5. re-run の意味 (曖昧さ排除)

「Re-run」は、選択した run と**同じ pipeline definition・同じ source branch で
新しい build を queue する**こと。失敗ステージのみの retry や任意パラメータ指定は
行わない。confirm ダイアログに明記する:

> 「<pipeline 名> を <branch> で新規実行しますか?」

## 6. エラー処理

- `AppError` を流用。401 → 再認証メッセージ。403 → 「この project に Build (read)
  権限がない」を project 単位で表示。429 は client の retry に委ねる。
- 古い build で timeline / log が retention 切れの場合は「logs unavailable」表示。
- PAT は **Build (Read & execute)** スコープが必要。re-run / cancel は execute 権限
  が要る。403 を分かりやすく surface する。

## 7. テスト

- `crates/azdo-client`: wiremock で
  - `list_builds` がフィルタを query param に正しく載せる
  - `get_build_timeline` の parse (stage/job/log_id/error_count)
  - `get_build_log_lines` の末尾切り出し
  - `queue_build` の body 形 / `cancel_build` の PATCH body
  - 401 / 403 / 429 の挙動
- TypeScript: Zod schema パース、demo data、`PipelinesView` の focused test
  (run 一覧描画、フィルタ反映、read-only 下で re-run/cancel が無効化されること)
- `src-tauri/src/pipelines.rs`: 入力正規化 / `requestedForMe` 解決の unit test

## 8. 検証チェックリスト (実装時)

- `pnpm tsc --noEmit`
- `pnpm test -- --run`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- browser demo モードで Pipelines ビューが空にならないこと

## 9. 確定事項

- ログ末尾の既定行数 = 200、自動リフレッシュ = 15 秒 (ユーザー承認済み)。
- nav の goto キー = `b` (`G` → `b`)。
- データ取得 = on-demand ライブ取得・キャッシュなし (案1)。
