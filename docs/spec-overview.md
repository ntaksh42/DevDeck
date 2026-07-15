# 仕様書: DevDeck 全体仕様 (現状版)

作成日: 2026-06-20 / ステータス: 現状コードの実装に基づく確定仕様

---

## 1. 製品概要

DevDeck は Azure DevOps 用の **Windows デスクトップダッシュボード**である。
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
My Items (割当件数)、ピン留めした Work Item View (最後に取得した件数)、
Notifications (未読通知件数、99 超は「99+」)。0/未取得時は非表示。

最上位ナビ項目 (Pull Requests / Work Items / Commits / Pipelines / Code) はドラッグ&ドロップ
またはキーボード (`Alt+↑` / `Alt+↓`) で並べ替えできる。順序は localStorage
(`azdodeck:layout:navOrder`) に永続化される。Help / Settings は下部固定で対象外。

| ビュー | 用途 |
|---|---|
| **My Reviews** | 自分がレビュアーの PR。投票状態・マージコンフリクト/CI バッジ・stale 強調・ローカルの done/archive トリアージ・ローカルのレビュー結果プレビュー。自分のレビュー後に author の push で投票がリセットされた PR を「Returned」バッジで強調（投票スナップショットの差分でローカル検出、開く/再投票で解除）。ソート可能な「Review age」列 (作成からの経過日数、stale 閾値超過で強調)。テキストフィルタは読み込み済みデータの値 (リポジトリ/作者) をキーボード操作可能なオートコンプリートで候補表示 (`FilterAutocomplete`)。プレビューヘッダーにコメントスレッド数と未解決数を表示 (人間コメントを含むスレッドのみ集計しシステムスレッドは除外、未解決があれば強調、0件は非表示)。 |
| **My Reviews** | 自分がレビュアーの PR。投票状態・マージコンフリクト/CI バッジ・stale 強調・ローカルの done/archive トリアージ・ローカルのレビュー結果プレビュー。自分のレビュー後に author の push で投票がリセットされた PR を「Returned」バッジで強調（投票スナップショットの差分でローカル検出、開く/再投票で解除）。ソート可能な「Review age」列 (作成からの経過日数、stale 閾値超過で強調)。差分レビューではファイルを「閲覧済み (viewed)」にマーク可能 (`azdodeck:prViewed`、ローカル、iteration 変更でリセット)。`v` で選択ファイルをトグル、ヘッダの Mark all / Clear all で一括。PR の Files タブは Azure DevOps 準拠のツリー表示: サブフォルダを1つだけ持ちファイルを直接持たないフォルダは `src/features/pull-requests` のように連結して1行表示し (折りたたみキーは連結後のフルパス)、変更種別は文字バッジではなく色付き記号 (add/undelete=緑`+`、delete=赤`−`、rename=紫`→`、edit=無印) で示す。折りたたんだフォルダ行には配下ファイルの未解決コメント数を合計したバッジを表示 (展開中は非表示)。ファイル一覧上部にパス部分一致 (大文字小文字無視) のフィルタ入力があり、Escape でクリアしてファイル一覧へフォーカスを戻す (ヒットしたファイルの祖先フォルダは表示を維持)。右ペインは選択中の1ファイルだけでなく、フィルタ適用後の全ファイルの diff をツリー順に連続スクロール表示する (各ファイルは IntersectionObserver で近づいたら遅延ロード)。「Whole file」表示のときのみ選択中の1ファイルだけを表示する。ツリー選択・`j`/`k` はスクロール同期し、逆に右ペインをスクロールすると最上部に近いファイルが選択状態に反映される。`n`/`p` は未解決コメントへ、`]`/`[` は次/前の変更ブロック (hunk) の先頭行へジャンプする (ファイル境界をまたいで移動)。コメントスレッドカード (`PrThreadCard`、Review タブと Files タブで共用) は Azure DevOps 準拠の見た目: コメントごとに著者名から生成したイニシャル円アバター、カード右上に Active/Resolved のステータスドロップダウン (バックエンドが対応する2状態のみ)、カード左上に折りたたみトグル (折りたたみ時は先頭コメントの著者+1行サマリのみ表示)、カード下部に常時表示の「Write a reply…」欄+Resolve/Reactivate ボタン (クリックで返信コンポーザーに展開、Escape で畳んでプレビューへフォーカスを返す)。Files タブの split 表示では、スレッド/下書きはアンカーする側 (right=新ファイル列/left=旧ファイル列) の列の下にだけ表示し、反対側の同じ高さは斜めハッチのプレースホルダーで埋めて左右の行位置を揃える (unified 表示は従来どおり全幅)。 |
| **My Pull Requests** | 自分が作成した active PR を一覧 (`list_my_created_pull_requests`、`searchCriteria.creatorId` でサーバ側フィルタ、全プロジェクトを並列取得しライブ取得・非キャッシュ)。グリッドは My Reviews と同じ CSS グリッド構成・行スタイル・ステータスバーで、列 (PR# / Repository / Title〔Draft バッジ込み〕/ Created / Target / Approvals〔vote==10 の人数/レビュアー総数〕) はヘッダクリックでソート可能、ドラッグで列幅リサイズ (localStorage 永続化)、Columns メニューで表示列を切替 (PR#/Title は必須)。テキストフィルタは読み込み済みデータの値 (リポジトリ/タイトル/ターゲット) をオートコンプリート候補表示するクライアント側絞り込み (`FilterAutocomplete`)。キーボード操作 (`↑↓`/`J K`/`Home`/`End`、`Enter` でブラウザ、`C` で URL コピー)。複数組織は組織セレクタで切替。ライブ取得のため Sync (キャッシュ同期) の対象外で、データはビュー再訪時に再取得される。 |
| **Pull Request Search** | プロジェクト/リポジトリ/ステータス (active/completed/abandoned、いずれも複数選択可。空=既定 active)/ターゲットブランチ/期間 (作成日 or 完了日基準)/ドラフト除外で PR を検索。並び替え (作成日・完了日・タイトル)。active はキャッシュ、それ以外はライブ取得 (ターゲットブランチ・期間はサーバ側フィルタ)。ターゲットブランチ欄は選択中のリポジトリの実ブランチ (`list_repo_branches`) を複数選択候補として表示 (`MultiSelectFilter`、候補検索とキーボード操作に対応)。複数選択時は選択ブランチごとの結果を統合する。結果は先頭 100 件で打ち切り、超過時はインジケータ表示。ソート可能グリッド、列リサイズ、`C` で URL コピー。 |
| **My Work Items** | 自分に割当中の作業項目 (最大 200 件キャッシュ)。状態・種別・割当先・タグ (`System.Tags`、各タグをチップ表示)・更新日時。最後に開いてから変更された項目に未読マーカー (ChangedDate の差分でローカル検出、開くと消える)。 |
| **Work Item Views** | 保存済み WIQL クエリ。件数表示、ナビへのピン留め、並べ替え、ビュー別ソート/列。テキストフィルタ (`Ctrl+F`/`/` でフォーカス、`parseSearchQuery`/`matchesWorkItemQuery` によるスマート検索、list/board 両レイアウトに適用)。 |
| **Work Item Search** | キーワード + プロジェクト/状態/種別での作業項目検索。全文検索 (FTS)。グリッドは Tags 列 (`System.Tags` をチップ表示、Columns メニューで表示切替・ソート可) を含む。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。実行の成果物 (artifacts) を一覧表示しブラウザでダウンロード (`list_pipeline_artifacts`)。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。検索ボックスの `path:src/auth` 構文で変更パス絞り込み（`searchCriteria.itemPath` を使うサーバ側適用のためリポジトリ選択が必須）。 |
| **Release Notes** | プロジェクト + 期間からマージ済み (completed) PR を集約し、リポジトリ別にグルーピングした Markdown リリースノートを生成 (`generate_release_notes`、オンデマンド・非キャッシュ)。クリップボードコピー対応。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。ブランチ + 任意のランタイムパラメータを指定して新規実行をキュー投入 (`queue_pipeline_run`)。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。自分に割り当てられた保留中の承認 (manual approval) をアプリ内で承認/却下 (`list_pipeline_approvals` / `update_pipeline_approval`)。 |
| **Commits** | キーワード/プロジェクト/リポジトリ/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。結果が表示上限(100件)を超えた場合は `truncated`/`total` を返し「Showing N of M commits」と母数を明示。 |
| **Work Item Search** | キーワード + プロジェクト/状態/種別 (いずれも複数選択可) での作業項目検索。全文検索 (FTS)。 |
| **Commits** | キーワード/プロジェクト/リポジトリ (複数選択可)/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。結果が表示上限(100件)を超えた場合は `truncated`/`total` を返し「Showing N of M commits」と母数を明示。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。 |
| **Settings** | 組織設定 (PAT / Azure CLI)、通知設定、フォルダパス、グローバルホットキー、キーバインド上書き、行の条件付き色ルール (Work Item グリッドの行を条件で着色、先勝ち、localStorage 永続化)。Software update パネル (opt-in: 手動で更新確認→適用、失敗時は安全にスキップ。`tauri-plugin-updater`、ブラウザでは無効)。 |
| **Code (Files)** | リポジトリ + ブランチを選び、左のファイルツリーで階層を辿って閲覧する Azure DevOps Repos > Files 準拠ビュー。フォルダ選択時は中身を表 (Name / Last change / Last commit、`latestProcessedChange=true` で各行の最新コミットを 1 リクエストで取得) で表示し、README.md があれば下に Markdown 描画。ファイル選択時は行番号付き + highlight.js による構文ハイライトで内容表示。画像 (png/jpg/gif/webp/svg/bmp/ico/avif、2MB まで) は base64 data URL でインライン描画、512KB 超のテキストは先頭 512KB を truncated バナー付きで表示、その他のバイナリは非表示。Contents / History / Compare タブを切替: History は選択パスのコミット履歴 (`list_repo_history`、`searchCriteria.itemPath`) で、ファイルでは各行の「View」からそのコミット時点の内容を Contents に固定表示 (バナー + Back to branch で解除、`get_repo_file` の `versionType`/`version`)。Compare はベースブランチまたは入力したコミット SHA / タグ (7-40 桁 hex はコミット、それ以外はタグ扱い) と現ブランチとの差分を共有 diff (`buildDiffLines` + `DiffLineText`) で表示。ファイルには「Find in file」(Ctrl+F はビュー内のどこからでも起動、マッチ件数 + 前後ナビ) と「Blame」(公開 REST に行単位 blame API が無いため AzDO Web の blame ビューへリンク) を提供。左の検索ボックスは入力で全階層を対象にファイル名フィルタ (`list_repo_paths` の再帰一覧をブランチ単位でキャッシュし、未展開フォルダ配下もヒット。表示は 500 件まで + 件数明示、サーバ側 20,000 件で truncated)、Enter でリポジトリ内全文検索 (`search_code`) を実行し結果から該当ファイルを開く (ヒット展開のコンテキストプレビューは `get_code_search_context`)。ツリーは1階層ずつ遅延取得 (`list_repo_tree`、`recursionLevel=OneLevel`)、矢印キーで移動/展開/折りたたみ、`Home`/`End` で先頭/末尾へ。フォルダ表と History 表も `↑↓` / `J K` で行フォーカス移動、`Home`/`End` でジャンプ、Enter/Space で開く。フォルダ表は 300 行超で共有 `useGridVirtualizer` により仮想化。パンくずはクリック可能で、リポジトリ名でルートへ、中間セグメントでそのフォルダへ移動。リポジトリはお気に入り (★) を localStorage に保存して先頭に並べ、前回開いたリポジトリ/ブランチ/パス (選択中のファイルまたはフォルダ。祖先フォルダを展開して復元) を復元する (`codeBrowseStorage`)。IPC: `list_repo_branches` / `list_repo_tree` / `list_repo_paths` / `get_repo_file` / `list_repo_history` / `search_code` / `get_code_search_context`。 |
| **Commits** | キーワード/プロジェクト/リポジトリ (複数選択可)/作者/ブランチ/期間でコミット検索。7d/30d/90d プリセット。関連 PR の遅延ルックアップ。変更ファイル一覧 (`CommitFilesPanel`) はファイルごとの追加/削除行数とコミット全体の +/− 合計を表示 (各ファイルの diff を `getCommitFileDiff` で先読みし `summarizeDiff` で集計)。マージコミット (親が複数) は黄色いバナーに `<select>` で親を切替でき、選んだ親が変更ファイル一覧 (Azure DevOps は Diffs API、GitHub は既定親のまま) とファイル diff の両方の差分基点になる。変更ファイル一覧は `↑↓` / `J K` でファイル移動 (押すたびにそのファイルの diff を表示)、開いた diff 内は `N` / `P` で次/前のハンクまたは折りたたまれた行の Expand ボタンへスクロールし、`X` でその位置が Expand ボタンなら展開 (フォーカスはファイル行に残るため `Esc` / `←` でグリッドへ戻れる)。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。パイプラインを Watch (購読、localStorage、最大 100) すると実行履歴を常時追跡し、最新実行の開始/終了をデスクトップ通知 (`desktop_notifications_enabled` に従う)。Watched pipelines ボードは実行中 (最新実行が active) のパイプライン数をヘッダーに「N running」ピル (パルスドット) で示し、該当行を青の左アクセント + パルスドットで強調して、いま実行中のパイプラインが一目で分かる。実行中の購読は表示順のみ一覧の先頭に固定表示 (安定ソート。実行中同士・非実行中同士は元の購読順を維持し、localStorage の購読順自体は変更しない)。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。Queue run のブランチ欄は、選択中のパイプライン定義 (`get_pipeline_definition` が返す `repository`) が Azure Repos (TfsGit) を参照していればそのブランチ一覧 (`list_repo_branches`) をキーボード操作対応の候補選択欄 (`FilterableSelect`、既定値はリポジトリの既定ブランチ) で提示し、候補にない値の自由入力も許可する。リポジトリ情報が無い/TfsGit 以外/ブランチ取得失敗の場合は従来どおりの自由入力欄にフォールバックする。選択・入力したブランチ名は `refs/heads/` 形式に正規化してから `queue_pipeline_run` に渡す。Queue run のパラメータ欄は、選択中の定義が上書き可能な変数 (`allowOverride === true`) を持つ場合、変数ごとのラベル付き入力欄 (シークレット変数は空欄始まりのパスワード入力) を表示し、既定値から変更した変数のみを `parameters` として送信する。上書き可能な変数が無い/定義詳細が未取得の場合は従来どおり `name=value` 改行区切りの自由入力欄のみを表示する (両方表示時は「追加パラメータ」欄として残り、変数入力欄と同名キーがあれば変数入力欄側が優先される)。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。定義の非シークレット変数の追加/変更/削除と CI トリガー (継続的インテグレーション) の有効化/無効化・ブランチ/パスフィルタ編集を `update_pipeline_definition` で行える (書き込みガード対象)。実装は定義の生 JSON を取得→変更→PUT で送信し、`isSecret: true` の変数は常に温存され、入力に同名エントリがあれば拒否される。CI トリガーを有効化する際はブランチフィルタが 1 件以上必要、無効化するとトリガーエントリを削除する。他のトリガー種別 (schedule / pullRequest 等) は変更されない。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。定義パネル (`PipelineDefinitionPanel`) の Edit ボタンから編集フォーム (`PipelineDefinitionEditForm`) を開き、非シークレット変数を行単位で追加/変更/削除 (name / value / allowOverride チェックボックス) できる。シークレット変数は "(secret)" 表示の読み取り専用行として並び、編集・削除操作を提供しない。CI トリガーは有効/無効チェックボックスと branch/path filters (1 行 1 件のテキストエリア) を編集でき、セクションを触っていなければ保存時に `ciTrigger: null` を送りトリガーを変更しない。Save は `update_pipeline_definition` を呼び、成功時は返却された定義でクエリキャッシュを更新して閲覧モードに戻り、失敗時はパネル内にエラーを表示したまま編集状態を維持する。編集モードは Edit ボタンから開始 (最初の入力にフォーカス)、Escape または Cancel/Save で終了しフォーカスを Edit ボタンへ戻す、キー操作はフォーム内に閉じ込めて背後のビューに伝播しない。 |
| **Settings** | 組織設定 (PAT / Azure CLI)、通知設定、フォルダパス、グローバルホットキー、キーバインド上書き。Software update パネル (opt-in: 手動で更新確認→適用、失敗時は安全にスキップ。`tauri-plugin-updater`、ブラウザでは無効)。 |
| **Notifications** | 通知履歴 (`notifications` テーブル) 専用ビュー。サイドバー最上位に固定表示 (ドラッグ並べ替え対象外)、未読件数バッジ付き。フィルタ: Unread only トグル、種別の複数選択 (`MultiSelectFilter`)、組織が2件以上のときのみ表示される単一選択の組織セレクト。一覧は `list_notifications` (`limit=100`、`beforeId` カーソルで「Load more」) を `useInfiniteQuery` で取得し、共有 `useGridVirtualizer` で仮想化。行は未読ドット・タイトル・相対時刻・種別ラベル+詳細+本文冒頭、webUrl があれば行内に外部ブラウザで開くボタン。キーボード: `↑↓`/`J K`/`Home`/`End`/`PageUp`/`PageDown` で行移動、`Enter` でジャンプ (種別ごとに PR Search / Work Item Search / Pipelines / Settings のいずれかへ遷移、または `webUrl` を外部ブラウザで開く。対象を特定できない場合は何もしない) と同時に既読化、`Ctrl+Enter` は `webUrl` を外部ブラウザで開いて既読化、`R` で選択行を既読化 (バックエンドに未読へ戻す手段が無いため、未読の行を既読にするだけの片方向操作)。ヘッダーの「Mark all read」で全既読。既読操作は `mark_notifications_read` / `mark_all_notifications_read` を呼び関連クエリを invalidate。`notifications:inbox-updated` イベント (App 直下で購読) を受けて一覧・未読バッジの両方を invalidate するため、ビューを開いていなくてもバッジは最新化される。パイプライン監視の開始/終了通知 (`usePipelineWatchNotifications`) とパイプライン手動実行のキュー投入 (App の `runQuickPipeline`) は、デスクトップ通知トーストと同じタイミングで `record_notification` を呼び、同じ履歴に記録する (kind: `pipelineWatchStarted` / `pipelineWatchFinished` / `pipelineRunQueued`)。`G` チェーンは `N`。 |

### 横断機能

- **コマンドパレット (`Ctrl+K`)**: コマンド実行 + 作業項目/アクティブ PR/コミットの横断検索。
  接頭辞 `wi:` / `pr:` / `c:` で種別を限定。`Enter` でアプリ内、`Ctrl+Enter` でブラウザ。
  `pr:` 検索時は各 PR に「Approve / Reject」アクション行を追加し、パレットから直接レビュー投票
  (`submit_pull_request_vote`) できる。
- **コマンドパレット (`Ctrl+K`)**: コマンド実行 + 作業項目/アクティブ PR/コミット/コードの横断検索。
  接頭辞 `wi:` / `pr:` / `c:` で種別を限定。`code:`(または `co:`)は既定組織のコード検索を実行し、
  ファイルヒットを `Enter` でブラウザに開く(コード検索は重いため明示接頭辞時のみ実行)。
  通常の `Enter` でアプリ内、`Ctrl+Enter` でブラウザ。
- **スヌーズ**: PR / 作業項目の通知を一定期間繰り延べ。新たなアクティビティまたは期限で復帰。
  ただし PR のコメント活動による早期復帰は `pr_comment_seen` カーソルに依存し、同カーソルは
  コメント返信通知の処理時（`notify_pr_comment_replies` が有効。`desktop_notifications_enabled`
  には依存しない）のみ進むため、同トグルがオフの間はコメント活動では早期復帰せず期限で復帰する。
- **作業項目の新規作成**: My Work Items の「New item」ボタン、テンプレート適用
  (`WorkItemTemplatesPanel`)、またはプレビューの Duplicate (`D` キー / ヘッダーボタン) から
  作成ダイアログを開き、プロジェクト・種別 (`list_work_item_types`)・タイトル・説明・
  担当者・優先度・エリア/イテレーション (`list_classification_nodes`)・タグを指定して
  `create_work_item` で作成する。作成後はローカルキャッシュへ即時反映し関連クエリを
  invalidate する。ダイアログはキーボード完結 (タイトルへ初期フォーカス、Ctrl+Enter 送信、
  Escape キャンセル、閉じたら呼び出し元へフォーカス復帰)。
- **作業項目の一括操作**: 複数項目の状態変更・割当・優先度設定をまとめて適用。
- **作業項目編集**: state / assignee / priority / フィールドをステージし 1 リクエストで適用。
  タイトルはプレビューヘッダーからインライン編集し即時適用 (System.Title を `update_fields` で更新)。
  @メンション付きコメント、フィールドプリセット。投稿済みコメントはプレビューから
  インライン編集・削除が可能 (`update_work_item_comment` / `delete_work_item_comment`)。
  インライン編集欄でも新規投稿と同じ @メンション候補 (オートコンプリート) を表示する。
  プレビューの Links から work item リンク (Parent/Child/Related/Predecessor/Successor) を
  ID 指定で追加・削除できる (`add_work_item_link` / `remove_work_item_link`)。
- **PR 完了オプション**: complete 時にマージ戦略・ソースブランチ削除に加え、関連 work item を
  次状態へ自動遷移する `transitionWorkItems` を指定できる (`update_pull_request` の complete アクション)。
- **PR レビュアー管理**: レビューパネルから既存レビュアーの必須/任意切替・削除が可能
  (`set_pull_request_reviewer_required` / `remove_pull_request_reviewer`)。
- **PR 編集**: ライフサイクル操作 (abandon / reactivate / publish / complete、`update_pull_request`) に加え、
  レビューパネルからタイトル・説明をインライン編集できる (`update_pull_request_details`)。
- **PR 操作**: レビューパネルから publish / complete / abandon に加え、自動完了 (auto-complete) の
  有効化・解除が可能 (`update_pull_request` の `enableAutoComplete` / `cancelAutoComplete` アクション、
  マージ戦略を指定。`get_pull_request_review` が `autoComplete` 状態を返す)。
  プレビューに添付ファイル (`AttachedFile` リレーション) を一覧表示しブラウザでダウンロード可能。
  エリア/イテレーションパスはプレビューの分類ツリーピッカー (`list_classification_nodes`) から
  選択して即時適用 (System.AreaPath / System.IterationPath を `update_fields` で更新)。
  コメントには絵文字リアクション (like/heart/hooray/smile/confused/dislike) を表示・付与・解除できる
  (`set_work_item_comment_reaction`)。絵文字ピッカーはキーボードで完結し (開くと先頭の絵文字に
  フォーカス、↑↓←→ で移動、Enter/Space でトグル、Escape で閉じてトリガーへフォーカスを返す)、
  自分が付けたリアクションはチェックバッジとリングで明示する。トグル後もピッカーは開いたままで、
  付与/解除の結果がその場で分かる。コメント取得は `$expand=all` を使い、リアクションに加えて
  サービス側でメンションを表示名へ解決した `renderedText` を受け取る。これによりプレビューが
  `@<guid>` の生 id を表示したり、サニタイズで欠落させたりしない。解決名が無い場合でも未解決
  トークンはエスケープして可視テキストとして残す。

---

## 4. 認証とシークレット

- **プロバイダ種別**: 各接続は `provider_kind` を持つ (`azdo` または `github`)。既定は `azdo`
  で、既存接続は無変更で動作する。詳細は `docs/design/05-provider-abstraction-and-github-mode.md`。
- **認証プロバイダ**: `auth_provider` は `pat` / `azure_cli` (アンダースコア形) / `github_pat`。
  - **PAT (Azure DevOps)**: `Authorization: Basic base64(":{pat}")`。必要スコープは Code(Read)/Work Items(Read)/Project and Team(Read)。
  - **Azure CLI**: `az account get-access-token` を実行し Bearer トークンを取得。メモリにキャッシュし、CLI 報告の `expires_on`/`expiresOn` から算出した有効期限の 60 秒前まで再利用する (取得できない古い CLI では 5 分の固定 TTL にフォールバック)。
  - **GitHub PAT**: `Authorization: Bearer {pat}` (classic / fine-grained)。接続追加時に `GET /user` で
    検証し、認証ユーザーの login から接続 id (`github:{login}`) を導出する。
- **シークレット保管**: Windows 資格情報マネージャ (`keyring`) のみ。
  - サービス名: `AzDoDeck` (汎用化後も互換のため据え置き)。
  - 資格情報キー: `azdodeck:org:{org}:pat` / `azdodeck:org:{org}:azure-cli` / `azdodeck:github:{login}:pat`。
  - PAT / トークンを SQLite・設定ファイル・ログ・テスト・デモに**一切残さない**。
- **複数接続**: Azure DevOps 組織と GitHub アカウントを複数登録できる。アプリは常に単一の
  アクティブ接続を指し、切替は Settings で行う (各画面に接続セレクタは無い)。各画面は
  `useActiveConnection.ts` の `useActiveOrganizationId()` / `useActiveOrganization()` で
  アクティブ接続を読み、そのデータだけを表示する。アクティブ接続が GitHub 種別のとき各画面は
  GitHub のデータを表示する (= GitHub Mode)。

---

## 5. データとバックグラウンド同期

### SQLite キャッシュ

- アクセス: `AppDatabase` がパスラッパとして呼び出しごとに接続を開く (`rusqlite`)。
- 移行: `src-tauri/src/db.rs` の `migrate()` が `PRAGMA user_version` を使用。
  **現行スキーマバージョン: 19** (v19 で通知履歴用の `notifications` テーブルを追加)。
- 主なテーブル: 組織、アクティブ/レビュー対象 PR、作業項目、My Work Items スナップショット
  (最大 200)、コミット、コミット↔PR 関連、各種 FTS インデックス、同期状態、スヌーズ、
  PR コメント既読、メンション/割当先履歴、通知履歴 (`notifications`)、アプリ設定。
- ジャーナル: WAL、`synchronous=NORMAL`、外部キー ON。

### 同期ループ (`sync.rs`)

- スコープ: `All` / `Hot` (MyReviews + MyWorkItems の高速更新) / `MyReviews` / `MyWorkItems` / `Commits`。
- 間隔: フル同期は約 5 分間隔。起動時とウィンドウ復帰時は Hot 同期 (復帰はスロットル)。手動トリガは間隔を無視。
- 並列実行: 1 パス内で全組織を並列処理し、各組織の PR / 作業項目 / コミット同期も並列に走らせる。
  プロジェクト一覧 (`_apis/projects`) は組織ごとに 1 回だけ取得して 3 種別で共有する。
  同時実行中の Azure DevOps リクエスト総数は共有セマフォ (`SyncBudget`, 既定 12) で上限を設け、
  ファンアウトが広がっても 429 圧力を一定に保つ (429 は `Retry-After` で吸収)。
- PR 同期: active PR とレビュー対象 PR の取得を重ね合わせ、CI ステータスは最新 50 件を後段で付与。
- 作業項目同期: プロジェクト単位で並列。`System.ChangedDate` デルタ取得 (24h ごとにフル) は維持。
- コミット同期: 全プロジェクトのリポジトリ一覧を並列取得した後、リポジトリ単位でコミットを取得。
  24h ごとにフル取得 (90 日窓を置換)、その間は前回同期以降の差分のみ取得してマージ
  (`merge_commits`)。フル/差分の判定は `commits:{org}` と `internal:commit_full_sync:{org}` の
  同期状態に基づく。force-push や削除は次回フル同期で整合される。
- イベント: 同期完了で `sync:updated` (org_id + 完了スコープ)。
  通知イベントは PR / 作業項目向けに別途 emit。
- 通知履歴: ルール/スヌーズ/種別トグルを通過した通知 (PR・作業項目・同期失敗) は
  `notifications` テーブルに記録してから既存イベントを emit し、続けて
  `notifications:inbox-updated` (空ペイロード) を emit する。記録は
  `desktop_notifications_enabled` に関係なく行い、DB エラーは同期を止めず警告ログのみ。
  `list_notifications` / `get_unread_notifications_count` / `mark_notifications_read` /
  `mark_all_notifications_read` / `record_notification` の各コマンドで参照・既読管理する。
- デスクトップ通知: 設定が有効な場合のみ。初回スナップショットでは過去分を通知しない。
  スヌーズ対象は通知から除外。コメント返信は `pr_comment_seen` で追跡。
- 通知ルール (`notification_rules`): 種別/プロジェクト/リポジトリ条件で通知を絞り込む。
  `mute` ルールは一致する通知を抑止し allow ルールより優先するため、特定の
  プロジェクト/リポジトリを個別にミュートできる（allow ルールが無ければミュート以外は通知）。
- Watch 中パイプラインの開始/終了通知はバックエンド同期を介さず、フロント常駐フック
  (`usePipelineWatchNotifications`、App 直下にマウント) が購読 (localStorage) を 30 秒間隔で
  ポーリングして最新実行の状態遷移を検出する。アクティブビューに依存せず動作し、初回観測では
  通知しない。`desktop_notifications_enabled` が無効の間はポーリング自体を停止。デスクトップ
  トーストと同じタイミングで `record_notification` (kind: `pipelineWatchStarted` /
  `pipelineWatchFinished`) を呼び通知履歴にも残す。パイプラインの手動実行キュー投入
  (App の `runQuickPipeline`、クイックパイプライン/コマンドパレット経由) も同様にトースト送出時
  `record_notification` (kind: `pipelineRunQueued`) を呼ぶ。いずれも記録失敗はトーストを妨げず
  コンソールへログするのみ。

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
| `work_item_stale_threshold_days` | 作業項目を stale 扱いする日数 (候補 2/3/5/7、既定 7)。 |
| `notification_rules` | 通知フィルタルール配列。types / projects / repositories でフィルタし、`mute` が true なら一致時に抑制、false なら一致時のみ通知する。 |

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
| `Escape` (検索/フィルタ入力内) | フォーカスを外す (ライブフィルタは文字列もクリア、検索クエリは保持) |
| `Ctrl+\` | 左ナビゲーションの折りたたみ / 展開 |

アプリに割り当てていない WebView 既定ショートカット (`Ctrl+P` 印刷、`Ctrl+G`
find-next) は、入力欄以外では抑止し、ネイティブ動作が素通りしないようにする。

### Go-To チェーン (`G` リーダー + 第 2 キー)

`R` My Reviews / `P` PR Search / `W` My Work Items / `I` Work Item Search /
`V` Work Item Views / `C` Commits / `B` Pipelines / `D` Code / `N` Notifications /
`S` Settings。
`R` My Reviews / `Q` PR Search / `W` My Work Items / `I` Work Item Search /
`V` Work Item Views / `C` Commits / `P` Pipelines / `D` Code / `S` Settings。

### グリッド内

`↑ ↓ / J K / Home / End / PageUp / PageDown` で移動、`Enter` でプレビュー/オープン、
`Ctrl+Enter` でブラウザを開く、`C` で URL コピー、`L` で Markdown 形式のリンク
(`[!123 タイトル](url)` / 作業項目は `[#123 タイトル](url)` / コミットは短縮 SHA
+ 件名) をコピー。作業項目グリッドでは
`S` 状態 / `A` 割当 / `P` 優先度 / `F` フィールド循環、`Ctrl+S` で適用、`M` でコメント。
プレビューの `D` は選択中の作業項目を複製ドラフト (タイトル `[Copy] ` 接頭辞 + 種別・
優先度・エリア/イテレーション・タグ・担当者) として作成ダイアログに引き継ぐ。
コメント欄の `Ctrl+Enter` は投稿 (+保留変更の適用) と同時にコメント入力からフォーカスを
外し、プレビューパネルへ返す。PR のコメント投稿 (Review タブ・返信・インライン) も
投稿完了後にフォーカスをプレビューへ返し、キーボード操作がそのまま続けられる。
作業項目と PR のコメント入力欄 (新規・返信・編集・インライン) は縦方向にリサイズできる。
作業項目プレビューのヘッダーには「Email a link」ボタンがあり、タイトルと URL を
本文に入れた `mailto:` リンクで既定のメールクライアントを開く (Azure DevOps Web の
Share 相当、Duplicate ボタンの隣、Tab キーで到達可能)。
行を1件選択中は、ステータスバーに主要な行ショートカットのコンパクトな凡例を表示する
(My Reviews / 作業項目グリッド)。Pipelines の監視パイプライン実行行でも
`↑ ↓ / J K / Home / End` で移動、`Enter` で実行プレビュー、`Ctrl+Enter` で
ブラウザを開く。

列ヘッダのフィルタアイコンから開くチェックボックス式の列フィルタは、対象グリッド
(My Reviews / PR Search / 作業項目) で共通の仕様とする。先頭に検索ボックス、続いて
`(All)` (フィルタ解除=全表示) と `Uncheck all` (全チェックを外し、明示的な空選択にして
任意の値だけを選び直せる状態) を並べ、その下に値ごとのチェックボックスを表示する。
内部状態では「キー無し=(All)」「空集合=全チェックを外した状態 (該当行なし)」を区別する。

検索フォーム側の絞り込み (PR Search のステータス/プロジェクト/リポジトリ、Work Item Search
の状態/種別/プロジェクト、Commits のプロジェクト/リポジトリ、Notifications の種別) も、単一選択の
`<select>` ではなく共通の複数選択コンポーネント `MultiSelectFilter`
(`src/components/MultiSelectFilter.tsx`) を使う。選択は値の配列で、空配列は「絞り込みなし
(=全件)」を意味する (PR ステータスのみ空=既定の active)。トリガーボタンは現在の選択を要約表示し、
Enter/Space/↓ で開き、↑↓ で項目移動、Enter/Space でトグル、Escape で閉じてトリガーへフォーカスを返す。
矢印などのキーはポップオーバー内に閉じ込め、背後のグリッドが反応しないようにする。Pipelines の
プロジェクト/パイプライン選択は結果リストの絞り込みではなく単一対象のドリルダウン (Watch / 詳細
パネルが単一定義前提) のため、単一選択の `FilterableSelect` のままとする。

ポップオーバー/メニュー/ダイアログは、最初の妥当なコントロールにフォーカスして開き、
矢印/Enter/Space/Escape で完結し、閉じる際は呼び出し元へフォーカスを返す。
ナビゲーションキーはポップアップ内に閉じ込め、背後グリッドが反応しないようにする。

バックグラウンド同期 (`sync:updated`) が選択行の DOM ノードを差し替え/除去すると
フォーカスが `<body>` に落ちるため、`useGridFocusRestoration`
(`src/lib/useGridFocusRestoration.ts`) でグリッドが保持していたフォーカスを
選択行へ復元する。ノード除去由来の blur (relatedTarget が null) は即座に所有権を
手放さず、データ署名の変化後に選択行を仮想ウィンドウへスクロールして数フレーム
リトライしながらフォーカスを戻す。My Reviews / 作業項目グリッドの両方で共有する。
ただしプレビュー枠はこのコンテナ内に同居するため、復元の直前に現在のフォーカスが
グリッド行以外の実要素 (プレビューのコメント入力やフィールドエディタ等) にある場合は
復元を行わない。これにより編集中に同期が走ってもフォーカスを奪わない。

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

- PR の **active** 検索はローカル同期キャッシュから動作する。**completed / abandoned**
  は履歴が大きくキャッシュしないため、`search_pull_requests` が Azure DevOps から
  ライブ取得する（commit 検索が非既定ブランチでキャッシュをバイパスするのと同じ方針）。
  ステータスは複数選択でき、選択された各ステータスについてキャッシュ (active) とライブ
  (completed/abandoned) の経路を実行して結果を結合する (集合は互いに素なので重複除去は不要)。
  ステータス未選択は active 既定 (安価なキャッシュ経路) にフォールバックする。
  キャッシュとライブ取得の両方を備えないステータスを UI に追加しない。
  プロジェクト/リポジトリの絞り込みは複数選択で、キャッシュ経路とライブ経路の双方に
  共通のメンバーシップ判定としてメモリ内で適用する (ライブ取得は対象プロジェクトのみに
  スコープして API 呼び出しを抑える)。ターゲットブランチと期間はライブ取得ではサーバ側
  (`searchCriteria.targetRefName` / `minTime`・`maxTime`・`queryTimeRangeType`) で、active
  キャッシュでは creation_date を対象にメモリ内で絞り込む。active 行は完了日を持たないため期間は常に作成日基準。
  ドラフト除外用に active キャッシュ (`pull_requests.is_draft`) が draft 状態を保持する。
- Azure DevOps のリッチテキストは表示前にサニタイズ・正規化し、生の HTML を可視テキストに漏らさない。
  本文中の認証必須な添付画像 (Work Item 添付ストアの `_apis/wit/attachments/`、および PR の説明・
  コメントに貼り付けた画像が使う `_apis/git/repositories/{repo}/pullRequests/{id}/attachments/`) は
  webview から直接取得すると認証ヘッダが付かず 401 になるため、バックエンド (`fetch_work_item_image`、
  同一組織の上記 2 形態の添付 URL のみ許可・LRU キャッシュ) 経由で取得して data URL に差し替えてから
  表示する。相対パスの添付 src は PR の webUrl を基準に絶対 URL へ解決してから同じ経路で取得する。
  添付 API が `application/octet-stream` を返す場合や URL にファイル名がない場合は、PNG/JPEG/GIF/WebP/
  BMP/ICO のファイルシグネチャから画像種別を判定する。
  Azure DevOps が挿入する添付ファイル名に生の空白を含む画像 markdown (`![alt](url with space.png)`)
  は、空白をパーセントエンコードした上で画像として描画する。ファイル名内の対応する丸括弧も URL の
  一部として保持する (strict CommonMark は生空白でリンク先を打ち切るため、無変換だと生テキストとして漏れる)。
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
