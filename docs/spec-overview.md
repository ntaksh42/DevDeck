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
    ├── prs.rs / work_items/ / repos/ / search.rs / pipelines.rs / pr_review.rs
    │                                          — ドメインサービス
    ├── sync.rs                                — バックグラウンド同期ループ + sync:updated イベント
    ├── snooze.rs                              — スヌーズ規則
    ├── orgs.rs / projects.rs / settings.rs    — 組織・プロジェクト・アプリ設定
    ├── auth.rs                                — PAT / Azure CLI 認証プロバイダ
    ├── db.rs                                  — SQLite キャッシュ (rusqlite, スキーマ移行)
    ├── secrets.rs                             — keyring (Windows 資格情報マネージャ)
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

最上位ナビ項目 (Pull Requests / Work Items / Pipelines) はドラッグ&ドロップ
またはキーボード (`Alt+↑` / `Alt+↓`) で並べ替えできる。順序は localStorage
(`azdodeck:layout:navOrder`) に永続化される。Help / Settings は下部固定で対象外。

| ビュー | 用途 |
|---|---|
| **My Reviews** | 自分がレビュアーの PR。投票状態・マージコンフリクト/CI バッジ・stale 強調・ローカルの done/archive トリアージ・ローカルのレビュー結果プレビュー。自分のレビュー後に author の push で投票がリセットされた PR を「Returned」バッジで強調（投票スナップショットの差分でローカル検出、開く/再投票で解除）。ソート可能な「Review age」列 (作成からの経過日数、stale 閾値超過で強調)。テキストフィルタは読み込み済みデータの値 (リポジトリ/作者) をキーボード操作可能なオートコンプリートで候補表示 (`FilterAutocomplete`)。フィルタは Reviews ペインのドックのタブ帯に置き、既定では小さな「Ctrl+F」ボタンに畳んでおく。`Ctrl+F` / `/` / ボタンで開いて入力欄にフォーカスし、`Escape` で畳んでグリッドの選択行へフォーカスを戻す。畳んでも値は保持し、有効なテキストはタブ帯にチップ (✕ でクリア) として残す。Show Drafts チェックボックス (ドラフト件数付き、`D` で切替) はフィルタの横に常時表示する。その横の「Group」セレクト (`B` で切替) で行のグループを投票状態 (既定) とリポジトリ (名前順) から選べる。グループの折りたたみ状態は方式ごとにローカルへ保存する。空のままフォーカスが外れた場合も畳む。プレビューヘッダー (`PrReviewHeader`) は上から「PR タイトル + Active/Draft → 問題点のバッジ (CI・Conflicts・コメント、該当時のみ) → `source → target` と `#ID · 作成者 · 経過` → Reviewers (承認数 + レビュアー) → Labels」の順にコンパクトに並べる。タイトルとメタデータは省略せず幅に応じて折り返し、Reviewers / Labels は見出し幅を揃え、チップは折り返す。その直下に投票を左、マージ戦略 / Complete / その他操作を右に置き、狭い幅では操作グループ単位で折り返す。ズーム・Email a link・Work Items・最大化の操作ボタン (`PrReviewToolbar`) はヘッダーではなく、Conversation / Result の各タブのドックのタブ帯右端に置く。タブ帯の幅がタブ全部とアイコン全部に足りないとき (初期幅など) は、最大化以外を「⋯」(View options) メニューにまとめ、タブが dockview のオーバーフローに隠れないようにする。メニューは開くと先頭項目にフォーカスし、↑↓ で移動、Enter/Space で実行、Escape で閉じてトリガーへフォーカスを返す (ズーム項目は実行後も開いたまま)。PR / Work Item プレビューのセクション見出し (Description・Comments など) は薄い青の帯 + 左アクセントバーで区切る。Result タブでは結果を広く見せるため、`#ID タイトル` だけの 1 行に縮める。コメントバッジは未解決があれば「N unresolved」で強調し、すべて解決済みなら「N resolved」を控えめに表示する (人間コメントを含むスレッドのみ集計しシステムスレッドは除外、0件は非表示)。システムスレッド (投票・push などの自動イベント) は Conversation に表示しない。。グリッドの下に「Work Items」ドックペイン (`LinkedWorkItemsPanel`) がある。既定ではタブ帯だけに畳まれており (状態は `azdodeck:myReviews:linkedWorkItemsCollapsed` に保存)、タブ帯のトグル (リンク件数 + Show/Hide) で開閉する。開くときは畳む前の高さに戻し、畳んだまま再起動した場合など高さが分からないときは同じ列の半分の高さで開く。畳んだまま Move panel で移動しても畳んだ状態を保つ。`t` キーまたはプレビューヘッダの clipboard ボタンで展開してフォーカスする。このペインはPR にリンクされた作業項目を `list_pull_request_work_items` (Azure DevOps の PR work items API、GitHub は空) の結果と説明文/コミットの `AB#NNN` 言及を統合して取得し、既存の `WorkItemPreviewPanel` でプレビューする。複数ある場合はタブ上部のラジオリストから `↑↓`/`←→` で選択 (`Esc` でグリッドへフォーカス復帰)。取得結果は TanStack Query キャッシュ (60 秒) を利用。コメントスレッドカード (`PrThreadCard`、Conversation タブで使用) は Azure DevOps 準拠の見た目: コメントごとに著者名から生成したイニシャル円アバター、カード右上に折りたたみトグルと Active/Resolved のステータスドロップダウン (バックエンドが対応する2状態のみ)。ファイルパスの無いスレッドは先頭コメントの著者行がそのままカードの見出し行を兼ねる。未解決スレッドはカード左端の琥珀色の線で示し、Resolved のスレッドは既定で折りたたむ (折りたたみ時はファイル名・先頭コメントの著者・1行サマリ・コメント数だけの1行)。カード下部は「Reply」「Resolve/Reactivate」のリンク型ボタン (Reply で返信コンポーザーに展開、Escape で畳んでプレビューへフォーカスを返す)。 |
| **My Pull Requests** | 自分が作成した active PR を一覧 (`list_my_created_pull_requests`、同期済みの active PR キャッシュ (`pull_requests`) から作成者の ID (`created_by_id`、大文字小文字を無視) で絞り込む。Approvals は PR 同期が保存する `pr_reviewer_counts` の集計 (vote==10 の人数/レビュアー総数)。キャッシュ元と同じく 1 プロジェクト 500 件の同期上限があり、上限に達したプロジェクトでは窓の外の PR が出ないことがある)。グリッドは My Reviews と同じ CSS グリッド構成・行スタイル・ステータスバーで、列 (PR# / Repository / Title〔Draft / Ready to merge バッジ込み〕/ Created / Target / Approvals〔vote==10 の人数/レビュアー総数〕) はヘッダクリックでソート可能、ドラッグで列幅リサイズ (localStorage 永続化)、Columns メニューで表示列を切替 (PR#/Title は必須)。タブ帯のフィルタ横に Show Drafts チェックボックス (既定オン、ドラフト件数付き) を常時表示し、オフでドラフトを除外する。テキストフィルタは読み込み済みデータの値 (リポジトリ/タイトル/ターゲット) をオートコンプリート候補表示するクライアント側絞り込み (`FilterAutocomplete`)。フィルタはグリッド上端のタイトル帯に「Ctrl+F」ボタンとして畳んでおき、My Reviews と同じ操作 (`DockFilterBar`: `Ctrl+F`/`/`/ボタンで開く、`Escape` で畳んで行へフォーカスを戻す、値はチップで残す) で使う。右側には My Reviews と同じ PR レビューパネル (Conversation / Result) をドックし、選択中の PR を表示する (レイアウトは `azdodeck:layout:myPullRequestsPreview:dockview:v1` に保存)。キーボード操作 (`↑↓`/`J K`/`Home`/`End`、`Enter`/`→` でプレビューへフォーカス、`O`/`Ctrl+Enter` でブラウザ、`\` でプレビュー最大化、`C` で URL コピー)。複数組織は組織セレクタで切替。PR 同期 (`myReviews` / `hot` / `all` スコープ) の完了 (`sync:updated`) で再描画し、API は呼ばない。初回同期前や作成者 ID が未取得の組織では空になる。`warnings` は常に空。 |
| **Pull Request Search** | 検索欄・Filters・Search と有効条件のチップを表示する。Filters は状態・作成者・レビュアー、More filters はプロジェクト/リポジトリ/ターゲットブランチ/期間/ドラフト除外/除外語。Apply & search で条件を確定して検索する。初期状態は active + completed (保存済みの選択を優先)。Azure DevOps は全ステータスを検索時にライブ取得し、100件ずつ追加探索する。複数語AND・除外・フレーズ・PR番号検索に対応。作成者/レビュアーは個人IDで指定し Me も選べる。並び替え・列フィルタは取得済みの結果に適用。右側の Conversation / Result プレビュー、列リサイズ・Columns・複数選択・URLコピーを維持する。GitHub は既存の検索条件と取得経路を使う。 |
| **My Work Items** | 自分に割当中の未完了の作業項目 (同期 WIQL で `System.State` が Closed / Done / Completed / Removed の項目は除外 (`System.StateCategory` は WIQL で参照できない)。サイドバーのバッジも同じ集合の件数)。スマートフィルタは Work items ペインのタブ帯に「Ctrl+F」ボタンとして畳んでおく (`WorkItemFilterBar`、操作は My Reviews と同じ。Work Item Views の list レイアウトと Work Items Search の結果フィルタも同じ)。状態・種別・割当先・タグ (`System.Tags`、各タグをチップ表示)・更新日時。最後に開いてから変更された項目に未読マーカー (ChangedDate の差分でローカル検出、開くと消える)。 |
| **Work Item Views** | 保存済み WIQL クエリ。件数表示、ナビへのピン留め、並べ替え、ビュー別ソート/列。グリッドの Columns メニューの「Field columns」から、組織全体の Azure DevOps フィールドを検索 (名前/参照名/型の部分一致、`Enter` で先頭候補を追加) して追加列にでき、チェックを外すと削除する。プロジェクト未指定でも候補を取得し、未検索時も `Custom.` 以外の名前空間を含める (表示は最大20候補、検索で絞り込み)。追加列はビューの Extra columns (ビュー編集ダイアログと同じ設定、最大20列) として保存される。グリッドの列見出しとコピー (`Ctrl+C`) のヘッダーは Azure DevOps の表示名で出し (Columns メニューと同じフィールド定義のキャッシュを共有)、定義が未取得または該当なしの間は参照名の末尾で代替する。テキストフィルタ (`Ctrl+F`/`/` でフォーカス、`parseSearchQuery`/`matchesWorkItemQuery` によるスマート検索、list/board 両レイアウトに適用)。取得件数の上限はなく (ビュー編集の Limit を空欄にすると無制限、既定)、明示的に件数を指定した場合のみ打ち切る。展開時のコンパクト表示はビューの内容幅に合わせて間隔 4px で左詰めし、幅が足りなければ折り返す (`↑↓` は隣の行で横位置が最も近いビューへ移る)。ビュー一覧は既定で**枠なし 1 行のチップ列** (ビュー名 + 件数 + 差分。選択中は強調、アラート中・ピン留めはチップ内のアイコン/色で示す。高さは検索行と同じ `h-8`) で、同じ行の右端に List / Board の切替・「⋯」・Edit・Run all・+ Add を置く。チップは `role="option"` で、`←→` (`↑↓` も同じく前後) で移動、`Home` / `End`、クリック・フォーカス移動で選択、`Shift+←→` で並べ替え、`Delete` / `N` / `E` / `R` はカード表示と同じ。幅が足りなければチップ列だけが横スクロールする。チップ表示ではカード用の Pin / 左右移動 / Preview 表示切替ボタンと表示密度スイッチは行から外し、Pin・Preview 表示切替・左右移動は「⋯」メニューの先頭に置く。ヘッダー左端の ▸/▾ トグルまたは `Ctrl+B` (グリッドからも有効) でカード表示 (従来の枠付きヘッダー + カード / コンパクト行のグリッド。Pin / 左右移動 / Preview 切替ボタンと密度スイッチ付き) と切り替える。表示の選択 (`azdodeck:workItemViewsCollapsed`、保存値が無い・`true` ならチップ、`false` ならカード) と密度 (`azdodeck:workItemViewsCardMode`、カード表示のみ) は localStorage に保存する。トグルで表示を切り替えた後、フォーカスはチップ→トグル / カード→選択中のカードへ戻す。カードには件数推移のスパークラインを描画する (`azdodeck:workItems:viewCountHistory`、ビューごと最大20点、同値の連続は記録しない。2点未満は非表示。増加=赤/減少=緑/横ばい=灰)。ビュー JSON の Export はデスクトップ版では保存ダイアログで出力先とファイル名を選択し、ブラウザ版では既定のダウンロード先へ保存する。 カード表示のヘッダーは1行 (Views · 件数) で、Pin / Preview / Share / Export / Import はアイコンのみのボタン (名前はツールチップとスクリーンリーダー用テキスト)。カードは名前 → 件数+差分+スパークライン → 制限・ソート等のメタ情報1行の3段。 |
| **Work Item Search** | キーワード + プロジェクト/状態/種別 (いずれも複数選択可) での作業項目検索。全文検索 (FTS)。グリッドは Tags 列 (`System.Tags` をチップ表示、Columns メニューで表示切替・ソート可) を含む。 |
| **Pipelines** | ビルド実行をプロジェクト/定義/ブランチ/結果/状態で一覧。タイムライン・ログ末尾の表示、再実行・キャンセル。 実行の成果物 (artifacts) を一覧表示しブラウザでダウンロード (`list_pipeline_artifacts`)。終了済みの実行で失敗 (failed / canceled) したステージがあると、実行詳細の「Failed stages」に各ステージの「Retry failed jobs」(失敗ジョブのみ) / 「Retry all jobs」(全ジョブ) を出し、インライン確認の後に同じ実行内でそのステージだけを再実行する (`retry_pipeline_stage`: `PATCH build/builds/{id}/stages/{identifier}` に `state=retry`・`forceRetryAllJobs`。ステージ識別子は Timeline の `identifier`。実行全体の Re-run (新規実行を Queue) とは別操作で、書き込み系なので read-only 検証モードでは出さず、バックエンドも拒否する)。実行詳細の「Tests」には、ビルドが公開したテスト実行の合計 (passed / failed / skipped・other) と失敗テスト (最大 100 件、超過時は件数を明示。テスト名・実行名・所要時間、クリックで展開してエラーメッセージ) を表示する (`list_pipeline_test_results`: Test Runs API を `buildUri` で引き、失敗件数のある実行のみ `outcomes=Failed` の結果を取得)。テスト未公開のビルドや取得失敗時は欄を出さない。失敗テストがあるときは、同じパイプライン定義・同じブランチの直近 10 回の完了済み実行の失敗テストと突き合わせ (`list_flaky_tests`: 各実行の Test Runs と失敗結果 (テスト実行あたり最大 300 件) を並列度 4 で取得し、完了済みビルドの結果はビルド ID と完了時刻をキーにプロセス内でキャッシュ。取得できなかった実行は飛ばして件数を返し、全部失敗したときだけエラー)、各失敗テストにバッジを付ける: `Flaky n/m` (同じコミットで失敗と成功の両方がある、または同じビルド内の同名テスト実行 (ジョブの再試行) で通った)、`Unstable n/m` (成功と失敗が 2 回以上入れ替わった)、`New since {ビルド番号}` (それまで通っていて、その実行以降失敗し続けている)、`Failing n/m` (見えた実行すべてで失敗)、`Fixed later` (その後の実行では通っている)。テストの成功は失敗結果だけから推定する (テストを公開し、失敗一覧をすべて取得できた実行で名前が無ければ成功、テスト未公開・失敗一覧が上限で切れた実行は数えない)。テスト名は Tests 欄と同じ表示名 (タイトル、無ければ自動テスト名) で突き合わせる。バッジの説明は展開時に 1 行で表示する (ツールチップにも同じ文)。表示中の失敗がすべて Flaky / Unstable なら「All failures are known flaky tests — retrying the failed jobs is likely enough.」、一部なら件数を 1 行で出し、欄の末尾に比較した実行数を出す。比較の取得失敗時はバッジを出さず、Tests 欄自体は従来どおり表示する。GitHub 接続は `NotSupported`。 ブランチ + 任意のランタイムパラメータを指定して新規実行をキュー投入 (`queue_pipeline_run`)。 自分に割り当てられた保留中の承認 (manual approval) をアプリ内で承認/却下 (`list_pipeline_approvals` / `update_pipeline_approval`)。承認待ちは件数と先頭の依頼だけを1行の帯に畳んで表示し、帯のボタン (Enter/Space) で一覧を開閉する。Project / Pipeline の選択と Watch / Queue run は1行のツールバーにまとめる。 パイプラインを Watch (購読、localStorage、最大 100) すると実行履歴を常時追跡し、最新実行の開始/終了をデスクトップ通知 (`desktop_notifications_enabled` に従う)。Watched pipelines ボードにペイン内の見出し行は無い。ペインのタブ名は「Watched pipelines」で、Sort セレクトと更新時刻つきの更新ボタンはドックのタブ帯の右側 (フィルタの右) に置く (ボードが `toolbarSlot` へ portal で描画する)。件数は下端の共通ステータスバーに `N items · ● N running · N failed · N approvals` (既存のピルの色とフィルタ/トグル動作はそのまま) として出し、右端の `?` が Help の Pipelines の節を開く (run を選択中は従来のキー操作ヒント行もステータスバーの上に出る)。実行中 (最新実行が active) のパイプライン数は「N running」ピル (パルスドット) で示し、該当行を青の左アクセント + パルスドットで強調して、いま実行中のパイプラインが一目で分かる。実行中の購読は表示順のみ一覧の先頭に固定表示 (安定ソート。実行中同士・非実行中同士は元の購読順を維持し、localStorage の購読順自体は変更しない)。見出しボタンは 1 つの Tab 停止 (roving) で、`↑↓`/`J K`/`Home`/`End` で見出し間を移動、`Enter`/`Space` で実行履歴を開閉、`Delete` で Watch を外す (行の ✕ は Tab 順から外す)。行の見出しボタンにフォーカスすると、その pipeline の最新実行が Agent パネルの対象になる (実行の詳細を開くとその実行が優先)。承認待ちが選択中プロジェクトにあるときは、Agent パネルの `+ Pending approvals (N)` で承認待ちの表を足せる (承認は実行 ID を持たないため、実行の対象にはならない)。 Queue run のブランチ欄は、選択中のパイプライン定義 (`get_pipeline_definition` が返す `repository`) が Azure Repos (TfsGit) を参照していればそのブランチ一覧 (`list_repo_branches`) をキーボード操作対応の候補選択欄 (`FilterableSelect`、既定値はリポジトリの既定ブランチ) で提示し、候補にない値の自由入力も許可する。リポジトリ情報が無い/TfsGit 以外/ブランチ取得失敗の場合は従来どおりの自由入力欄にフォールバックする。選択・入力したブランチ名は `refs/heads/` 形式に正規化してから `queue_pipeline_run` に渡す。Queue run のパラメータ欄は、選択中の定義が上書き可能な変数 (`allowOverride === true`) を持つ場合、変数ごとのラベル付き入力欄 (シークレット変数は空欄始まりのパスワード入力) を表示し、既定値から変更した変数のみを `parameters` として送信する。上書き可能な変数が無い/定義詳細が未取得の場合は従来どおり `name=value` 改行区切りの自由入力欄のみを表示する (両方表示時は「追加パラメータ」欄として残り、変数入力欄と同名キーがあれば変数入力欄側が優先される)。 定義の非シークレット変数の追加/変更/削除と CI トリガー (継続的インテグレーション) の有効化/無効化・ブランチ/パスフィルタ編集を `update_pipeline_definition` で行える (書き込みガード対象)。実装は定義の生 JSON を取得→変更→PUT で送信し、`isSecret: true` の変数は常に温存され、入力に同名エントリがあれば拒否される。CI トリガーを有効化する際はブランチフィルタが 1 件以上必要、無効化するとトリガーエントリを削除する。他のトリガー種別 (schedule / pullRequest 等) は変更されない。 定義パネル (`PipelineDefinitionPanel`) の Edit ボタンから編集フォーム (`PipelineDefinitionEditForm`) を開き、非シークレット変数を行単位で追加/変更/削除 (name / value / allowOverride チェックボックス) できる。シークレット変数は "(secret)" 表示の読み取り専用行として並び、編集・削除操作を提供しない。CI トリガーは有効/無効チェックボックスと branch/path filters (1 行 1 件のテキストエリア) を編集でき、セクションを触っていなければ保存時に `ciTrigger: null` を送りトリガーを変更しない。Save は `update_pipeline_definition` を呼び、成功時は返却された定義でクエリキャッシュを更新して閲覧モードに戻り、失敗時はパネル内にエラーを表示したまま編集状態を維持する。編集モードは Edit ボタンから開始 (最初の入力にフォーカス)、Escape または Cancel/Save で終了しフォーカスを Edit ボタンへ戻す、キー操作はフォーム内に閉じ込めて背後のビューに伝播しない。 |
| **Settings** | パネルを 7 カテゴリ (Accounts / Appearance & keyboard / Notifications / Views & workflow / Project / Data & sync / Advanced) に分けて表示。左側 (狭い幅では上部) に sticky なセクションナビとフィルタ入力を置く。フィルタは全語 AND・大文字小文字無視でカテゴリ名・パネル名・キーワードに一致するパネルだけを残し、該当なしのカテゴリはナビで無効化、全件不一致なら空状態 + Clear filter。フィルタは `focusFilter` (既定 `Ctrl+F`) でフォーカス、`Enter` で最初の一致パネルの先頭コントロールへ移動、`Escape` は 1 回目でクリア・2 回目でフォーカス解除。ナビは `↑↓`/`←→`/`Home`/`End` でボタン間移動、Enter/クリックでセクションへスクロールしてフォーカス、スクロール位置に応じて現在セクションを `aria-current` で強調。Connections 一覧は Add connection の直前 (先頭) に表示。実験フラグで非表示のパネル (Usage stats / Diagnostics) はフィルタ・ナビの対象外。内容: 組織設定 (PAT / Azure CLI)、外観 (テーマ + UI scale)、通知設定、フォルダパス、グローバルホットキー、キーバインド上書き、行の条件付き色ルール (Work Item グリッドの行を条件で着色、先勝ち、localStorage 永続化)。Software update パネル (opt-in: 手動で更新確認→適用、失敗時は安全にスキップ。`tauri-plugin-updater`、ブラウザでは無効)。Experimental パネル (マスタースイッチ + 個別フラグ。マスターが false の間は個別フラグの保存値を保持したまま無効化する)。Usage stats パネル (`experimental_usage_stats` が有効なときのみ表示。localStorage `azdodeck:experimental:usageStats` に投票数・解決スレッド数・状態変更数を集計、リセット可能、外部送信なし)。 |
| **Notifications** | 通知履歴 (`notifications` テーブル) 専用ビュー。サイドバー最上位に固定表示 (ドラッグ並べ替え対象外)、未読件数バッジ付き。フィルタ: Unread only トグル、種別のカテゴリボタン (All / PR / Work item / Pipeline / Sync、件数付き。件数は読み込み済みの行から数え、絞り込みは `kinds` でバックエンドが行う)、組織が2件以上のときのみ表示される単一選択の組織セレクト。一覧は `list_notifications` (`limit=100`、`beforeId` カーソルで「Load more」) を `useInfiniteQuery` で取得し、共有 `useGridVirtualizer` で仮想化。行は未読ドット・タイトル・相対時刻・種別ラベル+詳細+本文冒頭、webUrl があれば行内に外部ブラウザで開くボタン。キーボード: `↑↓`/`J K`/`Home`/`End`/`PageUp`/`PageDown` で行移動、`Enter` でジャンプ (種別ごとに PR Search / Work Item Search / Pipelines / Settings のいずれかへ遷移、または `webUrl` を外部ブラウザで開く。対象を特定できない場合は何もしない) と同時に既読化、`Ctrl+Enter` は `webUrl` を外部ブラウザで開いて既読化、`R` で選択行を既読化 (バックエンドに未読へ戻す手段が無いため、未読の行を既読にするだけの片方向操作)。選択行の PR / WI 通知は Agent パネルの対象になる (ペイロードに PR / WI の ID・リポジトリ・プロジェクト名が入る種別のみ。プロジェクト ID は通知に無いため名前で代用する。タイトルは本文が「タイトル + 改行 + リポジトリ / 組織」形式のときだけ付く)。ドックが無いため Agent パネルは右端のドロワーで、閉じた状態で始まり、`Ctrl+J` で開閉する。一覧の下端には他の一覧と同じ共通ステータスバー (`N items · N unread` と `?`) を置く。本文にタイトル行が無い通知は、通知タイトルの「種別: 」より後ろを Agent の対象のタイトルにする。ヘッダーの「Mark all read」で全既読。既読操作は `mark_notifications_read` / `mark_all_notifications_read` を呼び関連クエリを invalidate。`notifications:inbox-updated` イベント (App 直下で購読) を受けて一覧・未読バッジの両方を invalidate するため、ビューを開いていなくてもバッジは最新化される。パイプライン監視の開始/終了通知 (`usePipelineWatchNotifications`) とパイプライン手動実行のキュー投入 (App の `runQuickPipeline`) は、デスクトップ通知トーストと同じタイミングで `record_notification` を呼び、同じ履歴に記録する (kind: `pipelineWatchStarted` / `pipelineWatchFinished` / `pipelineRunQueued`)。失敗したパイプラインの自動調査を起動したときも `pipelineInvestigationStarted` を記録する。`G` チェーンは `N`。 |
| **Agent Auto Queue** | 自動レビュー / 自動調査の候補 (PR / WI) を左に一覧、右に選択中の 1 件の資料プレビュー (先頭 30,000 文字・文字数・トークン見積) で並べ、チェックしたものだけエージェントに渡すビュー (サイドバーの Inbox の下とコマンドパレット「Go to Agent Auto Queue」から開く。`G` → `A` で開く)。キー: ↑↓ 移動 / Space 選択 / A 全選択 / S スキップ / Ctrl+Enter 実行。開いた時と実行・スキップの後はフォーカスを一覧に戻す。同期のたびに再取得する。 |
| **Inbox** | 自分に向けられたコメント (PR / WI のメンション・返信、自作 PR へのコメント) を 1 か所で見て、その場で返信・Resolve・Done・Snooze するビュー (サイドバー最上位に固定、`G` → `I`)。**詳細な仕様 (検出・状態・重要度・プレビュー・キー操作・関連リンク・Claude の判断メモ・コマンド) は [`docs/spec-inbox.md`](spec-inbox.md) に分けた。Inbox を変えるときはそちらを更新する。** |

### PR 検索の条件・追加探索

- Azure DevOps の検索対象はタイトル・作成者名・プロジェクト・リポジトリ・両ブランチ。空白区切りは AND、`-test` は除外、`"connection timeout"` はフレーズ。各語は別の対象項目に一致してもよい。大文字小文字は Unicode の小文字化で無視する。`#123` は番号完全一致、裸の数字は従来の番号前方一致またはテキスト部分一致。説明・コメント・コードの全文検索はしない。
- Exclude words では空白区切りの語/引用フレーズをすべて除外条件にする。各入力200文字・合計20条件まで。閉じていない引用符・空フレーズ・単独の `-`・不正な `#番号` は通信前にエラー。フレーズ内は `\\` / `\"` のエスケープに対応する。OR や正規表現の演算子は導入しない。
- 作成者とレビュアーは各1人、両方選ぶ場合は AND。Me は対象組織の認証ユーザーIDに解決する。レビュアーは現在登録中の個人で、投票の有無は問わない。チーム経由の担当・単なる過去のコメント参加者は対象外。人物候補は名前/メールで検索し、同名をメール併記で区別する。
- Filters は下書きとして編集し、Apply & search で確定・検索。Escape/外側クリックで破棄して起点へフォーカスを戻す。候補は上下/Enter/Escape、ダイアログ内は Tab/Shift+Tab で完結し、IME変換中の Enter では確定しない。有効条件はチップから解除できる。
- `search_pull_requests` の `progressive: true` は `searchId`・`authorId`・`reviewerId`・`excludeWords`・`continuationToken`・`retryFailed` を扱う。戻り値は既存の `{ pullRequests, total, truncated, warnings }` に `searchId, continuationToken, scannedCount, searchComplete, hasMore, failedScopes` を追加する。`pullRequests` は今回の差分 (最大100件)、`total` は累計返却件数で、探索中の全体総数を意味しない。
- APIは200件の要求サイズで最大10ページ・20秒を一区切りとする。プロジェクト/ステータス/ブランチを順番に探索し、短いページでも終了とみなさず空ページで完了する。`$skip` は実際の返却件数で進める。取得済みIDと余剰の一致結果を保持し、100件の表示上限や既存のプロジェクト500件枠の先も探索できる。
- 一致0件でも未探索範囲があれば No matches yet と Search more を表示する。すべての範囲が取得済みで失敗がなければ Search complete、0件なら No pull requests matched.。失敗範囲は成功結果と区別して表示し、Retry failed scopes で再試行する。全範囲の取得失敗は検索エラーとし、0件成功にはしない。
- `stop_pull_request_search({ organizationId, searchId })` は継続処理の停止フラグを立て、処理済みページ・結果を残す。条件・組織の異なる検索を続行トークンで混ぜず、同じ検索の二重実行を拒否する。続行情報はメモリのみで最後の操作から10分で期限切れとし、画面には再検索を案内する。
- 追加取得と並べ替えでは選択中PRとフォーカスをIDで維持する。ソートは取得済みの範囲の順序で、未探索の結果を含む全体上位順は保証しない。検索中にサーバ側データが変更されるため固定スナップショットでもない。語や組織を変えた後の古い応答を採用しない。
- 履歴には人物ID/表示名と除外語も保存し、古い履歴の不足フィールドは既定値で補う。Ctrl+K から直接渡されたPRは再検索せず表示する。GitHub および `progressive` 未指定の旧呼出元は既存の検索契約を維持する。ブラウザデモは同じ式・条件・追加取得を実装し、`?prSearchScenario=empty-first` / `partial` で途中0件・部分失敗を検証できる。

My Pull Requests の `list_my_created_pull_requests` は `{ pullRequests, warnings }` を返す。
旧 PR 検索では live 取得のプロジェクト単位の失敗を `warnings` にまとめ、成功した結果を表示する。空の成功レスポンスは成功と数え、全取得が失敗した場合はエラーにする。

### 横断機能

- **コマンドパレット (`Ctrl+K`)**: コマンド実行 + 現在の Azure DevOps 組織の作業項目/Active PR のライブ横断検索。同期対象の設定やローカルキャッシュの有無に依存せず、アクセスできる全プロジェクトを対象にする。
  数字 (先頭の `#` は省略可能) は ID 完全一致、その他はタイトルの部分一致。本文・コメント・担当者・リポジトリ名は通常検索の対象外。文字は 2 文字、数字は 1 桁から 300ms 待って検索し、`wi:` / `pr:` を付けた場合はその種別の API だけ呼ぶ。
  作業項目は組織レベル WIQL (`System.Title CONTAINS`、更新日時の新しい順) とバッチ取得で検索し、数字なら組織レベルの ID 取得を使う。状態は限定しない。WIQL の文字列中の `'` は `''` にエスケープする。
  PR の数字検索は組織レベル ID 取得後に Active のみ返す。タイトル検索は全プロジェクトの Active PR を `$skip` / `$top` で空ページまで取得し、タイトルを大文字小文字を区別せず照合する (7.1 安定版 API にタイトル条件がないため)。プロジェクト取得は最大 4 並列、完全に取得できた一覧だけ組織単位で 30 秒間メモリに保持し、入力ごとの全件取得を避ける。一部失敗した一覧は再利用しない。
  結果は種別ごとに最大 5 件、ID 一致を含む種別を先に表示し、残りは作業項目の更新日時 / PR の作成日時の新しい順。検索結果はコマンド候補より先に表示する。取得件数は下限の場合があるため「全 N 件」のような総数は表示せず、表示上限を超えると入力の絞り込みを案内する。
  入力が空または短い間は現在の組織で最近開いた項目を新しい順に表示し、選択時は ID でライブ取得し直す。ライブ検索で選んだ項目は取得済み summary を移動先の一覧へ直接渡し、ローカル検索に戻って未同期の項目を見失わないようにする。
  画面に組織・全アクセス可能プロジェクト・Active PR の範囲を明示する。ブラウザ版は固定デモデータのみであり、その旨を常時表示する。GitHub 接続のパレット検索は未対応と明示し、専用の PR / Issue 検索画面を案内する。
  API 失敗や 20 秒のタイムアウトを 0 件と同じ表示にしない。一方の種別・プロジェクトだけ失敗したときは成功した結果と警告を返し、すべて失敗したときはエラーを表示する。入力や組織が変わった後は以前の結果を選択できないようにし、自動リトライはしない。同じ入力の結果は 15 秒間再利用する。検索入力は最大 200 文字、数字 ID は正の 32bit 整数。
  候補へ直接フォーカスしている間は、候補の並び替え後もその行を選択・実行対象に保ち、上下キーではフォーカスも移動する。閉じるボタンの Enter はパレットを閉じ、候補を実行しない。
  接頭辞 `wi:` / `pr:` で種別を限定。`Enter` でアプリ内、`Ctrl+Enter` でブラウザ。
  `pr:` 検索時は各 PR に「Approve / Reject」アクション行を追加し、パレットから直接レビュー投票
  (`submit_pull_request_vote`) できる。
  接頭辞 `inbox:` は Inbox の Open 項目を一覧し (入力はタイトル/リポジトリ/作成者/本文の絞り込み、2 文字未満でも可)、
  各項目に「Done」「Snooze until tomorrow」の行を出して `set_action_inbox_item_state` で状態を変える。
  `wiki:` はアクティブな接続の Wiki ページ検索 (`search_wiki`、Search 拡張が必要) を実行し (失敗時は「Wiki Search is unavailable」の 1 行)、
  ヒットを `Enter` でアプリ内プレビューダイアログ (`get_wiki_page`、本文を Markdown としてサニタイズ表示。Esc で閉じ、フォーカスは元に戻る) に開き、`Ctrl+Enter` でブラウザに開く。Wiki の編集はブラウザへジャンプする方針で、アプリ内編集はしない。GitHub 接続では未対応 (`NotSupported`)。
  パレットの通常検索・最近開いた項目は現在の組織に限定し、組織の読み込み中は通常検索しない。組織の切り替え時に以前の組織の検索結果を表示しない。URL 貼り付けによる別組織への直接移動は引き続き利用でき、接続の切り替えに失敗した場合は検索画面へ進まない。
  Azure DevOps の URL (`dev.azure.com/{org}/…` / `{org}.visualstudio.com/…`) を貼ると、テキスト検索の代わりに「Link」の 1 行を出す (`src/app/paletteUrl.ts`)。
  PR (`/_git/{repo}/pullrequest/{id}`) は PR Search、WI (`/_workitems/edit/{id}`、ボード等の `?workitem={id}`) は Work Item Search を、URL の組織名に一致する接続でその ID により開く (検索ビューはアクティブ接続を読むため、別の登録済み組織の URL ならアクティブ接続をその組織へ切り替えてから開き、行の詳細にその旨を出す。組織横断サマリーと同じ挙動)。リンクの PR は ID でライブ取得し、Active の場合だけアプリ内で開く (完了済み / 破棄済みの PR はブラウザで開ける)。
  パイプライン実行 (`/_build/results?buildId={id}`) は特定の実行をアプリ内で選ぶ手段が無いためブラウザで開く行だけを出す。URL の組織が未登録なら「not registered」と示し、ブラウザで開く行だけを出す。
  解釈できない URL は通常のテキスト入力として扱う。`Ctrl+Enter` はどの行でも URL をブラウザで開く。
- **次アクション / 前回閲覧以降の更新 / 設定の移行** (詳細: `docs/spec-daily-flow.md`):
  - My Pull Requests では `N` / `Shift+N` で、次/前の「自分の対応が要る PR」(Ready to merge) へ移動する
    (`nextAction.ts` の純関数。My Reviews 向けの判定 `reviewNextAction` も同ファイルにある)。
  - My Reviews は、開いた時点の PR 状態の指紋 (タイトル・ドラフト・マージ状態・CI・ターゲット) を
    `azdodeck:lastSeen:v1` に保存し、同期後に指紋が変わった行へ「Updated」バッジを出す (最大 2000 件)。
  - Settings > Data & sync の「Export / import settings」で、レイアウト・ビュー・キー割り当て等の
    ローカル設定を JSON で書き出し/読み込みできる (許可リスト方式。組織・資格情報・行動履歴は含めない)。
- **作業項目のフォロー** (issue #304): プレビューのタブ帯 `⋯` メニューの Follow 項目 (✓ で現在の状態を表示) で Follow/Unfollow
  (`follow_work_item` / `unfollow_work_item`)。Azure DevOps に公開の follow/購読設定 REST API が
  無いため、フォローはローカルの SQLite ウォッチリスト (`followed_work_items`、フォロー時点の
  タイトル/状態などのスナップショットを保持) であり、サーバ側の通知購読とは連動しない。
  My Work Items パネルに「Assigned to me / Followed」の切替トグルがあり、フォロー中の項目を
  一覧できる (`list_followed_work_items`)。
- **スヌーズ**: PR / 作業項目の通知を一定期間繰り延べ。プリセットは当日夕方、翌朝、3日後、翌週月曜、1か月後。カスタム日時は現在より後のみ受け付け (過去は UI で確定不可、`snooze_item` も `InvalidInput` で拒否)。My Reviews の範囲選択または作業項目グリッド (My Work Items / Work Item Views のグリッド表示 / Work Item Search) のチェック選択に対して同じ期限を一括適用できる (`Z` またはバルクバーの Snooze)。スヌーズ中の作業項目はこれら3画面の結果から隠れ、ステータスバーの `Snoozed N` ボタン (N は有効なスヌーズ件数) で一覧・解除できる (My Items 外の項目のタイトルは表示中の結果から補完)。新たなアクティビティまたは期限で復帰 (アクティビティ判定は My Items の同期キャッシュに基づくため、My Items 外の項目は期限でのみ復帰)。ボード表示とピン留めビューの件数バッジはスヌーズを考慮しない。
  ただし PR のコメント活動による早期復帰は `pr_comment_seen` カーソルに依存し、同カーソルは
  コメント返信通知の処理時（`notify_pr_comment_replies` が有効。`desktop_notifications_enabled`
  には依存しない）のみ進むため、同トグルがオフの間はコメント活動では早期復帰せず期限で復帰する。
- **Agent パネル (どの View からもエージェントに依頼)**: `Ctrl+J` (キー割り当て `toggleAgent`) で開閉する
  (`src/components/agent/`、開閉状態は `agentPanelStore`)。`DockableWorkspace` を持つ View (Inbox / My Reviews /
  My Pull Requests / PR Search / Work Items / Pipelines) ではドックのパネル (id `agent`、`useAgentDock`) として加わり、
  タブのドラッグで左右上下の分割・タブ化・リサイズが自由にできる。閉じたときの位置 (隣のパネルと方向、幅 / 高さ) を
  `{レイアウトのキー}:agent-dock` に保存し、次に開くとそこへ戻す (初回は一番右のパネルの右、幅 360px)。ドックの
  レイアウト保存にはパネルが含まれるが、閉じている状態で復元すると未知のパネルとして外れる。ドックの無い View
  (Notifications / Settings など) では右端に幅 360px のドロワーとして出す。どの View でも閉じた状態で始まり、
  一覧とプレビューに幅を譲る (開閉状態はアプリ全体で 1 つで、View を移っても保つ)。
  `Ctrl+J` で開くと入力欄にフォーカスし、
  `Esc` で閉じて開く前のフォーカス (グリッドの行など) に戻す。
  - **対象 (文脈)**: 各 View が選択中のものを `usePublishAgentSubject` で公開し、パネルはそれを自動で対象にする。
    PR (My Reviews / My Pull Requests / PR Search / Inbox の PR 項目 / Notifications の PR 通知)、
    WI (My Items / Views / Search / Inbox の WI 項目 / Notifications の WI 通知)、
    パイプライン実行 (Pipelines の実行詳細、詳細を開く前は Watched pipelines で最後にフォーカスした行の最新実行)、
    Wiki ページ (Wiki プレビューの「Ask agent」)。対象は入力欄の placeholder
    (`Ask about !45 …` / 対象なしは `Ask the agent…`) にも出す。Inbox の PR メンション / 返信は対象スレッド
    (`threadId`) も渡し、資料ではそのスレッドを先頭に置いて印を付ける。
    `usePublishAgentSubject` に `undefined` を渡すと同じ View 内の別の公開元に任せる (Pipelines は実行詳細を開くと
    詳細パネルが、閉じると一覧が公開する)。
  - **文脈チップ (入力欄の直上に常時表示)**: 「Context」の後ろに、付いている文脈を実線の青いチップ、
    足せる文脈を点線の `+ <名前>` チップで並べる (`AgentContextChips`、ツールバー、タブ停止は 1 つ)。長いタイトルは省略する。
    対象のチップはピンのボタン (固定 / 固定を外す、行を移っても変わらない) と ✕ (対象なしで依頼) を持ち、✕ で外した後は
    点線の `+` チップになり、押すと選択に追従する状態へ戻る。キー: 入力欄から `Shift+Tab` でチップへ、
    `←` `→` で移動、`Space` / `Enter` で付け外し、`P` で対象の固定 (対象のチップ上)、`Esc` で入力欄へ戻る
    (パネルは閉じない)。付け外し後もフォーカスは同じチップに残る。
  - **依頼先エージェントとモデル (文脈チップと入力欄の間)**: `To [Claude] [Codex] [モデル ▾]` で、次の送信をどのエージェント・
    モデルで起動するか選ぶ (`AgentPicker`)。エージェントのラジオ (タブ停止 1 つ) の初期値は設定 `default_agent`。モデルの
    選択肢は `CLI default` (エージェント自身の設定に任せる)、Claude Code の別名 `opus` / `sonnet` / `haiku` (Claude のみ)、
    設定の `claude_model` / `codex_model`、設定の追加候補 (`*_model_choices`) で、初期値は設定のモデル (未設定なら
    `CLI default`)。エージェントを切り替えるとモデルはそのエージェントの設定値に戻る。送信 (新しい依頼・返信) が成功すると
    両方とも設定の値へ戻る。返信・Run now・下書きの送信も選択中のエージェント・モデルで起動する。キー: 入力欄から
    `Shift+Tab` でモデル、もう一度でエージェントへ、エージェント上で `←` `→` 切り替え、モデル上で `↑` `↓` 選択、`Esc` で
    入力欄へ戻る。Read-only 検証モードでは起動しないため出さない。
  - **「この一覧」の文脈**: View が `usePublishAgentListScope` で表示中の一覧 (`{ id, label, count, markdown }`) を公開すると、
    点線の `+ This list (N)` チップで足せる。既定では付かない。付いている間は送信時に `contextDocument` へ、選択項目の資料に続けて
    Markdown の表 (最大 200 行、超過は件数のみ) と有効なフィルタ / クエリの行を加える (対象なしでも一覧だけで送れ、`ask` の会話になる。
    front-matter の `context` には `This list (N)` を足す)。付いた状態は一覧の `id` に紐づき、別の View の一覧には引き継がない。
    公開元: My Reviews / My Pull Requests / PR Search (フィルタ後の PR 一覧とテキスト / 列フィルタ)、
    My Items / Followed / Work Item Search / Work Item Views のグリッド表示 (表示中の WI。Views は WIQL も。ボード表示は対象外)、
    Inbox (表示中の項目、Done / Snoozed の切替とテキストフィルタ)、Pipelines (`+ Pending approvals (N)`: 選択中プロジェクトの承認待ち)。
  - **会話の単位**: 対象が PR / WI なら従来の項目ごとのメモ (`agent-notes/{pr|wi}-{id}/`、結果フォルダの設定が前提)。
    それ以外 (パイプライン実行 / Wiki) と対象なしは依頼ごとの会話 (`target` = `ask`、`agent-notes/ask-{yyyyMMddHHmmss}/`、結果フォルダ不要)。
    パネルに出すのは今の対象についての会話だけ。対象が PR / WI ならその項目のメモだけで、依頼は出さない。
    それ以外の対象なら最近の依頼 30 件 (`list_agent_asks`) のうちその対象についての依頼 (front-matter の `context` で判定。
    パイプライン実行は結果で表示名が変わるため、Wiki と同じく URL で照合)、
    対象なしなら対象なしで送った依頼だけ (`contextIsAbout`)。見出しなしの 1 本の一覧にし、
    Needs you → Open → Done の順、各グループ内は最終更新の新しい順に並べる。他の対象への返信待ちは、それぞれの対象を開いたときの Agent パネルで扱う。
  - **依頼の種類**: 画面では選ばせない。新しいメモの `kind` は付けず (空)、エージェントが本文から判断する
    (`agent_notes/notes_guide.md`: WI / PR は引用があれば `fix`、無ければ結果の修正・やり直しの依頼か、質問・要約かで決める。
    `ask` は無ければ `question`)。既存メモの `kind` は展開した会話に表示するだけ。front-matter に
    `context` (対象を 1 行で) を書く。
  - **資料の受け渡し**: エージェントには Azure DevOps の権限を与えない。送信時に DevDeck が対象の情報を取得して
    Markdown にまとめ (`contextDocument.ts`: PR は説明・変更ファイル・コメントスレッド、WI はフィールド・説明・コメント、
    パイプライン実行はタイムラインと失敗ステップのログ末尾、Wiki はページ本文、「この一覧」が付いていればその表。最大 512 KiB)、`create_agent_note` の
    `contextDocument` として渡す。バックエンドは `{メモのフォルダ}/_context/{メモのファイル名}` に保存し、front-matter の
    `context_file` に絶対パスを書く。エージェントは `AZURE_CONFIG_DIR` を空のフォルダ (`agent-notes/.az-signed-out`) に
    向け、`AZURE_DEVOPS_EXT_PAT` などのトークン用環境変数を外した状態で起動するため `az` は未ログインになる。
    git は保存済み認証で fetch できるが、`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` で
    `url.devdeck-push-blocked://.pushInsteadOf` (`https://` / `ssh://` / `git@`) を与えて push 先を無効にする。
    既定コマンドは加えて `--disallowedTools "Bash(az:*)" "Bash(git push:*)"` を付ける。Windows 資格情報マネージャーの PAT は OS 上の
    読み取りまでは防げない。エージェントは WI / PR に直接投稿しない。投稿したい文面は下の「コメントの提案」で DevDeck に頼み、
    DevDeck が署名を付けて投稿する。
  - **コメントの提案と署名投稿**: エージェントは WI / PR のメモ (`ask` を除く) の末尾に `<!-- post {claude|codex} {時刻} -->`
    とその文面を追記して投稿を提案できる (`reply` マーカーの兄弟。`NoteReply.kind` = `post`)。Agent パネルは提案を破線枠の
    「Proposed comment」として署名のプレビュー付きで出し、会話選択中の `C` (または `Post (C)` ボタン) で投稿する
    (Read-only 検証モードでは投稿しない)。投稿は `post_agent_comment` (PR は `post_pull_request_comment` 相当、WI は
    `add_work_item_comment` 相当をプロバイダー経由で呼ぶ)。投稿先 (組織・プロジェクト・リポジトリ) はパネルが表示中の
    対象から渡し、メモの対象 (種別と id) と一致するものにだけ投稿できる (一致しなければ「対象を選んで」と拒否)。
    - **署名は DevDeck が必ず付ける**: 本文末尾に `— 🤖 Posted by Claude (via DevDeck)` / `… Codex …` を付与する。
      署名の名前は提案マーカーの作者 (`claude` / `codex`) で決まり、それ以外 (`user` など) の提案は投稿されない。
      エージェントが自分で書いた同じ署名は除いてから付け直す (二重にならない)。
    - **一度だけ投稿**: 投稿後、提案の直後に `<!-- posted {時刻} {thread-N|comment-N} -->` を DevDeck が書き (`postedAt` /
      `postedRef`)、`app-data/agent-notes/post-log.jsonl` に 1 行追記する。投稿済み、または同じ対象に同じ本文を投稿済みの提案は
      再投稿しない。投稿中の二重実行は拒否する。マーカー行 (`reply` / `post` / `posted`) を含む人の入力は拒否する。
    - **行コメントの提案**: PR のメモでは、提案マーカーに `file={パス} line={行}` を付けると (`<!-- post claude {時刻} file=/src/a.ts line=42 -->`、パスの空白は `%20`)、その行 (変更後の側) に新しいスレッドとして投稿する (`post_agent_comment` が `post_pull_request_comment` に `filePath` / `rightLine` を渡し、`threadId` は使わない)。投稿前に PR の変更ファイル (`list_pull_request_changes`) にそのパスがあるか確かめ、無ければ拒否する。パスは `/` 始まり・`..` を含まない・制御文字なし・1,000 文字以内、行は 1 以上で、片方だけ・WI のメモ・自動投稿はいずれも拒否する。Agent パネルでは「Proposed line comment」として、表示中の PR のメモなら Inbox と同じ部品 (`PrCodeSnippet`) で前後 5 行のコードと対象行を出す (別の PR を表示中・投稿後は `path:line` の 1 行)。承認 (`C` / Post ボタン) は通常の提案と同じ。`NoteReply` は `filePath` / `line` を返す。
    - **自動投稿 (設定 `agent_auto_post_enabled`、既定 off)**: on にすると、Agent パネルが表示中の WI / PR の会話に現れた
      未投稿の提案を、承認なしで 1 件ずつ `auto` 付きで投稿する (パネルを閉じている間・別の対象を表示している間は投稿せず、
      開くまで Needs you のまま待つ)。上限は 1 つの対象に 1 時間 3 件、全体で 1 時間 10 件。本文に `http(s)://` か `@` を含む提案は
      自動投稿せず、人が `C` で承認する。拒否された提案は自動では再試行しない。
  - **会話の表示**: 会話 (1 メモ + 返信) は PR のコメントスレッド (`PrThreadCard`) と同じ見た目で 1 件ずつ折りたためる。
    Done 以外は未解決スレッドと同じ琥珀の左線、Done は灰色の背景。見出し行の右端に状態ピル (`Needs you` 赤 / `Open` 琥珀 /
    `Draft` 点線 / `Done` 灰) を置く。畳むとアバター・1 行目 (Needs you は太字)・返信数・状態ピルの 1 行。展開すると見出し行は 1 行目の
    代わりに「You · 時刻 · 種類 · About 対象」を出し (1 行目は直下の本文と重複するため)、本文・引用 (最大 2 行)・返信を続ける。
    返信は PR コメントと同じくアバター + 投稿者 + 時刻の下に本文を字下げして並べる (エージェント名は紫)。
    キー一覧の `?` は入力欄の右上に置き、押したときだけキー一覧の行を出す。既定では Needs you と最新の 1 件だけ開き、Done は畳む。
    Agent のドック枠自体はスクロールせず、会話一覧だけをスクロールする。下部の入力欄は常に表示する。
    一括開閉のボタンは無い。ドック時はヘッダーを出さない (ドロワー時だけ「Agent」と閉じるボタン)。
  - **返信欄**: 展開した会話ごとに、その会話の末尾へ返信欄を置く (普段は 1 行に畳まれ、クリックか `R` で広がる。
    畳んだ会話には出さない)。下部の入力欄は新しい依頼専用で、返信先の切り替えは無い。返信欄の中のキーは返信欄のもので、
    一覧のキー (`X` / `P` / `↑↓` など) は効かない。`Ctrl+Enter` で送信、空のまま `Esc` でその会話の見出しへ戻る。
  - **送信**: 下部の入力欄は新しいメモを作り、`run_agent` で起動する (PR はリポジトリ名を渡す)。選択中のエージェントを `agent`
    (`claude` / `codex`)、モデルを `model` (空文字は CLI の設定のまま) で渡す。無ければ設定 `default_agent` と
    そのエージェントの設定モデルで起動する。会話の返信欄は
    `reply_agent_note` で追記して起動する。`Shift+Enter` (Run now) は新しいメモを作らず、選択中の会話 (なければ対象) のメモで起動する。
    Read-only 検証モードではメモの保存だけ行い、起動しない。
  - **キーボード**: `↑↓` 会話の移動、`→ ←` 開閉、`R` 選択中の会話の返信欄へ (閉じていれば開く)、`M` 新しい依頼の入力欄へ (他の View の
    コメント欄と同じ)、`X` Resolve / Reopen、`P` 対象の固定、`Shift+Enter` Run now、`Esc` 閉じる。入力欄から `Shift+Tab`
    で依頼先のモデル・エージェント、さらに戻ると文脈チップへ (上記)。キーのヒントは常時出さず、一覧の下の `?` (キーでも `?`) で開く。入力欄は他のコメント欄と同じく普段は 1 行に畳まれ、
    フォーカスで広がる。会話一覧が残りの高さを占め、入力欄はパネルの下端に固定する。長い会話では一覧だけスクロールする。`Ctrl+Enter` で送信、空のまま `Esc` で畳んで会話一覧へ戻る。ドック時はタブ名と重なる見出しを出さない。Inbox の `Q`、Result パネルの `a` (と Bot ボタン) は、このパネルをその項目を対象に開く。
  - **通知**: `useAgentNoteWatcher` は `ask` の要約も監視し、依頼への返信をデスクトップ通知する (クリックでパネルを開く)。
- **エージェントへの申し送り (Agent notes)**: 作業項目グリッドの Result パネル (調査結果 HTML) と
  PR (My Reviews / PR Search) の Result タブ (レビュー結果 HTML) に、調査・レビューを行う外部 AI
  エージェント向けのコメントを残せる (UI は共通の `AgentResultPanel`)。保存先はアプリデータフォルダ (SQLite と同じ
  `%APPDATA%\com.azdodeck.app`) 配下の `agent-notes/wi-{id}/{yyyyMMdd-HHmmss}.md` (1 メモ 1 ファイル、本文は Markdown)。
  結果フォルダには置かないが、対象 (WI / PR) の結果フォルダの設定は引き続き必須。front-matter は `target` / `id` /
  `created` / `kind` (`fix` 既定・`question`・`redo`) / `result_file` / `result_hash` (作成時の結果 HTML の指紋) /
  `quote` / `quote_prefix` / `quote_suffix` / `quote_offset` (空白除去後の本文での位置)。SQLite には保存しない。
  書き込みは一時ファイル → rename で行い、エージェントに書きかけを読ませない。
  - **フォルダ**: 直下の `.md` が未対応 (open)。`_done/` は対応済み、`_draft/` はユーザーの未送信下書き、
    `_trash/` は削除済み (1 日後に一覧取得時に消去)。エージェントは直下だけを読む。
  - **状態**: Open / Needs you / Done (+ 下書き)。Needs you は open かつ最後の返信がエージェントのメモ
    (質問・対応不能の報告)。エージェントは対応したら `resolved:` を追記して `_done/` へ移し、直した要素に
    `data-agent-note="{ファイル名}"` 属性を付ける。
  - **返信**: メモ本文の後ろに `<!-- reply {author} {ISO 時刻} -->` の行で区切って追記し、最初の区切りより前が元の本文
    (`agent_notes/replies.rs` が分割)。author は人なら `user` (「You」と表示)、エージェントは英小文字 1 語
    (`claude` / `codex` 等、旧形式の `agent` も可) で `@Claude` のように表示。ユーザーが Done のメモに返信すると open に戻す。
    front-matter の同じキーが複数あれば後の行を採用する。区切り行と同じ形の行を含む本文・返信は拒否する。
  - **コマンド** (`agent_notes/`): `list_agent_notes` / `create_agent_note` (`draft` で `_draft/` へ) /
    `delete_agent_note` (`_trash/` へ移動) / `restore_agent_note` / `reply_agent_note` / `update_agent_note`
    (本文編集はエージェントの返信前のみ、`anchor` で引用の付け替え) / `set_agent_note_status` (ユーザーによる Resolve /
    Reopen、Resolve は `resolved: Resolved in DevDeck`) / `submit_agent_note_drafts` / `summarize_agent_notes`
    (項目ごとの open / needsYou / drafts / done 件数と最終更新) / `run_agent` (`agent` が `codex` なら設定 `codex_command`、それ以外は `agent_command`。未設定なら各既定コマンドをシェルで起動 (Windows ではコンソールウィンドウを出さずバックグラウンドで実行)。`model` か設定のモデルがあればモデル指定を末尾に足す)。
    / `list_agent_asks` (依頼の会話一覧) / `post_agent_comment` (提案されたコメントを署名付きで投稿。下記)。入力は `target` (`work-item` / `pull-request` / `ask`) と `itemId` で、
    `pull-request` は `agent-notes/pr-{id}/` を使う (前提は `review_result_folder_path` の設定)。`ask` は結果フォルダ不要で、
    ガイドは `agent-notes/AGENTS.md` に置く (内容は下記「ガイド」と同じ)。`kind` は `fix` / `question` / `redo` /
    `investigate` / `summarize`。
  - **自動レビュー / 自動調査** (`auto_agent/`、設定 `auto_agent_enabled`、既定オフ): 組織の同期後、確認間隔 `auto_agent_interval_minutes` (既定 15 分) が過ぎていれば、My Reviews と My Work Items のキャッシュから対象を選び、既定のエージェント・モデルで `investigate` Note を実行する。1 回の確認・1 組織あたりの試行上限は `auto_agent_max_per_sync` (1〜10、既定 3)。全組織を通じて、自動実行は完了まで 1 プロセスずつ。他組織のバッチは待機し、同じ組織の重複待機は作らない。未試行・試行の古い項目を先に扱う。承認制 (`auto_agent_approval_enabled`) がオフのときは、起動直後の最初の確認から候補をそのまま自動実行する (保留しない)。起動時ダイアログ (`AutoQueueStartupGate`) は承認制オンで `held` な候補があるときだけ出る。ダイアログは、`held` な候補をすべて実行または Skip するまで閉じない (1 件だけ決めても残りは出続ける)。ここでの Skip はその起動中だけ有効で、localStorage には書かず、次の起動でまた選ばせる。新しく現れた項目と、履歴のある PR の追加 push 分も自動実行する。結果フォルダが未設定の種類は対象外。設定したフォルダが存在しない・フォルダでないときは、候補を空にせず `list_auto_queue` がエラーで知らせる。手で作った結果 HTML や notes フォルダのある項目は、履歴のある PR を除き、自動バッチでは起動せず Auto Queue で選ばせる。エージェントのワークスペースフォルダが設定されていれば、PR の自動レビューの直前に、そのリポジトリの浅いクローン (`git clone --depth 1`、`auto_agent/clone.rs`) を `{workspace}\{リポジトリ名}` に作り、PR の head commit へ進める (取得は利用者の git 資格情報で行い、プロンプトは出さない。失敗しても警告ログだけで、エージェントは資料だけで進む)。DevDeck が作ったクローンには `.devdeck-shallow` を置き、以後の実行でも head へ進める。印のない既存フォルダ (利用者自身のクローン) には触れない。WI の調査では作らない。自動実行の Note には、PR は観点 (正しさ → セキュリティ → テスト → 整合 → 保守性)・差分内に限る指摘・確信の低い指摘は `unverified`、WI は事実と推測の分離・コード未確認の明記を含める。設定画面は、自動実行が有効でワークスペースが空のとき警告を出す。人の未対応 Note やユーザーの返信がある項目は自動実行を止め、人の依頼を優先する。過去の自動失敗 Note は、新しい資料による自動依頼に置き換える。
    - **WI の対象**: 状態が `New` / `Active` / `To do` / `Doing` (大文字小文字は区別しない) で、最終更新 (`changed_date`) が 30 日以内の WI。日付が読めない WI は除外しない。結果 HTML が既にある WI、成功済みの WI は再実行しない。
    - **PR の対象と範囲**: 初回は非ドラフト・未投票 (`my_vote` が 0)・作成から 30 日以内の PR を対象とする。管理開始後は投票済み・30 日超でも追加 push を追い、ドラフト中は止める。初回は PR 全体をレビューする。既存の HTML や Note だけではレビュー済み commit を確定しない。次回からは、最後に全範囲のレビューを成功した source commit と最新 source commit の内容を直接比較する。force push も同じ 2 commit 間の差分を対象とする。追加差分で直った指摘は解消済みにし、無関係な以前の指摘は再確認済みとせず残して、結果 HTML を更新する。
    - **資料と網羅性**: REST で PR の説明・コメント・変更内容、WI のプレビューを集めて `_context/` に保存する。PR は離れた変更箇所を分け、行番号と前後 3 行を付ける。差分は最大 40 ファイル・350,000 UTF-8 bytes、資料全体は 480,000 bytes まで。差分を先に収め、上限・binary・取得不能による未確認箇所を明記する。部分レビューではレビュー済み commit を進めず、同じ head を自動で繰り返さない。追加 push があれば最後の完全成功 commit から比較する。コード変更・コメント提案はさせない。
    - **成功判定と再試行**: 終了コード 0、Note の `_done/` への移動、結果 HTML の新規作成または更新、差分資料に省略がないことがそろったときだけ成功とする。資料取得・起動・実行の失敗は記録し、5 分、10 分、20 分、40 分、以後最大 1 時間の待機後、次の確認時に再試行する。1 試行は 30 分でタイムアウトする。Windows の追跡プロセスは Job Object に所属させ、アプリ終了時も終了させる。再起動まで除外するリストは使わない。
    - **記録と表示**: 実行範囲の commit、成否、Note、終了コード、試行ごとの stdout/stderr ログをアプリデータ内の `auto-agent/{hex組織ID}/{hexリポジトリID}/pr-{id}.json` と隣接ログに記録する。WI はリポジトリ ID の代わりにプロジェクト ID を使う。失敗・部分レビューは管理側の返信として Agent パネルに出す。Note の新規作成・変更・完了を検知すると、該当 PR/WI の結果 HTML を再取得する。Note と結果 HTML の名前は従来の番号形式のため、他組織・リポジトリの同番号と衝突すると自動実行を止め、警告ログに残す。
  - **Agent Auto Queue** (設定 `auto_agent_approval_enabled`、既定オフ): オンにすると自動レビュー / 自動調査は自動では起動せず (`auto_agent::start` が何もしない)、候補を一覧にして人が選んだものだけ起動する。候補は自動実行の初回条件と同じ項目のうち、notes フォルダ・結果 HTML・自動実行の履歴のどれも無いものを全組織分、件数上限なしで返す (`list_auto_queue`)。1 件を選ぶと、エージェントに渡す資料の先頭 30,000 文字と全体の文字数・トークン見積 (文字数 ÷ 3) を返す (`get_auto_queue_preview`。PR の差分を REST で取るため、画面で選んだ 1 件ずつ取得する。変更が読めない PR は理由を返す)。選んだ項目は `run_auto_queue` が順にバックグラウンドで起動する (自動実行と同じ `runner::process_item` を通るので、増分レビュー・失敗時の再試行・履歴の記録も同じ。自動バッチとは同時に走らず、全組織で 1 つずつ)。スキップした項目は localStorage `azdodeck:autoQueue:skipped` に持ち (最大 500 件)、一覧から隠すだけでバックエンドは変えない (起動時ダイアログ内の Skip は除く)。別の組織・リポジトリが同じ番号の履歴を持つ項目を選ぶと、起動せず理由をエラーで返す。
  - **自分の WI を一括調査** (Work Items → My Items のツールバー「Investigate all」、`run_assigned_work_item_investigations`): 確認ダイアログの後、全組織の「自分にアサイン・状態 New/Active・30 日以内・notes フォルダ/結果 HTML/自動実行の履歴が無い」WI を、同時に 3 件まで並列で `runner::process_item` に流す (自動バッチ・Auto Queue の実行とは同時に走らず、全体で 1 バッチ)。戻り値は起動した件数 (0 件ならトーストで知らせる)。Investigate all も同じ分割ボタンで実行のエージェントを選べる。自動調査の設定 (`auto_agent_enabled`) には依存しない。
  - **選択した WI の調査** (Work Items の一覧で複数選択したときのバーの「Investigate」、`run_work_item_investigations`): 選んだ WI (組織・プロジェクト・ID・題名を画面から渡す。どのビューの WI でもよい) を、同時に 3 件まで並列で `runner::process_item` に流す。確認ダイアログは出さない。成功済み・結果 HTML のある WI は runner が飛ばす。Investigate は分割ボタンで、▾ のメニュー (Default agent / Claude / Codex、↑↓・Enter・Escape で操作) からその実行のエージェントを選べる (Default は設定の既定エージェント。モデルは設定の値。Default 以外はボタンに名前を表示)。選択バーは「選択数 | Snooze | Investigate | Edit」の区切りで並び、State / Assignee / Priority / タグの変更は Edit パネルにまとまる (開くと先頭の State に、Escape で閉じて Edit に戻る)。自動調査の設定には依存しない。
  - **選択した PR のレビュー依頼** (My Reviews で `I`、`run_auto_queue`): Shift+↑↓ で選んだ行 (未選択ならカーソル行) の PR を、確認ダイアログの後に、自動レビューと同じ `runner::process_item` へ 1 件ずつ流す。ダイアログは対象を最大 8 件列挙し、「Points to check」欄 (任意・2,000 文字まで) に気になる点を書ける。書いた内容は選んだ全 PR の Note 本文に引用で足され、エージェントは各点への所見を結果 HTML に書く (`run_auto_queue` の `focus`)。初期フォーカスはこの欄、Ctrl+Enter で依頼、Escape または Cancel で取り消し、閉じると一覧へフォーカスを戻す。モーダルで、背景のクリックでは閉じず、キーは背後のグリッドや全体ショートカット (`G` の移動チェーン、Ctrl+K など) に届かない (`aria-modal` のダイアログが開いている間は `G` チェーンを始めない)。増分レビュー・失敗時の再試行・履歴は自動レビューと同じで、前回レビュー以降に push が無い PR は runner が飛ばす。結果は結果フォルダに出る。完了はトーストで知らせる (件数は依頼した数で、飛ばされた分も含む)。自動レビューの設定 (`auto_agent_enabled`) には依存しない。
  - **失敗したパイプラインの自動調査** (設定 `auto_agent_pipelines_enabled`、既定オフ。Read-only 検証モードでは起動しない): アプリ全体で Watch 中のパイプラインを監視するフック (`usePipelineWatchNotifications`。デスクトップ通知とこの設定のどちらかがオンの間だけポーリングする) が、最新実行の終了を検知し、結果が `failed` (canceled / partiallySucceeded は対象外) なら依頼を作る。資料は Agent パネルと同じパイプライン実行の資料 (タイムラインと失敗ステップのログ末尾) に、失敗テストと直近の実行との比較 (`list_flaky_tests` のバッジと説明、エラーの 1 行目) を足したもの。依頼文はエージェントに先頭行 `Verdict: flaky | code | infra | unknown` で結論を出させ、ログやテストのエラーを根拠に挙げさせる (コード変更・再実行・コメント提案はさせない)。`kind: investigate` の `ask` として作り、`run_agent` で既定のエージェントとモデルで起動する。同じ実行は 1 回だけ、全体で 1 時間 5 件まで (localStorage `azdodeck:pipelines:autoInvestigated` に実行ごとの記録を 14 日・最大 200 件保持)。依頼 ID が秒単位の作成時刻なので、複数の失敗は 1 秒以上空けて順番に起動する。起動すると通知履歴に `pipelineInvestigationStarted` (表示は「Agent investigating」、Enter で Pipelines へ) を記録し、エージェントの返信は既存の「Agent replied on your request」通知で知らせる。会話は Agent パネルでその実行を対象にすると表示される (実行の URL で照合)。
  - **旧保存先からの移行**: 以前は結果フォルダ配下の `.to-agent-msg/{wi|pr}-{id}/` に保存していた。起動時と設定保存時に、
    両結果フォルダの `.to-agent-msg` から各項目フォルダをファイル単位で `agent-notes/` へ移す (移動先に同名ファイルがあれば
    上書きせず旧側に残す。空になったフォルダは削除)。何度実行しても同じ結果になる。失敗は警告ログのみ。
  - **エージェントの権限**: メモはエージェントが起動するフォルダ (ワークスペース / 結果フォルダ) の外にあるため、
    作業フォルダ外を制限するエージェントでは `agent_command` で許可を与える (Claude Code なら `--add-dir {notes} --add-dir {results}`。既定コマンドは付与済み)。
    許可が無いとメモを読めない・`_done/` へ移せないが、DevDeck 側にはエラーとして現れず未対応のまま残る。
  - **一覧と入力 (Agent パネルに統合)**: Result パネル横のメモ一覧と入力欄は廃止し、メモは Agent パネルに
    会話として並ぶ (状態点・本文は `#123` / `!45` をアプリ内リンクにする Markdown・返信)。下書き (以前の版で
    作られたもの) は「Draft」で表示し、入力欄の上の「n drafts not sent」バナーの「Send」で送ってエージェントを起動する
    (下書きがある時だけ出る)。展開した会話には
    操作ボタンを出し、一覧のキーと対応する: `Enter` 結果の該当箇所へ (Done はエージェントが `data-agent-note` を付けた
    変更箇所)、`L` 付け替え、`X` Resolve / Reopen、`Del` 削除 (`Ctrl+Z` で取り消し)。本文の編集は無く、返信で補う。
  - **Result パネル**: 結果 HTML とピンだけを表示する。上端に「C で選択範囲についてエージェントに頼める」旨の案内、
    Needs you / Open の件数、Agent パネルを開くボタン (`a`) とブラウザで開くボタン (`o`)。テキストを選択して Comment
    (またはブロック選択で `C`) を押すと、引用付きで Agent パネルが開き、入力欄にフォーカスする (引用付きのメモは `kind` 空 = `fix` として扱う)。
    引用は入力欄の上に「Quoting」として出て、× で外せる。ピンを押すと結果の該当箇所を示し、Agent パネルでそのメモを選ぶ。
    Agent パネルからの「結果の該当箇所へ」「付け替え」は window イベント (`devdeck:agent-note-reveal` /
    `devdeck:agent-note-reattach`) で Result パネルに届く。付け替え中は次の選択でそのメモの引用を差し替え (`Esc` で中止)。
  - **結果 HTML の読み込み**: PR / Work Item 共通で最大 5 MiB。超過時は本文を IPC / iframe に渡さず、外部ブラウザで開くボタンと既存の `o` キーを提供する。BOM を優先し、先頭 8 KiB の meta charset / http-equiv Content-Type 宣言を使ってデコードする。宣言がなければ UTF-8。未知の文字コードや不正なバイト列は置換して注記を表示する。
  - **結果との連携**: 結果 HTML 上のテキスト選択 (Comment ボタン) またはキーボードのブロック選択で引用付きコメントを作れ、
    引用は空白を無視したテキスト + 前後 24 文字の文脈 + 位置で再アンカーする。ハイライトは CSS Custom Highlight API、
    番号ピン (左余白、状態の色: Needs you 赤・Open 黄・下書き点線) とスクロール位置マーカー (右端) は親ドキュメント側に描画し、
    結果 HTML は書き換えない。iframe は `sandbox="allow-same-origin"` (スクリプト無効) のため、スクロールと選択は親から
    ポーリングで監視する。結果 HTML 内の `http(s)` リンクは既定のブラウザで開く。
  - **グリッドと通知**: My Reviews / My Work Items の行のタイトル横に open メモ数のバッジ (Needs you があれば赤、
    未読のエージェント返信があれば太字)。App 直下の `useAgentNoteWatcher` が `summarize_agent_notes` を 5 秒ごとに取得し、
    変化した項目のメモ一覧を即時再取得、エージェントの返信・完了をデスクトップ通知する (`desktop_notifications_enabled` に従い、
    初回取得は基準のみ)。メモ一覧自体の定期再取得は 60 秒 (保険)。
  - **ガイド**: 起動時と設定保存時、結果フォルダの `AGENTS.md` に DevDeck 管理区間
    (`<!-- devdeck:agent-notes:start ... -->` 〜 `end`、メモの場所は
    `agent-notes` の絶対パスで書く) を置く / 更新する。
    ファイルが無ければ作成、区間があれば区間だけ差し替え、旧版 (区間なし) の DevDeck 製ガイドは全体を置き換え、
    それ以外の既存 `AGENTS.md` は変更しない。配置失敗は警告ログのみ。
    ガイド本文 (Note の置き場所・形式・`kind` ごとの対応・返信の書き方・終え方・禁止事項) の元は
    `agent_notes/notes_guide.md` の 1 ファイルだけで、`AGENTS.md` には対象 (WI / PR / ask) とメモの場所の 1 行を前に付けて書く。
    返信は 3 行以内・結論先頭で書くよう指示する (細い Agent パネルで読めるようにするため。詳細は結果 HTML / ファイルに書く)。
  - **Skill (`devdeck-notes`)**: 同じ時点で、同じガイド本文を Claude Code / Codex の skill として
    `{CLAUDE_CONFIG_DIR または %USERPROFILE%\.claude}\skills\devdeck-notes\SKILL.md` と
    `{CODEX_HOME または %USERPROFILE%\.codex}\skills\devdeck-notes\SKILL.md` に置く / 更新する (`agent_notes/skill.rs`)。
    設定フォルダ (`.claude` / `.codex`) が無いエージェントには置かない。DevDeck 製の印
    (`<!-- devdeck:managed ... -->`) が無い既存の `SKILL.md` は変更しない。配置失敗は警告ログのみ。
  - **結果 HTML の書式** (`agent_notes/result_format.md`): skill は置かず、WI / PR の結果フォルダの `AGENTS.md`
    (管理区間) にだけ書く (ask の `AGENTS.md` には書かない)。エージェントは起動時に `AGENTS.md` を読むよう指示される。
    自動実行の依頼文 (`auto_agent/context.rs`) も `AGENTS.md` の節を指す。以前置いていた skill `devdeck-result-html` は、
    DevDeck 製の印がある場合に限り起動時に削除する (印が無いユーザーの `SKILL.md` は残す)。ファイル名は `PR{番号}.html` / `WIT{番号}.html`、
    並びは結論 → ポイントの図 → 本文 → 根拠 → 未確認 → (PR のみ) 畳んだ指摘の下書き、見出しの番号は対象 PR / Work Item への
    リンク、図はインライン SVG (プレビューは JavaScript・外部ファイル不可)。PR の指摘の場所 (指摘一覧・根拠の `file:line`) は
    PR の Files タブへのリンクにする (`{PR の URL}?_a=files&path=…&line=…&lineEnd=…`。追加ファイルでは該当行が強調される)。
    行が決められないときは `line` 系を付けない。材料が分からないときは推測せず文字だけにする。
    ガイドと自動実行の Note は、結果 HTML をこの書式で書くよう指示する。
- **作業項目の新規作成**: My Work Items の「New item」ボタン、テンプレート適用
  (`WorkItemTemplatesPanel`)、またはプレビューの Duplicate (`D` キー / ヘッダーボタン) から
  作成ダイアログを開き、プロジェクト・種別 (`list_work_item_types`)・タイトル・説明・
  担当者・優先度・エリア/イテレーション (`list_classification_nodes`)・タグを指定して
  `create_work_item` で作成する。作成後はローカルキャッシュへ即時反映し関連クエリを
  invalidate する。ダイアログはキーボード完結 (タイトルへ初期フォーカス、Ctrl+Enter 送信、
  Escape キャンセル、閉じたら呼び出し元へフォーカス復帰)。
- **クエリ取得の待機上限**: 作業項目のプロジェクト一覧・ビュー実行・件数取得は、ロックや通信の待機を含めバックエンドで 120 秒で打ち切る。フロントエンドも IPC 応答を 125 秒でタイムアウトにし、読み込み状態を解除する。Views のプロジェクト一覧・ビュー実行・件数取得は自動リトライせず、ビュー実行のエラーから Retry で再実行できる。IPC 側のタイムアウトだけではバックエンド処理はキャンセルされない。
- **ビュー編集ダイアログ (WIQL エディタ)**: Azure DevOps のクエリ URL 貼り付けによる自動補完
  (Org / Project / WIQL) に加え、WIQL 入力欄 (`WiqlEditor`) は次を備える。
  - **構文ハイライト**: `tokenizeWiql` の結果を色付き `<pre>` として textarea の背後に重ねる
    オーバーレイ方式。textarea 側の文字は透明にしキャレットのみ表示するため、補完・カーソル
    位置取得・IME といった既存の textarea の挙動をそのまま保つ。外部依存は追加しない。
  - **補完のキーボード操作**: `Ctrl+Space` で開閉し、`↑` `↓` で候補選択、`Enter` / `Tab` で確定、
    `Escape` で閉じる (ダイアログは閉じない)。候補は `role="listbox"` の縦リストで、選択中候補を
    `aria-activedescendant` で示す。`Ctrl+Enter` は候補一覧が開いていてもフォーム送信として通す。
  - **整形**: 「Format」ボタンまたは `Shift+Alt+F` で `formatWiql` を適用し、句 (SELECT / FROM /
    WHERE / ORDER BY / GROUP BY / ASOF / MODE) を行頭へ、WHERE 内の `AND` / `OR` をインデント付きの
    行頭へ配置し句キーワードを大文字化する。引用文字列と `[...]` のフィールド参照は退避してから
    整形するため、`'To Do And Review'` のような値やキーワードを含むフィールド名は変化しない。
    `ASC` / `DESC` などユーザーが書いた値は大文字化しない。
  - **Test run**: 「Test」ボタン (WIQL 欄の上のマクロチップ行の右端) で `count_work_item_query` のみを実行し一致件数を表示する
    (保存もダイアログを閉じることもしない)。WIQL 未入力・`validateWiql` エラー・プロジェクト未選択は
    バックエンドを呼ばずにその場でエラーを返す。結果は WIQL 編集で破棄し、実行が競合した場合は
    最新の実行結果のみを反映する。
  - **レイアウト**: 上から「入力方法のタブ (Paste URL / From existing query / Build conditions)」→ Name・Project →
    WIQL (マクロチップ + Test + Format / Expand) → 折りたたみの「Advanced settings」→ Cancel / Save。
    タブは `role="tablist"` で `←` `→` `Home` `End` により切替 (フォーカスはタブに残り、クリック時は
    パネルの入力欄へ移る)。初期は Paste URL でその入力欄にフォーカスする。「Advanced settings」
    (`ViewAdvancedSettings`) は Limit / Auto refresh / Alert when count / Extra columns を収め、
    閉じた状態でも現在値を 1 行 (`Limit 200 · Refresh off · Alert off · Columns 0`) で示す。
    `Enter` / `Space` で開閉し、Limit・Auto refresh・Alert のエラーで保存に失敗したときは自動で開く。
  - **サイズ**: ダイアログ幅は既定 `max-w-2xl`、WIQL 欄の「Expand」で `max-w-4xl` + 18 行に拡大し、
    「Shrink」または展開中の `Escape` で戻る。
  - **Azure DevOps クエリのインポート** (「From existing query」タブ): 選択中プロジェクトの
    クエリ階層 (Shared Queries / My Queries) を `list_project_queries` で動的に取得し、
    フィルタ入力付きのリスト (フォルダパス + 名前を空白区切りの AND・大文字小文字無視で
    絞り込み。日本語可) から選択できる。↑/↓ で移動し Enter で確定 (IME 変換中の Enter は
    無視)、Escape はフィルタが空でなければクリアのみ行う。選択すると WIQL を
    常に上書きし、Name は未入力の場合のみクエリ名で補完する (保存は別途「Save」操作が必要)。
  - **条件グリッド** (「Build conditions」タブ, `ViewConditionGrid` / `wiqlConditions.ts`): WIQL の
    WHERE 句を「And/Or・Field・Operator・Value」の行として表示し、行の編集は WHERE 句だけを書き換える
    (SELECT / ORDER BY / ASOF は文面のまま)。グリッドは毎回 WIQL から組み立てるため、WIQL 欄を手で
    編集しても行に反映される (双方向)。括弧グループ・`NOT` 前置・`EVER`・フィールド同士の比較・
    リンククエリ (`[Source].[...]`) を含む WIQL は行にできず、理由を表示して WIQL 欄での編集を促す。
    Field は選択中プロジェクトのフィールド一覧 (`list_work_item_fields`) を候補に出す入力欄、Operator は
    フィールド型で絞った選択肢、Value は `@Me` / `@Today - 7` などのマクロ・数値・文字列 (`IN` / `NOT IN`
    はカンマ区切り) を受け付ける。文字列型のフィールドの値は数字でも引用符で囲む。「Add condition」で
    `[System.Title] CONTAINS ''` の行を追加してその Field 欄へ、行末の × で削除して隣の行へフォーカスを移す。
    タブを開くと先頭行の Field 欄 (行が無ければ「Add condition」) にフォーカスする。
- **作業項目の一括操作**: 複数項目の状態変更・割当・優先度設定をまとめて適用。
- **作業項目編集**: state / assignee / priority / フィールドをステージし 1 リクエストで適用。
  タイトルはプレビューヘッダーからインライン編集し即時適用 (System.Title を `update_fields` で更新)。
  @メンション付きコメント、フィールドプリセット。投稿済みコメントはプレビューから
  インライン編集・削除が可能 (`update_work_item_comment` / `delete_work_item_comment`)。
  インライン編集欄でも新規投稿と同じ @メンション候補 (オートコンプリート) を表示する。
  Work Item / PR のコメント入力欄は縦方向にリサイズでき、種別ごとの高さを localStorage に
  保存してビュー再訪時に復元する。
  プレビューの Links から work item リンク (Parent/Child/Related/Predecessor/Successor) を
  ID 指定で追加・削除できる (`add_work_item_link` / `remove_work_item_link`)。
- **PR 完了オプション**: complete 時にマージ戦略・ソースブランチ削除に加え、関連 work item を
  次状態へ自動遷移する `transitionWorkItems` を指定できる (`update_pull_request` の complete アクション)。
- **メンションの名前解決**: コメント内の `@<GUID>` は、既知の名前 (Work Item のコメント投稿者・直前に選んだ人)
  で置換し、残りの GUID は `resolve_mention_identities` (vssps `_apis/identities?identityIds=`、最大 50 件) で
  表示名に引く。結果はセッション中キャッシュする (`useMentionIdentityNames`)。Work Item のコメント、Inbox の
  Work Item コメント / PR スレッド / 説明、PR のスレッド / 説明が対象。引けない GUID は `@<GUID>` のまま表示する。
- **PR レビュアー管理**: レビューパネルから既存レビュアーの必須/任意切替・削除に加え、
  レビュアーの追加ができる。「Add」は @メンションと同じディレクトリ検索 (`search_pull_request_mentions`、
  2 文字以上、既存レビュアーは除外) の候補を `↑↓` で選び Enter で追加 (「Required」で必須指定、Esc で閉じて
  「Add」へフォーカスを戻す)、「Add me」はサインイン中のユーザーを即追加する (自分が既にレビュアーなら出さない)。
  追加は `add_pull_request_reviewer` (レビュアー endpoint の upsert を投票 0 で呼ぶ。`reviewerId` 省略で本人)。
  GitHub 接続ではレビュー依頼 (`requested_reviewers`) として扱い、必須フラグは無視する。
  (`add_pull_request_reviewer` / `set_pull_request_reviewer_required` / `remove_pull_request_reviewer`)。
- **PR ラベル**: レビューパネルのヘッダーに PR のラベル (有効なもののみ) をチップ表示し、「Label」から名前を入力して Enter で付与、各チップの X で削除できる (`add_pull_request_label` / `remove_pull_request_label`、`get_pull_request_review` の `labels`)。Esc で入力を取り消し「Label」へフォーカスを戻す。重複 (大文字小文字無視)・空の名前は送らない。書き込み系のため read-only 検証モードでは拒否する。GitHub 接続は未対応。一覧 (グリッド) のラベル列とラベルによる絞り込みは、ラベルが同期キャッシュに載っていないため未対応。
- **PR 編集**: ライフサイクル操作 (abandon / reactivate / publish / draft / complete、`update_pull_request`) に加え、
  レビューパネルからタイトル・説明をインライン編集できる (`update_pull_request_details`)。
- **PR 操作**: レビューパネルから publish / Convert to draft (`draft` アクション、Azure DevOps のみ。
  GitHub は未対応でエラー) / complete / abandon に加え、自動完了 (auto-complete) の
  有効化・解除が可能 (`update_pull_request` の `enableAutoComplete` / `cancelAutoComplete` アクション、
  マージ戦略を指定。`get_pull_request_review` が `autoComplete` 状態を返す)。
  プレビューに添付ファイル (`AttachedFile` リレーション) を一覧表示しブラウザでダウンロード可能。
  エリア/イテレーションパスはプレビューの分類ツリーピッカー (`list_classification_nodes`) から
  選択して即時適用 (System.AreaPath / System.IterationPath を `update_fields` で更新)。
  コメントには絵文字リアクション (like/heart/hooray/smile/confused/dislike) を表示・付与・解除できる
  (`set_work_item_comment_reaction`)。絵文字ピッカーはキーボードで完結し (開くと先頭の絵文字に
  フォーカス、↑↓←→ で移動、Enter/Space でトグル、Escape で閉じてトリガーへフォーカスを返す)、
  自分が付けたリアクションはチェックバッジとリングで明示する。リアクション追加ボタンはコメントの著者行の右端に
  置き、ホバーまたはキーボードフォーカス時だけ表示する。付与済みリアクションがあるときだけその行を出す。
  コメントは枠や見出し帯を持たず、区切り線で並べる。Description / Acceptance Criteria の本文も枠線なしで
  セクションの青帯の下に表示する。プレビューの文字はタイトル 17px・本文 13px。
  Description と Comments の見出し帯は他のセクションより一回り大きい (サイズで強弱を付ける)。
  フィールドのピルは State / Assigned / Priority だけを常時表示し、残りは「+N」で開く
  (開閉は `azdodeck:wiPreview:fieldsExpanded` に保存。畳んだピルは CSS で隠すだけでアンマウントしない)。
  ピルのショートカット表示 (S/A/P/R など) はホバーまたはフォーカス時だけ出す。トグル後もピッカーは開いたままで、
  付与/解除の結果がその場で分かる。コメント取得は `$expand=all` を使い、リアクションに加えて
  サービス側でメンションを表示名へ解決した `renderedText` を受け取る。これによりプレビューが
  `@<guid>` の生 id を表示したり、サニタイズで欠落させたりしない。解決名が無い場合でも未解決
  トークンはエスケープして可視テキストとして残す。

---

## 4. 認証とシークレット

- **プロバイダ種別**: 各接続は `provider_kind` を持つ (`azdo` または `github`)。既定は `azdo`
  で、既存接続は無変更で動作する。詳細は `docs/design/05-provider-abstraction-and-github-mode.md`。
- **認証プロバイダ**: `auth_provider` は `pat` / `azure_cli` (アンダースコア形) / `github_pat`。
  - **組織名の入力 (Azure DevOps)**: 組織名のほか、貼り付けた組織 URL (`https://dev.azure.com/{org}/...` / `https://{org}.visualstudio.com/...`、`dev.azure.com/{org}` のようなスキーム省略形、末尾 `/`) から組織名を取り出して小文字に正規化する。それ以外のホストの URL は例付きのエラーにする。`base_url` はどの入力でも `https://dev.azure.com/{org}`。
  - **PAT (Azure DevOps)**: `Authorization: Basic base64(":{pat}")`。必要スコープは Code(Read)/Work Items(Read)/Project and Team(Read)。
  - **Azure CLI**: `az account get-access-token` を実行し Bearer トークンを取得。メモリにキャッシュし、CLI 報告の `expires_on`/`expiresOn` から算出した有効期限の 60 秒前まで再利用する (取得できない古い CLI では 5 分の固定 TTL にフォールバック)。`az` の 1 回の実行は 30 秒でタイムアウトし (固まった `az` が全リクエストを止めないよう取得ロックを解放)、REST が 401 を返したらキャッシュを破棄して 1 回だけ再送する。
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
  **現行スキーマバージョン: 31** (v31 で Inbox の「返信が来なければ再通知」用に `reply_reminders` を追加、v30 で Inbox の会話単位の一意インデックスを `pr_group_mention` / `wi_reply` を含む種別で作り直し、v29 で自作 PR のマージ可能判定・通知済み状態を保存する `pr_merge_readiness` を追加、v28 で My Pull Requests 用に `pr_reviewer_counts` (PR ごとの承認数・レビュアー総数) を追加、v27 で Inbox を会話ごとに 1 行にし、`action_inbox_items.hit_count` と会話単位の一意インデックスを追加、v26 で Inbox 項目ごとの Claude の判断メモ `action_inbox_insights` を追加、v25 で Inbox 項目にコメント位置 `action_inbox_items.file_path` / `line` を追加、v24 で Inbox 用の `action_inbox_items` / `action_inbox_cursor` を追加、v23 で Commits ビュー廃止に伴い `commits` / `commits_fts` / `commit_prs` と commit 同期の `sync_state` 行を削除、v22 でコミットの committer 名/メール/日時 `commits.committer_*` を追加、v21 でフォロー中の作業項目 `followed_work_items` を追加、v19 で通知履歴用の `notifications` テーブルを追加、
  v20 で `pull_requests.created_by_id` を追加)。
- 主なテーブル: 組織、アクティブ/レビュー対象 PR、作業項目、My Work Items スナップショット、
  各種 FTS インデックス、同期状態、スヌーズ、
  フォロー中の作業項目 (`followed_work_items`)、PR コメント既読、メンション/割当先履歴、通知履歴 (`notifications`)、Inbox (`action_inbox_items` / `action_inbox_cursor` / `action_inbox_insights`)、アプリ設定。
- ジャーナル: WAL、`synchronous=NORMAL`、外部キー ON。
- **共有キャッシュ (`shared_cache/`)**: `azdodeck.sqlite3` 自体は DevDeck 専用で、外部からは
  読まれない。別アプリ waypoint (`C:\Users\<user>\source\repos\waypoint`) が同じ Azure
  DevOps 組織を独立にポーリングするのを避けるため、Active PR (+レビュアー一覧) と
  Work Item を同期成功のたびに中立な第三の SQLite ファイル
  (`%APPDATA%\AzDoSharedCache\cache.db`) へ書き込む (`prs/sync_fetch.rs` /
  `work_items/sync.rs`)。Active PR の同期前にはこの共有キャッシュが直近 (waypoint 側で)
  更新済みでないか確認し、更新済みならその内容を読んで自分の API 呼び出しをスキップする。読み込み時は API 取得時と同じ短いブランチ名へ正規化し、PR の Web URL は組織・プロジェクト・リポジトリ名・PR 番号から再構築する
  (`shared_cache::is_fresh`)。ただしユーザーの明示的な更新 (Ctrl+R / Sync now / 設定の同期ボタン。`trigger_sync` の `force: true`) ではこのスキップを行わず必ず API を取りに行き、結果を共有キャッシュへ書き戻す (起動時・ウィンドウ復帰時の Hot 同期と定期同期は従来どおり共有キャッシュを優先)。共有スキーマは DevDeck 自身のテーブル形と無関係な独立の契約
  (Azure DevOps の生の事実のみ、is_mine 等の per-viewer 判断は持たない) なので、
  `pull_requests` / `work_items` 自体の列を変更しても `shared_cache` 側のマッピングさえ
  追従させれば waypoint 側は壊れない。Work Item は書き込みのみで読み取りゲートは持たない
  (差分/フル同期の込み入った既存ロジックに読み取りスキップを組み込むリスクが高いと判断)。
  接続 (組織) を削除したときは、その組織の PR / レビュアー / Work Item / 同期状態の行も
  共有キャッシュから削除する (ベストエフォート。失敗しても接続の削除は成功扱い)。

### 同期ループ (`sync.rs`)

- スコープ: `All` / `Hot` (MyReviews + MyWorkItems の高速更新) / `MyReviews` / `MyWorkItems`。コミットは同期しない (Commits ビューは API 負荷削減のため廃止)。
- 間隔: フル同期は約 5 分間隔。起動時とウィンドウ復帰時は Hot 同期 (復帰はスロットル)。手動トリガは間隔を無視。
- 並列実行: 1 パス内で全組織を並列処理し、各組織の PR / 作業項目同期も並列に走らせる。
  プロジェクト一覧 (`_apis/projects`) は組織ごとに 1 回だけ取得して両種別で共有する。
  PR コメント通知のスレッド取得も同じ共有セマフォを通る。
  同時実行中の Azure DevOps リクエスト総数は共有セマフォ (`SyncBudget`, 既定 12) で上限を設け、
  ファンアウトが広がっても 429 圧力を一定に保つ (429 は `Retry-After` で吸収)。
- My Reviews の対象: `searchCriteria.reviewerId` は直接指名されたレビュアーにしか一致しないため、自分が所属するグループ/チーム (vssps `identities` の `queryMembership=Expanded` で取得し 1 時間キャッシュ) 宛てのレビュー依頼は、active PR 一覧のレビュアーとグループ ID を突き合わせて補完する (投票は 0。投票済みなら直接レビュアーとして取得済み。この補完が有効な間は共有キャッシュの短絡を使わず live で取得する)。所属グループを取れなかった場合は同期を失敗させず、Sync health の警告に記録し、以前取得できたグループ一覧が残っていればそれで続行する。active PR 一覧が上限 (`PROJECT_PR_SYNC_TOP`) に達したプロジェクトでは一覧が欠けるため、グループ ID ごとに `searchCriteria.reviewerId` で取得してレビュー対象を補完する (`prs/group_reviews_capped.rs`。1 件でも失敗したプロジェクトは前回の行を保持して警告に記録する)。`reviewerId` / `creatorId` の `$skip` ページングは、サーバーが `$top` より少なく返しても打ち切らず、空ページまで進める (`$skip` は実際に返った件数ぶん進め、重複は除く)。
  レビューキャッシュはプロジェクト単位で置換し、取得に失敗したプロジェクトだけ前回の行を保持する (1 プロジェクトの失敗で一覧全体が古いままにならない)。保持上限は 5000 件。
  ドラフトは既定で非表示だが、件数をタブ帯の Show Drafts チェックボックスに出し、チェックで表示する。
- PR 同期: active PR とレビュー対象 PR の取得を重ね合わせ、CI ステータスは最新 50 件を後段で付与。
  active PR のプロジェクト単位クエリまたは共有キャッシュが上限 (500 件) に達したプロジェクトも同様に、そのプロジェクトの既存キャッシュを
  削除せず取得分だけ upsert し、警告を記録する (レビュー対象 PR は `$skip` で全件ページングするため対象外)。
- 作業項目同期: プロジェクト単位で並列。`System.ChangedDate` デルタ取得 (24h ごとにフル) は維持。
  200 件超の ID は 200 件ずつバッチ取得するだけで欠落しないため警告しない。WIQL の取得上限 (2000 件) に達した
  プロジェクトは取得結果が切り詰められているため、フル同期でもそのプロジェクトの既存行を削除せず、本体・共有キャッシュともにマージ
  (`apply_work_items_delta` 相当) し、「上限より古い項目は更新されない (キャッシュ行は保持)」旨を `last_warning` に
  記録して Sync health で「Limited」(完了したが一部スキップ/切り詰めあり) と表示する。
- イベント: 同期完了で `sync:updated` (org_id + 完了スコープ)。
  通知イベントは PR / 作業項目向けに別途 emit。
  Inbox に項目が増えた / 自動で Done になった場合は `action-inbox:updated` (空ペイロード) を emit する。
- 通知履歴: ルール/スヌーズ/種別トグルを通過した通知 (PR・作業項目・同期失敗) は
  `notifications` テーブルに記録してから既存イベントを emit し、続けて
  `notifications:inbox-updated` (空ペイロード) を emit する。記録は
  `desktop_notifications_enabled` に関係なく行い、DB エラーは同期を止めず警告ログのみ。
  `list_notifications` / `get_unread_notifications_count` / `mark_notifications_read` /
  `mark_all_notifications_read` / `record_notification` の各コマンドで参照・既読管理する。
- デスクトップ通知: 設定が有効な場合のみ。組織の初回同期 (そのスコープで一度も同期が完了していない状態) では過去分を通知しない。同期済みであれば、レビュー待ち/担当が 0 件の状態からの最初の依頼・アサインも通知する (スナップショットの空/非空では判定しない)。
  スヌーズ対象は通知から除外。コメント返信は `pr_comment_seen` で追跡。
  通知が 4 件以上のときは 1 件の要約通知にまとめ、本文は先頭 3 件 + 「+N more」とする。要約通知のクリックは
  DevDeck ウィンドウを前面化し (`core:window:allow-show` / `allow-unminimize` / `allow-set-focus`)、PR は My Reviews、
  作業項目は My Work Items へ遷移する (ブラウザプレビューなど遷移手段が無い場合のみ先頭項目の URL を開く)。
  Quiet hours が有効な間は通知の送出 (`desktopNotifications.ts`) のみ抑止し、フロントのローカル
  時刻で判定する。同期・キャッシュ更新・`sync:updated` は継続するため、アプリ内バッジ・ビューは
  最新のまま。
- **自作 PR のマージ可能通知** (Azure DevOps): PR 同期で自分が作成した active PR ごとに
  最新 PR 詳細とページングした policy evaluations を取得する (共有同期セマフォを使用)。
  Draft ではなく `mergeStatus=succeeded`、必須レビュアー全員が承認 (vote 5 または 10)、
  有効・必須・未削除ポリシーがすべて `approved` / `notApplicable` の場合に `readyToMerge=true`。
  必須ポリシーには CI を含み、取得失敗・不明状態は Ready としない。
  My Pull Requests の Title 列に Ready to merge バッジを表示する。
  初回に Ready と判定した時も通知対象とし、組織・リポジトリ・PR ごとの通知済みフラグと
  通知履歴 (`prReadyToMerge`) を同一トランザクションで保存する。再起動や Ready 再到達でも
  一度通知した PR は再通知しない。ミュート・allow 条件 (`readyToMerge`)・スヌーズに従い、
  Quiet hours / デスクトップ通知無効中は履歴とバッジのみ更新する。専用の種別トグルは設けず、
  通知ルールでミュートできる。通知履歴の Enter / クリックは対象 PR を開く。Ready 通知だけの要約は My Pull Requests、
  レビュー通知との混在要約は Notifications を開く。
- 通知ルール (`notification_rules`): 種別/プロジェクト/リポジトリ条件で通知を絞り込む。
  `mute` ルールは一致する通知を抑止し allow ルールより優先するため、特定の
  プロジェクト/リポジトリを個別にミュートできる（allow ルールが無ければミュート以外は通知）。
  プロジェクト/リポジトリ名は UI 上で候補選択ではなくカンマ区切りの自由入力であり、
  Azure DevOps 側もこれらの名前を大文字小文字を区別せずに扱うため、照合は
  `eq_ignore_ascii_case` で行う（PR 検索のターゲットブランチ照合と同様）。種別 (`types`) は
  チェックボックス由来の固定値なので完全一致で照合する。
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
- 1 ページで打ち切られる一覧 (プロジェクト一覧 `_apis/projects`、ブランチ一覧 refs) は `$top=1000` を明示し、
  `x-ms-continuationtoken` ヘッダーの継続トークンを辿って最後まで取得する (`list_all_pages`)。
  これにより 100 件超のプロジェクトも同期対象から外れない。
- 401: 即時 `Unauthorized`。429: `Retry-After` を尊重 (上限付き)。
  全 `AdoClient` 呼び出しはエンドポイント (host:port) ごとのプロセス共通スロットル (`client/throttle.rs`) を通る: 同時実行は最大 8 件、429 の `Retry-After` や成功応答の `X-RateLimit-Delay` を受けたら以降の全リクエストを一時停止する (最大 30 秒)。キャッシュ消去直後に各画面が一斉再取得しても Azure DevOps のレート制限に達しにくくする。5xx/タイムアウト/ネットワーク: リトライ。
  副作用のある POST は 5xx/タイムアウトを再試行せず (429 と接続失敗のみ)、WIQL・バッチ取得・検索など読み取り専用の POST (`post_json_read` / Almsearch) は GET と同様に再試行する。
- Azure CLI 認証は Windows では `cmd /C az` (`CREATE_NO_WINDOW`) 経由で起動する (`az` は `az.cmd` のため `Command::new("az")` では解決できない)。 `az` 未インストール時は `cmd` が終了コード 9009 を返すため、インストール案内メッセージに読み替える。
- `azdo-client` は Tauri 非依存を維持し、`wiremock` でテストする。

### `azdo-client` モジュール構成

`git` (PR/コミット/リポジトリ)、`work_items`、`pipelines`、`code_search` (アプリからは未使用)、
`pr_review` (スレッド/コメント/差分)、`pr_status` (CI 集約)、`wiki` (Wiki 検索/ページ)、`policy` (ブランチポリシー)、`project_info` (チーム/サービス接続/サービスフック)、`identity`、`auth`、`client`、`error`。

---

## 6. アプリ設定 (AppSettings)

| 設定 | 内容 |
|---|---|
| `review_result_folder_path` | レビュー結果 HTML を格納するフォルダ。My Reviews のプレビューが語頭の `PR<番号>` (ゼロ埋め可、`apr12` のように英字が前に付くものは除外) を含むファイルを照合。複数該当する場合は更新日時の新しいものを採用。 |
| `work_item_result_folder_path` | 作業項目の調査結果 HTML を格納するフォルダ。Work Item Views のプレビューが作業項目 ID の数字列 (先頭・区切り文字の後・`WIT`/`WI`/`WORKITEM` の後。`YYYY-MM-DD` の日付や `v2` のような語中の数字は除外) を含むファイルを照合。複数該当する場合は更新日時の新しいものを採用。 |
| `show_window_hotkey` | ウィンドウを前面化するグローバルホットキー。起動時に登録できない場合 (対話型のデスクトップが無いセッションなど) は警告を出して起動を続ける (ホットキーだけが無効になる)。Settings から保存したときの登録失敗はエラーとして返す。 |
| `agent_auto_post_enabled` | エージェントが提案したコメントを承認なしで署名付き投稿するか。既定 false。 |
| `default_agent` | Agent パネルの依頼先エージェントの初期値。`codex` か未設定 (Claude Code)。 |
| `claude_model` / `codex_model` | 各エージェントを起動するときのモデル。コマンドの末尾に `--model "<名前>"` (Claude Code) / `-m "<名前>"` (Codex) を足す。未設定ならモデルを指定せず、各 CLI 自身の設定 (`~/.claude/settings.json` / `~/.codex/config.toml`) に任せる。シェルに渡すため、英数字と `._:/[]-` 以外を含む名前は起動時にエラーにする。 |
| `claude_model_choices` / `codex_model_choices` | Agent パネルのモデル選択に足す候補 (カンマ / 空白区切り)。 |
| `inbox_insight_enabled` | 同期の後、新しい Inbox のコメント項目について Claude Code (`claude -p`) に判定・理由・根拠 (クローンがあれば読み取り専用でコードを確認)・返信案を書かせ、プレビュー先頭に出す。コメント本文がモデルに送られるため既定はオフ。Settings → Agent command のチェックボックス。 |
| `inbox_insight_max_per_sync` | 1 回の同期で判断メモを書く新しい Inbox 項目の上限 (1〜10、既定 3、範囲外は丸める)。Settings → Agent command の「Notes per sync」。 |
| `inbox_insight_model` | その判断メモに使うモデル。未設定なら `sonnet`。英数字と `._:/[]-` 以外を含む名前は無視して `sonnet` を使う。 |
| `auto_agent_enabled` | 同期後、対象 PR のレビューと自分にアサインされた WI の調査を既定エージェントへ依頼する。既定オフ。PR は初回に全体、その後は最後に完全成功した commit から追加 push 分をレビューする。失敗は間隔を空けて再試行する。人の未対応依頼があれば止める。フィールド・説明・コメント・差分がエージェントに渡る。 |
| `auto_agent_max_per_sync` | 自動レビュー / 自動調査が 1 回の確認・1 組織あたりに起動する項目の上限 (1〜10、既定 3、範囲外は丸める)。Settings → Agent command の「Items per check」。 |
| `auto_agent_interval_minutes` | 自動レビュー / 自動調査が新しい項目を確認する間隔 (分、1〜1440、既定 15、範囲外は丸める)。同期のたびではなく、この間隔が過ぎたあとの最初の同期で確認する (確認は同期後のキャッシュを読むだけで、同期間隔より短くはならない)。Settings → Agent command の「Check every (minutes)」。 |
| `auto_agent_approval_enabled` | 自動レビュー / 自動調査を自動で起動せず、Agent Auto Queue に候補を並べて選んだものだけ起動する。既定オフ。Settings → Agent command の「Choose what to run in Auto queue first」。 |
| `auto_agent_pipelines_enabled` | Watch 中のパイプラインの最新実行が failed で終わったとき、その実行についての `investigate` 依頼 (Agent パネルの依頼、`ask`) を作って既定のエージェントを起動する。Watch の監視はフロントエンドで行うため、起動もフロントエンドから (`pipelineAutoInvestigate.ts`)。既定オフ。 |
| `codex_command` | Codex で起動するときのシェルコマンド。プレースホルダは `agent_command` と同じ。未設定なら既定コマンド `codex exec --skip-git-repo-check --sandbox workspace-write -c sandbox_workspace_write.network_access=true --add-dir "{notes}" --add-dir "{results}" "Read {guide} and handle the open notes in {notes}"` (Codex を非対話で、書き込みを作業・メモ・結果フォルダに限り、ネットワークは許可するサンドボックスで実行。git は `http.sslBackend=openssl` を環境変数で渡す (sandbox 内では既定の schannel が認証情報を取れず HTTPS が失敗するため)。Azure CLI 未ログイン・git push 不可は Claude Code と同じ) を使う (`agent_notes/launch.rs` の `DEFAULT_CODEX_COMMAND`)。 |
| `agent_command` | Claude Code で Agent パネルからの依頼・返信・Run now (`Shift+Enter`) を起動するシェルコマンド。`{target}` / `{id}` / `{notes}` / `{workspace}` / `{repo}` / `{results}` / `{guide}` を置換。未設定なら既定コマンド `claude -p "Read {guide} and handle the open notes in {notes}" --add-dir "{notes}" "{results}" --disallowedTools "Bash(az:*)" "Bash(git push:*)" --dangerously-skip-permissions` (Claude Code をバックグラウンドで権限確認なしに実行。Azure CLI は未ログイン、git push は不可の状態で起動) を使う (`agent_notes/launch.rs` の `DEFAULT_CLAUDE_COMMAND`)。 |
| `read_only_validation_mode_enabled` | 読み取り専用モード (誤操作によるミューテーションを抑止)。既定 false。 |
| `desktop_notifications_enabled` | デスクトップ通知の総合トグル。既定 false。 |
| `notification_content_preview_enabled` | 通知に本文プレビューを含めるか。既定 true。 |
| `notify_work_item_assignments` | 作業項目の新規割当を通知。 |
| `notify_work_item_state_changes` | 作業項目の状態変化を通知。 |
| `notify_pr_review_requests` | PR レビュー依頼を通知。 |
| `notify_pr_vote_resets` | 自分の PR 投票リセットを通知。 |
| `notify_pr_comment_replies` | 自分の PR コメントへの返信を通知。 |
| `quiet_hours_enabled` / `quiet_hours_start` / `quiet_hours_end` | Quiet hours。有効時、ローカル時刻 `[start, end)` の間はデスクトップ通知を抑止 (アプリ内バッジ・キャッシュは更新を継続)。`start > end` (例 22:00–08:00) は日跨ぎ。既定 22:00–08:00、無効。 |
| `review_stale_threshold_days` | レビュー PR を stale 扱いする日数 (候補 2/3/5/7、既定 3)。 |
| `work_item_stale_threshold_days` | 作業項目を stale 扱いする日数 (候補 2/3/5/7、既定 7)。 |
| `notification_rules` | 通知フィルタルール配列。types / projects / repositories でフィルタし、`mute` が true なら一致時に抑制、false なら一致時のみ通知する。 |
| `experimental_features_enabled` | 実験的機能のマスタースイッチ。false の間は以下の個別フラグを保存していても無効。既定 false。 |
| `experimental_usage_stats` | 自分のレビュー投票数・解決スレッド数・状態変更数をローカルに集計して表示する。外部送信は行わない。既定 false。 |
| `experimental_retry_toasts` | 操作失敗時に再試行ボタン付きトーストを表示する。既定 false (OFF でも再試行なしのメッセージトーストは常に表示される)。 |
| `experimental_diagnostics_export` | 秘匿処理済みの診断レポートをレビュー結果フォルダに出力する。PAT / トークンは一切含めない。既定 false。 |
| `experimental_cross_org_summary` | 全接続を横断したサマリービュー (`crossOrgSummary`) を有効化する。G→O で遷移。組織別の一覧は接続切り替え完了後に開く。切り替え中は追加操作を無効化し、失敗時はサマリーにエラーを表示する。既定 false。 |
| `experimental_auto_update_check` | 起動時に自動で更新を確認する。既定 false。 |

`update_app_settings` は**フル置換**である。バックエンドの `normalize_app_settings` は
各フィールドを `Option` として読み、省略されていればそのフィールドの既定値に戻す。
そのため設定セクションは自分が変更した項目だけでなく、設定オブジェクト全体を送る必要が
あり、各セクションは `settingsInput()` に自分のパッチを通してこれを行う。
新しい設定を追加したら `settingsInput()` にも必ず追記すること。追記を忘れると、無関係な
セクションを保存するたびにその設定が既定値へ黙って戻る。`settingsHelpers.test.ts` が
`appSettingsSchema` のキーを実行時に列挙して全フィールドの往復を検証するため、追記漏れは
テストで検出される。

---

## 7. キーボード操作

キーボード操作可能性は**ハード要件**。すべてのインタラクティブ要素にキーボード経路を用意する。

### グローバル

| キー | 動作 |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 表示中のペインを画面の上から下、同じ高さでは左から右の順に巡回してフォーカスする (逆方向は `Ctrl+Shift+Tab`、末尾 / 先頭で折り返す)。読み取り専用の Result と、開いている Agent も対象。非表示タブ・畳まれたペイン・入れ子の外側のペインは除外し、Grid では選択行に戻る。入力欄と同一オリジンの結果 HTML / リッチテキスト内からも有効。ダイアログ / メニュー表示中は発動せず、その操作を維持する。固定キーで変更不可 |
| `←` / `→` (一覧行・プレビュー本体) | 現在の画面配置で左 / 右にある Grid または編集可能なペイン (Conversation・Work Item Preview・Agent など) へフォーカス。Grid へ戻ると選択行にフォーカスする。結果 HTML・読み取り専用プレビュー・非表示のタブ・畳まれたペインは移動先から除外し、その方向に対象ペインがなければその場に留まる。`Ctrl+G` でも一覧へ戻れる。入力欄・ボタン・メニュー・ツリー・ボード・ビュー選択の既存の矢印操作は維持。結果 HTML / リッチテキスト内の本文でも有効 (入力欄・リンク・文字列選択中は除外) |
| `Ctrl+K` | コマンドパレット。画面移動後は移動先の Grid (空の場合は一覧領域) に初期フォーカス。同じ画面への移動も対象。キャンセル時は元の要素へ戻る |
| ペインのフォーカス表示 | Grid / プレビュー / Agent など、フォーカスを含むペインを青い枠でハイライト。コメント欄やボタンへのフォーカスも対象。入れ子の場合は最も内側のペインだけを表示 |
| `?` / `F1` | ヘルプ (全ショートカット一覧) |
| `G` → 第 2 キー | ビュー切替 (下表) |
| `Ctrl+F` / `/` | フィルタにフォーカス (My Reviews のように畳まれたフィルタは開いてからフォーカス) |
| `Escape` (検索/フィルタ入力内) | フォーカスを外して結果グリッドの選択行へ移す (結果がまだ無い検索画面ではグリッド領域へ。ドックの畳み式フィルタは開いた候補リストの有無に関わらず 1 回で畳み、値はチップとして残る。それ以外のライブフィルタは文字列もクリア、検索クエリは保持) |
| `Ctrl+\` | 左ナビゲーションの折りたたみ / 展開 |
| `Ctrl+J` | Agent パネルの開閉 (選択中の項目についてエージェントに依頼。既定では閉じている) |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | アプリ全体の表示倍率 (UI scale) を拡大 / 縮小 / 100% に戻す。段階は 90 / 100 / 110 / 125 / 150% で両端で止まる。`Ctrl+Shift+=` (`+`) も拡大。キーバインド設定で変更可能 (`uiScaleUp` / `uiScaleDown` / `uiScaleReset`)。Settings の Appearance でも選べる。ルート要素の CSS `zoom` で適用し、localStorage `azdodeck:uiScale` に保存して起動時 (`main.tsx`) に反映する |

アプリに割り当てていない WebView 既定ショートカット (`Ctrl+P` 印刷、`Ctrl+G`
find-next) は、入力欄以外では抑止し、ネイティブ動作が素通りしないようにする。

### Go-To チェーン (`G` リーダー + 第 2 キー)

`R` My Reviews / `Q` PR Search / `W` My Work Items / `F` Work Item Search /
`V` Work Item Views / `P` Pipelines / `N` Notifications / `I` Inbox /
`O` Cross-org summary / `A` Agent Auto Queue / `S` Settings。
移動後はコマンドパレットと同じく、遅延読み込みの完了を待って移動先の一覧 (選択行、無ければ一覧領域。
Pipelines は Watched pipelines の見出し) にフォーカスする。
Work Item Search は以前 `I` だったが、Inbox の追加で `F` (Find) へ移した。Settings で
上書き済みのキー割当はそのまま残る。

### フォーカスの戻り先

- モーダルダイアログ (確認ダイアログ・New Work Item など) は `useFocusTrap` (`src/lib/useFocusTrap.ts`) で
  `Tab` / `Shift+Tab` を中に閉じ込め、閉じると開いた要素へ戻す。確認ダイアログの初期フォーカスは Cancel。
- 列ヘッダーのフィルタと Columns メニューは開くとポップアップ内 (検索欄 / 最初のトグル) にフォーカスし、閉じると開いた要素 / グリッドへ戻す。
- Agent パネル: 会話の見出しで `Esc` はパネルを閉じてグリッドへ、畳んだ返信欄で `Esc` はその会話の見出しへ、
  見出しで `Delete` は隣の会話 (無ければ入力欄) へフォーカスを移す。入力欄 (PR のコメント欄を含む) は下書きがあっても
  `Esc` で持ち主 (会話の見出し / プレビュー) へ戻り、下書きは残す。
- Pipelines の実行行で `Enter` は実行を選んでプレビューへフォーカスする (`→` は読み取り専用プレビューを飛ばす規則どおり)。
- コマンドパレットには全 View への移動 (Inbox / My Pull Requests / Agent Auto Queue / Notifications を含む) を並べる。

### 一覧ペインのステータスバー

ドックの一覧ペイン (My Reviews / My Pull Requests / PR Search の結果 / Work Items 系グリッド (My Items・Views・WI Search) / Inbox / Pipelines の Watched board) の下端は、共通コンポーネント `ListStatusBar` (`src/components/ListStatusBar.tsx`) で同じ書式にする。

- 左: `N items` + View 固有の補足を ` · ` で区切る (例: `6 items · 2 not voted · 3 changed files`、`5 items · updated just now`、PR Search の検索前は `No search yet`)。複数選択の件数・衝突リスクなどの操作ボタンも左に置く。
- 右 (この順で固定、持たない View は出さない): 有効フィルタ数と Clear filters → `Done N` → `Snoozed N` → `Stale N` → `Fit` (列幅を手で変えた後だけ) → `Columns` → `?`。
- `Done N` / `Snoozed N` / `Stale N` は件数が 0 で押されていない間、枠を消した薄い文字にする (押せる操作は変わらない)。
- `Done N` / `Snoozed N` は一覧をその状態に切り替えるトグル (`aria-pressed`)。有効な間はタブ帯に解除チップを出し、チップの ✕ か一覧上の `Esc` で Open の一覧へ戻る (フォーカスはグリッドへ戻す)。件数は Done がローカルのトリアージ件数、Snoozed が有効なスヌーズ件数 (`useSnoozedCount`)。
- `?` (aria-label「Show keyboard shortcuts for this view」) は window イベント `azdodeck:help:open` (`src/lib/helpEvents.ts`) で App に Help を開かせ、その View のキー一覧の節 (reviews / pr-search / work-items / pipelines / inbox) へスクロールして見出しを強調する。押す前にグリッドへフォーカスを移すので、Help を閉じるとグリッドに戻る。

### グリッド内

`↑ ↓ / J K / Home / End / PageUp / PageDown` で移動、`Enter` でプレビュー/オープン、
`Ctrl+Enter` でブラウザを開く、`C` で URL コピー、`L` で Markdown 形式のリンク
(`[!123 タイトル](url)` / 作業項目は `[#123 タイトル](url)`) をコピー。

My Reviews / Work Items のフォーカス行は項目キーで保持し、同期・ソート・フィルタ変更で行位置が変わっても同じ項目の選択とプレビューを維持する。選択項目が非表示・削除された場合のみ、直前の行位置に近い表示行へ移動する。表示行が無い場合は選択を解除する。

複数行の選択は全グリッド共通で `Shift+↑ ↓` / `Shift+クリック` による範囲選択と
`Ctrl+クリック` による個別追加/解除に対応する。`Ctrl+C` は Work Items / PR Search /
My Reviews / My Pull Requests で選択行をメール貼り付け向けの表としてコピーする
(選択が無い場合はフォーカス行 1 件)。表は現在グリッドに表示中の列を画面の順序で並べ、
ID とタイトルのセルは Web URL へのハイパーリンクにする。日付は相対表記ではなく絶対日時、
CI・役割・投票などのバッジはラベル文字列にする。Work Items ではビューの追加フィールド列も含める。
クリップボードには `text/html` (`<table>` + インラインスタイル、Outlook / Gmail / Teams 向け) と
`text/plain` (ヘッダー付き TSV、Excel / テキストエディタ向け) を同時に書き込み、
`ClipboardItem` が使えない環境、またはリッチ書き込みが拒否された場合は TSV のみ書き込む (`src/lib/clipboardTable.ts`)。
他人が書いたタイトル等が表計算で数式として評価されないよう、セルの先頭が `=` `+` `-` `@` またはタブ/CR のときは先頭に `'` を付ける。
この表コピーが「Copy as Grid」(`Ctrl+C`)。`Ctrl+Shift+C` は「Copy as Link」で、同じ選択行を
1 行 1 リンクとしてコピーする (ラベルは PR が `!id タイトル`、作業項目が `#id タイトル`)。
`text/html` は行ごとの `<a href>`、`text/plain` は 1 行 1 つの Markdown リンクで、Web URL が無い行は除外する。
`C` (1 件の URL) と `L` (Markdown リンク) は変わらない。コピー結果はトーストで通知する
(`Row copied` / `N rows copied` / `Link copied` / `N links copied` / `No links to copy` / `Copy failed`)。
`Escape` で複数選択を解除。
My Reviews は既存の `selectedKeys` (ファイル重複検知と共有)、作業項目グリッドは既存の
チェックボックス選択 (一括操作と共有。選択ロジックは
`src/features/work-items/wiRowSelection.ts`) を選択状態として使い、My Pull Requests /
PR 検索は共通フック `src/lib/useRangeSelection.ts` を使う。作業項目グリッドでは
`S` 状態 / `A` 割当 / `P` 優先度 / `F` フィールド循環、`Ctrl+S` で適用、`M` でコメント。
My Reviews でも `M` / `Ctrl+M` で PR の新規コメント欄へフォーカスし、畳まれている場合は展開する。入力欄で編集中は発動しない。
プレビューの `D` は選択中の作業項目を複製ドラフト (タイトル `[Copy] ` 接頭辞 + 種別・
優先度・エリア/イテレーション・タグ・担当者) として作成ダイアログに引き継ぐ。
コメント欄の `Ctrl+Enter` は投稿 (+保留変更の適用) と同時にコメント入力からフォーカスを
外し、プレビューパネルへ返す。PR のコメント投稿 (Review タブ・返信・インライン) も
投稿完了後にフォーカスをプレビューへ返し、キーボード操作がそのまま続けられる。
作業項目と PR のコメント入力欄 (新規・返信・編集・インライン) は縦方向にリサイズできる。
作業項目プレビューの新規コメント欄も、空でフォーカスが無い間は1行 (投稿ボタン非表示) に
畳み、フォーカス (`m` / `Ctrl+M` を含む) または入力中は元の高さに戻す。
作業項目プレビューは Comments と新規コメント欄を右側の列 (幅 42%、独立スクロール) に移して詳細と並べるか、
従来どおり詳細の下に続けるかをヘッダーの切替ボタンで選べる (`azdodeck:wiPreview:commentsLayout` に保存)。
未選択の間はパネル幅 880px 以上で横並び、それ未満で縦並び (`WorkItemCommentsSection`)。
作業項目プレビューの折り畳みセクション (Description / Acceptance Criteria / Comments / Links /
Pull Requests / Attachments / History) は VSCode のビューのように配置を変えられる。見出しを
ドラッグして並べ替え、横並び時は詳細列と右列の間でも移動できる (挿入位置は青い線で表示、空の列には
末尾に追加)。キーボードでは見出しにフォーカスして `Alt+↑` / `Alt+↓` で同じ列内を並べ替え、横並び時は
`Alt+←` / `Alt+→` で詳細列 / 右列へ移す (移動後もフォーカスは見出しに残る)。配置は
`azdodeck:wiPreview:sectionLayout:v1` に全体順序 + 右列に置くセクションとして保存し、縦並び時は
全体順序どおり 1 列に並べる。新規コメント欄は Comments のある列の下端に付く
(`PreviewSectionMover` / `previewSectionLayout`)。
作業項目グリッドのキー処理は、プレビュー内のボタン/リンク上の `Enter` / `Space` を横取りしない (ボタンとして押せる)。
PR の Conversation タブ下部の新規コメント欄は、空の間は1行のボタンに畳んでおき、クリック /
Enter で展開してフォーカスする。空のまま `Escape` またはフォーカスが外れると畳み、`Escape`
のときはその PR のプレビューへフォーカスを返す。
全プレビューのタブ帯は同じ規則で並ぶ (`src/components/PreviewToolbar.tsx`): 常時表示は
ズーム (縮小 / 倍率 / 拡大) と最大化 (最大化を持つ PR レビューパネルのみ) と `⋯` View options
メニューで、それ以外の操作はすべて `⋯` に入れる (幅によって出し入れはしない)。対象は PR の
Conversation / Result、作業項目の Preview、Inbox の Conversation、Pipelines の Preview。
`⋯` は `src/components/ViewOptionsMenu.tsx` で、開くと先頭の項目にフォーカスし、`↑` `↓` で移動、
`Enter` / `Space` で実行、`Esc` で閉じてトリガーへフォーカスを戻す (ナビゲーションキーは
メニュー内で止め、背後のグリッドに伝えない)。Follow やコメント配置のような切替項目は
`menuitemcheckbox` でチェック状態を示し、ショートカットがある項目は右端に表示する。
- 作業項目 (Work Items グリッドでは Preview タブのタブ帯右端、`PreviewToolbarSlot` の portal。状態はプレビュー側に残り、
  タイトルをプレビュー最上段に表示する。ボードや PR の Work Items ペインなどタブ帯の無い配置では
  `#ID`・種別・状態の行の右端に置く): `⋯` に Follow (✓)・Email a link・Duplicate work item (`D`)・
  Field presets… (`1`-`9`)・Comments beside details (✓)・Configure preview fields… を入れる。
  Field presets… / Configure preview fields… は `⋯` の下にポップオーバーを開き (開いた時点で先頭の
  コントロールにフォーカス、`Esc` / Done / 適用で閉じると `⋯` へフォーカスを戻す)、独自のトリガーボタンは持たない。
  「Email a link」はタイトルと URL を本文に入れた `mailto:` リンクで既定のメールクライアントを開く
  (Azure DevOps Web の Share 相当)。
- PR レビューパネル: `⋯` に Email a link (件名 `!{id} {title}`、本文にタイトルと URL を入れた `mailto:`) と
  Preview linked work items (`T`)。
- Inbox: Open in DevDeck / Open in Azure DevOps はツールチップとアクセシブル名にショートカットを含む
  アイコンボタンで、ズームの左に置く。`⋯` は Copy URL (`C`) と Ask the agent (`Q`)。
- Pipelines: `⋯` に Open in Azure DevOps・Re-run (`R`)・Cancel run (`X`、実行中のみ)。確認バーを閉じると
  フォーカスは `⋯` に戻る。
My Pull Requests グリッドも他グリッド同様、`L` で選択行の Markdown リンクをコピーできる。
作業項目 / PR / Inbox / Pipelines の各プレビューパネルには共通のズームコントロール
(縮小 / 現在の倍率 / 拡大の3ボタン、`src/components/PreviewZoomControls.tsx`) があり、
70%〜160% の範囲で 10% 刻みにプレビュー内のテキストとレイアウトを拡大縮小する
(CSS `zoom` を適用)。倍率は `usePreviewZoom` フックが localStorage
(`azdodeck:view:previewZoom:v1`) に保存し、プレビュー間で共有する。倍率表示
ボタンをクリックすると 100% にリセットする。ボタンのほか各プレビューパネル上で
`Ctrl+=`/`Ctrl+-`/`Ctrl+0` (Cmd 系も可) でも拡大・縮小・リセットでき、テキスト入力欄に
フォーカスがあっても効く。
Pipelines の実行詳細は、PR / 作業項目プレビューと同じ薄い青の帯
(`src/components/PreviewBand.tsx`) でセクションを区切る (Timeline / Artifacts / Tests / Log)。作業項目プレビューの
優先度は 1=赤・2=橙・3=黄・4=灰の色ドットを値の前に表示する (`workItemPriorityDotClass`)。
行を1件選択中は、ステータスバーに主要な行ショートカットのコンパクトな凡例を表示する
(My Reviews / 作業項目グリッド)。Pipelines の監視パイプライン実行行でも
`↑ ↓ / J K / Home / End` で移動、`Enter` で実行プレビュー、`Ctrl+Enter` で
ブラウザを開く。パイプライン実行詳細パネルのタイムライン行でも
`↑ ↓ / J K / Home / End` で移動、`← →` で折りたたみ/展開、`Enter` / `Space` で選択行のログを表示する (ログを持たない行は無視)。

Pipelines の見た目と操作 (`src/features/pipelines/`):

- **ボード見出し**: 「N running」(青)・「N failed」(赤、最新実行が失敗のパイプライン数)・「N approvals」
  (琥珀、選択中プロジェクトの保留承認数) のピルを置く。いずれもボタンで、running / failed は
  押すとそのパイプラインだけに絞り込み (再押下で解除)、approvals は承認バナーを開閉する。
  並び順は既定「Status」(実行中 → 失敗 → その他、同順位は購読順)、`Name` / `Last run` に切替でき、
  選択は `azdodeck:view:pipelinesSort:v1` に保存する。更新ボタンは全パイプラインを再取得し、
  最終更新時刻を表示する (F5 は Webview 再読込と衝突するため割り当てない)。
- **ミニ履歴**: 各パイプライン行に直近 8 件の実行を色セル (古い順 → 新しい順) で表示する。幅 560px 未満では非表示。
  セルのクリックでその実行を選択する (キーボードでは展開した実行グリッドから同じ実行を選べる)。
- **実行行**: 状態バッジはアイコン (✓ / ✕ / ⚠ / 禁止 / ?、実行中はパルスドット) + ラベル。
  ボード幅が 900px 以上のときだけ「Requested for」「Reason」の列を追加する (それ未満は従来の 6 列)。
- **実行履歴フィルタ** (ブランチ / 結果 / My runs) は他のグリッドと同じく折り畳み式の `Ctrl+F` で
  ドックのタブ帯に入り (`PipelineFilterBar`)、畳んだ状態ではチップで残る。`Esc` で畳み、グリッドへフォーカスを戻す。
- **Watch が 0 件**のボードは、選択中プロジェクトのパイプラインを 1 クリックで Watch できる候補チップ
  (と「Watch all」。上限 100) を表示する。
- **Queue run** はツールバー直下に縦に伸びるフォームではなく、ボタン下のポップオーバー
  (`PipelineQueuePopover`)。開くと Branch にフォーカス、`Ctrl+Enter` で実行、`Esc` / Cancel で閉じて
  Queue run ボタンへフォーカスを戻す。パイプラインごとに直近のブランチと**秘密でない**変数値を
  `azdodeck:pipelines:queueRecent:v1` (localStorage、最大 50 件) に記憶して次回の初期値にする。
  自由入力の Parameters 欄は秘密を含み得るため保存しない。
- **実行詳細**: 操作 (Open in Azure DevOps / Re-run / Cancel) はタブ帯右端のアイコンに置く
  (Cancel は実行中のみ)。見出しは状態バッジ + 定義名 + ビルド番号、続く 2 行にブランチ・理由・起票者と
  キュー相対時刻・所要時間 (実行中は 1 秒ごとに更新)。
  Re-run / Cancel の確認は `window.confirm` ではなくヘッダ直下のインライン確認バー
  (`PipelineConfirmBar`)。初期フォーカスは安全側 (Cancel / Keep running)、`Enter` で確定、
  `Esc` で閉じて元のアイコンへフォーカスを戻す。
  実行を開くと**最初の失敗ステップ** (失敗した最も深い Task で、ログを持つもの) を自動選択してログを開く。
  Timeline は WAI-ARIA tree: `↑↓` 移動、`→` 展開、`←` 折り畳み (折り畳み済みの最上位で `←` はグリッドへ戻る)、
  `Enter` / `Space` でログ表示、`Home` / `End`。既定では失敗・実行中・警告を含む枝だけ展開し、
  成功した Stage / Job は畳む。見出し帯に「Expand all / Collapse all」と「First failure」(`F`) を置く。
  プレビュー内の `R` で Re-run、`X` で Cancel (どちらも確認バーを経由)。
- **ログ** (`PipelineLogViewer`): 行番号、検索 (`/`、`Enter` / `Shift+Enter` で次/前、`Esc` で閉じてログへ戻る)、
  折り返し (`W`)、末尾追従 (Follow。上へスクロールすると自動で止まる)、Copy、Errors/warnings only。
  高さは `max-h` 固定ではなく残り高さを使う (最小 18rem)。重大度は `##[error]` / `##[warning]` を優先し、
  単語は `error:` `error CS1002:` `npm ERR!` のようにコロンが付く形だけを対象にする ("0 errors" は強調しない)。

各 View の最上段のツールバーは、PR Search / Work Item Search の検索行と同じ「枠なし・1 行・高さ `h-7` (28px)」に揃える
(カードの枠線と余白は付けない)。ボタンが数個だけのツールバーはアプリのヘッダー行のパンくずの右に置き
(`HeaderToolbarPortal` → `HeaderToolbarTarget`)、一覧に縦幅を回す。対象は My Items の Assigned to me | Followed /
New item / Templates、Work Item Views のビューのチップ行と List / Board / ⋯ / Edit / ▷ / Add (カード表示に広げたときは
従来どおりビュー内に置く)、Notifications のカテゴリボタン / Unread only / 組織 / Mark all read。検索欄がある
PR Search / Work Item Search と、Pipelines (Project / Pipeline / Watch / Queue run) は別の行のまま。パンくずの最後の
区切り (長いビュー名) は 16rem で切り詰める。Pipelines の承認待ちの琥珀色の帯はツールバー行の右端に 1 行で置き、
開くと下に重ねて表示する。一覧ペインの名前は PR Search が「Pull requests」(Work Item Search の「Work items」と対)。
プレビューが空のときは、選択を促す中央の文言 (`PreviewEmptyState`) だけを出し、「No PR selected」のような
見出し行は出さない。Work Item Search / Views の空グリッドの案内文は、列グリッドの幅ではなくペインの可視幅の
中央に置き、狭いペインでは折り返す。

PR Search / Work Item Search でパレット等から特定の項目を開く場合は、前の結果フィルター・列フィルター (Work Item の Stale only も含む) を解除し、その項目が古い絞り込みで隠れないようにする。
複数選択フィルターの候補検索欄の Enter は親フォームを送信しない。IME 変換確定の Enter でポップオーバーを開いたり、候補を選択したりしない。

空き領域には次の操作の候補を置く。
- PR Search / Work Item Search: 検索前の一覧に「Recent searches」(実行した検索の直近 5 件。クエリ・フィルタ要約・
  経過時間。同じ条件は 1 件にまとめ、接続ごとに絞る) を出す。PR Search は「Saved」(ピン留めした検索)、
  Work Item Search は「Recently viewed」(どの View からでもプレビューで開いた直近 5 件) も出す。`↑` / `↓` (`j` / `k`)
  で移動、`Enter` で条件を戻して再実行、`S` でピン留め、`Delete` で削除、`/` で検索欄。削除後は隣の行へ、履歴が空なら検索欄へフォーカスを戻す。履歴が無いときは従来の案内文。
  保存先は localStorage の `azdodeck:prSearch:searchHistory` / `azdodeck:workItemSearch:searchHistory`。
- Pipelines: 何も選んでいないときは、実行中のパイプラインの最新 run (無ければ先頭行の最新 run) をプレビューに出す。
  フォーカスは一覧のまま動かさず、run を選んだ後はその選択を優先する。
その他の表示:
- My Reviews: 折りたたんだグループの見出しの横に、中の PR の `#ID タイトル` を最大 3 件、薄い 1 行で出す
  (表示のみ。`aria-hidden`)。
- Work Item のグリッドの State 列は、プレビューと同じ色付きの状態ラベル (`WorkItemStatePill`) で出す。
- Inbox: Priority / Other / All は件数付きで一覧ペインのタブ帯の右端 (一覧の直前) に置き、一覧から `Shift+Tab`
  (パネル移動ボタンの次) で届く。説明文は `?` のキー一覧に移した。Claude の判断メモがある項目は、行に判定
  (Fix first / Reply / No action) のラベルを出す (表示のみ)。
- Notifications: 一覧を「Today」「Earlier」の見出しで区切り、行にカテゴリ色の四角 (PR 青 / WI 紫 / Pipeline 緑・
  失敗は赤 / Sync 琥珀) を付ける。カテゴリボタンは `←` / `→` / `Home` / `End` で移動、`Enter` / `Space` で選択、
  `↓` / `Esc` で一覧へ戻る。行移動は見出しを飛ばす。
- Settings: 各設定は「名前と説明 (左 240px) | 操作 (右)」の 2 列の行で表示し、本文幅は 900px に抑える。
  Accounts の接続追加フォームは、接続が 1 件以上あるときは「+ Add connection…」ボタンの裏に隠し、開くと最初の
  入力欄にフォーカス、`Esc` / Cancel で閉じてボタンへ戻る。接続が 0 件なら常に表示する。

Grid と右プレビューを並べる My Reviews / PR Search / Work Items /
Pipelines は、利用可能幅の 60% / 40% を既定比率とする。区切り線のドラッグまたは
キーボード操作で変更した比率は画面ごと (保存済み Work Item View はビューごと) に
localStorage へ保存し、画面切り替えやウィンドウサイズ変更後も同じ比率で再計算する。
プレビューの既存最小幅を守りつつ Grid に 480px 以上を残し、区切り線の
ダブルクリックまたは Escape で 60% / 40% に戻す。
ドックで新しく組んだ既定レイアウトは、一覧とプレビューの幅を 50% / 50% に配分する (`balanceListAndPreview`)。
Agent の列が初めて入るときも、その列が一覧から幅を取るため同じ配分に組み直す (保存済みのレイアウトは変えない)。
各グリッドの Title 列は残り幅を取る可変列で、最小幅は 240px (My Reviews / My Pull Requests / PR Search / Work Items)。
一覧は 1 つの Tab 停止にまとめる。行内の ID リンク・チェックボックス・Notifications の「Open in Azure DevOps」は
Tab 順から外し、同じ操作はキー (`Ctrl+Enter`、`Shift+↑↓` の範囲選択) で行う。
ドックの各グループは、自分 (または自分を含む列/行) が分割の2番目以降にある境界ごとに
リサイズハンドルを持つ。プレビューの下に別ペインを積んだ入れ子レイアウトでも、
列の境界全体を幅ハンドル (外側の分割のものは「Resize <パネル> width」) でドラッグできる。
タブ帯のボタン類 (フィルタ・移動メニュー等) はこのハンドルより前面にある。
移動メニューや保存レイアウトの復元でペインの並びが変わっても、ハンドルは新しい境界・隣接ペインに付け替わる。
タブ帯右端の移動メニューのボタン (Move panel) は、そのペインにポインタが乗っている間・キーボードでフォーカスした間・
メニューを開いている間だけ表示する。
ペインの中身はペイン幅を超えて広がらない (`PanelContent` の grid は `minmax(0, 1fr)` の 1 列)。コード片や表など
幅のある中身はその要素の中で横スクロールし、本文は折り返す。
境界の調整は両隣のペインの幅・高さを交換し、反対側の境界 (Agent 等) を動かさない。隣接ペインの最小・最大サイズで止まる。
各グループは自前の枠線 (角丸 10px・極薄の影) を持ち、隣り合うペインの境界が一目で分かるようにする。
ページ背景 (サイドバー・ヘッダー含む) は灰青、ペインは白い面 (`--card`) とし、ワークスペース外周に余白は取らず
(画面を広く使う)、枠線と影でペインがカードとして分かれて見えるようにする。サイドバーの選択項目は白いピル+影で示す。
畳んだフィルタ (`DockFilterBar`) を閉じた後に戻す行が無い (結果0件など) 場合や、チップの ✕ で
チップが消えた場合は、フォーカスをタブ帯の「Ctrl+F」ボタンに置き、`<body>` に取り残さない。

列ヘッダのフィルタアイコンから開くチェックボックス式の列フィルタは、対象グリッド
(My Reviews / PR Search / 作業項目) で共通の仕様とする。先頭に検索ボックス、続いて
`(All)` (フィルタ解除=全表示) と `Uncheck all` (全チェックを外し、明示的な空選択にして
任意の値だけを選び直せる状態) を並べ、その下に値ごとのチェックボックスを表示する。
内部状態では「キー無し=(All)」「空集合=全チェックを外した状態 (該当行なし)」を区別する。

検索フォーム側の絞り込み (PR Search のステータス/プロジェクト/リポジトリ、Work Item Search
の状態/種別/プロジェクト、Notifications の種別) も、単一選択の
`<select>` ではなく共通の複数選択コンポーネント `MultiSelectFilter`
(`src/components/MultiSelectFilter.tsx`) を使う。選択は値の配列で、空配列は「絞り込みなし
(=全件)」を意味する (PR ステータスのみ空=既定の active)。トリガーボタンは現在の選択を要約表示し、
Enter/Space/↓ で開き、↑↓ で項目移動、Enter/Space でトグル、Escape で閉じてトリガーへフォーカスを返す。
矢印などのキーはポップオーバー内に閉じ込め、背後のグリッドが反応しないようにする。Pipelines の
プロジェクト/パイプライン選択は結果リストの絞り込みではなく単一対象のドリルダウン (Watch / 詳細
パネルが単一定義前提) のため、単一選択の `FilterableSelect` のままとする。

### Work Item Views

結果グリッドは、作業項目に `ArtifactLink` (Pull Request) の関連付けがあり、
かつそのPRがローカル同期済みのActive PRキャッシュ (`pull_requests` テーブル、
プロジェクト全体を対象) に含まれる場合、タイトルセルに関連PRアイコンを表示する。
通常の Active PR は primary 色、Draft PR は amber 色で、各アイコンのツールチップは
それぞれ「関連PRあり (Active)」「関連PRあり (Draft)」とする。
これは `run_work_item_query` 実行時にバッチ取得へ `$expand=Relations` を付与して
関連情報を取得し、Active PRキャッシュと突き合わせるだけで判定するため追加の
API呼び出しは発生しない。この判定はビュー実行結果 (`WorkItemSummary.hasActivePullRequest` /
`hasDraftPullRequest`)
にのみ適用され、My Work Items など同期キャッシュ経由の一覧には反映されない
(常に `false`)。Completed/Abandoned のみのPRは対象外。

作業項目プレビューの Pull Requests セクションは、`ArtifactLink` (Pull Request) の各PRを
My Reviews キャッシュ (タイトル・自分の投票・Draft) → Active PRキャッシュ (タイトル・Draft)
の順に突き合わせて表示し、クリックで常にブラウザで開く。どちらのキャッシュにも無いPR
(他人のPRで Active 以外など) も、リンクURL `vstfs:///Git/PullRequestId/{projectGuid}%2F{repoGuid}%2F{id}`
から `{base_url}/{projectGuid}/_git/{repoGuid}/pullrequest/{id}` を組み立てて開けるようにする
(追加のAPI呼び出しはしない)。

作業項目グリッド・My Reviews・PR Search の `R` は Result パネル/タブを前面化してコメントモードに入る。
Result 内 (テキスト入力以外) の `o` は結果 HTML を既定のブラウザで開く。コメントモードでは
`↑ ↓` / `Home` / `End` でブロック (見出し・段落・リスト項目・表の行など) を移動、`Shift+↑ ↓` で範囲を
拡張、`C` でコメント作成 (引用付き)、`Enter` はそのブロックにメモがあればメモ一覧へ移動し、無ければ
コメント作成、`]` / `[` で次/前のメモ付きブロック、`PageUp` / `PageDown` でスクロール、`Escape` は
範囲拡張の解除 → グリッドへ戻る。コメント入力は `Ctrl+Enter` 送信 / `Escape` 取消で、いずれも
呼び出し元 (コメントモード / グリッド) へフォーカスを戻す。メモ一覧は `↑ ↓` 移動 (結果内の該当箇所を
強調)、`Enter` で該当箇所へスクロール、`→` / `←` で返信スレッドの展開/折りたたみ、`R` で展開して返信欄へ
(返信欄は `Ctrl+Enter` 送信 / `Escape` でメモ行へ戻る)、`Delete` で削除、`Escape` でグリッドへ。

ビュー一覧では `↑ ↓ ← →` (グリッド状に移動) / `Home` / `End` で選択、`Shift+←→↑↓` で並べ替え、
`Delete` で削除、`N` 追加 / `E` 編集 / `R` 全ビュー再実行。`Ctrl+B` は一覧の折りたたみトグルで、
ビュー一覧と結果グリッドのどちらにフォーカスがあっても効く。折りたたむとリストが DOM から
外れるためフォーカスはトグルボタンへ移し、展開時は選択中ビューへ戻して矢印移動を継続できるようにする。

WIQL エディタ内は `Ctrl+Space` 補完開閉、`↑ ↓` 候補移動、`Enter` / `Tab` 確定、`Escape` 候補閉じ
(ダイアログは閉じない)、`Shift+Alt+F` 整形、`Ctrl+Enter` 保存 (候補一覧が開いていても送信する)。
展開中の `Escape` は展開解除に使う。

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
また、ユーザーがホイールやスクロールバーでグリッドをスクロールし、フォーカス中の行が
表示範囲外に出た (またはフォーカスが既にグリッド外にある) 時点で所有権を手放す。
仮想化で行がアンマウントされても React は blur を通知しないため、これがないと
次のデータ更新で古い選択行までスクロールが引き戻される。キーボードジャンプは選択行か
グリッド自体にフォーカスを置いたままスクロールするので、所有権は維持される。

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

- **デザイントークン (配色・文字サイズ・フォーカス)**: 色は `src/index.css` の CSS 変数
  (ライト/ダーク) と `tailwind.config.ts` の色名で一元管理する。`destructive` /
  `success` / `warning` / `info` は **文字色としてそのまま使える明度** (ページ背景および自身の
  10% 透過面の上で 4.5:1 以上) に調整してあり、ステータス表示は `border-warning/30
  bg-warning/10 text-warning` のように 1 トークン + 透過度で書く (`bg-red-50 dark:bg-red-950`
  のようなライト/ダークの手書きペアは新規に増やさない)。`primary` は塗り色 (白文字で 4.5:1 以上)、
  `link` は小さな文字用の青。小さな文字は `text-[11px]` ではなく `text-2xs` (11px) /
  `text-3xs` (10px) を使う。これらは rem 指定でルートの文字サイズ段階 (15/16/17px) に追従する。
  `index.css` の `:focus-visible` フォールバックが、自前のフォーカス表示 (`focus:ring-*`) を
  持たないコントロールにもテーマ色のリングを出す。
  OS の「視覚効果を減らす」設定 (`prefers-reduced-motion`) ではトランジションと pulse/ping を止める
  (スピナーは処理中表示のため回し続ける)。
- PR 検索画面は Azure DevOps の active/completed/abandoned を検索時にライブ取得し、作成者・レビュアー・ブランチ・期間・リポジトリの条件をAPI側へ渡す。バックグラウンド同期のキャッシュや同期範囲は変更しない。
  `progressive` 未指定の旧呼出元は active を同期キャッシュ、それ以外をライブ取得する従来経路を使う。active は完了日を持たないため、Closed 指定の期間でも作成日を使用することを条件欄に表示する。
  期間の下限/上限は `YYYY-MM-DD` を UTC の 00:00:00 / 23:59:59.9999999 に展開した RFC3339 で表す。
  上限は最終秒を丸ごと含める必要がある (Azure DevOps の日時は秒未満の精度を持つため、
  23:59:59 ちょうどを上限にすると当日 23:59:59.xxx 作成分が漏れる)。精度は Azure DevOps 自身の
  .NET 日時と同じ 100ns (tick) 単位に揃える。メモリ内の絞り込み (`within_window`) は文字列比較
  ではなく RFC3339 をパースした瞬時値で比較する (`Z` と `+00:00` の表記差で順序が狂うため)。
  旧経路のドラフト除外用に active キャッシュ (`pull_requests.is_draft`) が draft 状態を保持する。
- Azure DevOps のリッチテキストは表示前にサニタイズ・正規化し、生の HTML を可視テキストに漏らさない。
  本文中の認証必須な添付画像 (Work Item 添付ストアの `_apis/wit/attachments/`、および PR の説明・
  コメントに貼り付けた画像が使う `_apis/git/repositories/{repo}/pullRequests/{id}/attachments/`) は
  webview から直接取得すると認証ヘッダが付かず 401 になるため、バックエンド (`fetch_work_item_image`、
  同一組織の上記 2 形態の添付 URL のみ許可・LRU キャッシュ) 経由で取得して data URL に差し替えてから
  表示する。相対パスの添付 src は PR の webUrl を基準に絶対 URL へ解決してから同じ経路で取得する。
  この添付 URL 判定は `src/lib/azdoAttachmentUrl.ts` に集約し、Work Item プレビューの iframe
  (`workItemHtml.ts`) と markdown ビュー (`markdown.tsx`) の両方が同じ判定を使う。判定が片方に
  偏ると、Work Item コメントに貼られた PR 添付画像のように一方の画面だけ hydration されず
  alt テキスト ("Image") だけが表示される。判定範囲はバックエンドの許可リスト
  (`is_allowed_attachment_path`) と一致させる。取得に失敗した場合・data URL が得られなかった場合は
  認証なしで 401 になる元の src を残さず、明示的なエラー表示に置き換える。
  添付 API が `application/octet-stream` を返す場合や URL にファイル名がない場合は、PNG/JPEG/GIF/WebP/
  BMP/ICO のファイルシグネチャから画像種別を判定する。
  data URL への差し替えでは `src` だけでなく `srcset` / `sizes` も除去する
  (`applyHydratedImageSource`)。ブラウザは候補選択で `srcset` を `src` より優先するため、
  高 DPI のスクリーンショット貼り付けで Azure DevOps が付与した `srcset` を残すと、
  hydration 済みの `src` が無視されて認証なしの URL が 401 になり alt テキストだけが表示される。
  Azure DevOps はコメントの rendered HTML で添付 URL を U+0006 制御文字に置き換えることがある
  (先頭のみの置換・URL 全体の置換の両方がある)。rendered HTML に U+0006 が含まれ、かつ元の
  plain text 側に取得可能な添付 URL があれば plain text 側を採用する。採用できない場合は先頭の
  U+0006 を除去してから組織の base URL に対して解決する。除去した結果 src が空になる
  (U+0006 のみだった) 場合は解決対象がないため、素通りさせずエラー表示に置き換える。
  Azure DevOps が挿入する添付ファイル名に生の空白を含む画像 markdown (`![alt](url with space.png)`)
  は、空白をパーセントエンコードした上で画像として描画する。ファイル名内の対応する丸括弧も URL の
  一部として保持する (strict CommonMark は生空白でリンク先を打ち切るため、無変換だと生テキストとして漏れる)。
- 表示の視認性 (`src/index.css` のトークン): 補助テキスト `--muted-foreground` は白背景で 6.6:1
  (ダークで 9.6:1) を確保し、文字色に `text-muted-foreground/NN` のような透明度を重ねない。
  文字サイズの下限は 11px (`text-[9px]` / `text-[10px]` は使わない)。ID などのリンク文字は
  `text-link` (`--link`、白背景で 5.4:1) を使い、`primary` はボタン等の塗りに限る。
  グリッド行の選択・複数選択・stale の見た目は `src/lib/gridRowState.ts` の `gridRowStateClass`
  に集約する: 選択は primary の薄い背景 + 左端 3px の primary バー、stale は背景を塗らず左端の
  オレンジバー + 経過日数の文字色 (`STALE_TEXT_CLASS`) で示し、選択の表示を常に優先する。
  列見出しは既定幅・最小幅で省略されない幅を確保する (保存済みの列幅も最小幅に丸められる)。
  列の境界には常に細い区切り線を描き (掴める幅は 10px、ホバー/ドラッグで強調)、ドラッグは画面上の実際の列幅から
  始める (余白を埋める列でもドラッグ開始直後から追従する)。
  列幅は `src/lib/useGridColumns.ts` + `src/lib/gridAutoFit.ts` で自動調整する (My Reviews / My Pull Requests /
  PR Search / Work Items 共通)。(a) 自動モード (初期状態。保存幅が既定値のままの既存ユーザーも含む) では、
  行が表示された時点で余白列 (Title/Comment) 以外の各列を表示中の内容の自然幅 (省略なしの幅) に合わせ、min/max で丸める。
  グリッドが空になる (再検索など) か表示列が変わると再計測する。後から表示された行 (グループ展開・同期・スクロール) の内容が
  列幅より長ければその列を広げる (広げる方向のみ。スクロールで列幅が揺れないようにする。行の追加が 150ms 止まってからまとめて測り、スクロール中の毎フレーム計測はしない)。(b) 列境界のダブルクリックでその列を内容幅に合わせる。
  (c) ペインが列幅の合計より狭いときは、まず優先度の低い列を順に一時的に隠す (My Reviews: Target → Role → Created → Review age、
  My Pull Requests: Target → Created、PR Search: Branch → Date、Work Items: Tags → Project → Changed。Title を 200px として
  計算し、収まった時点で止める。ペインを広げれば戻り、Columns メニューの表示設定やコピー対象の列は変えない)。それでも足りなければ
  余白列 (Title) を 200px まで縮めてから他の列を見出し幅まで縮め、残りは横スクロールにする (保存幅は変えない表示上の調整)。ドラッグかダブルクリックで手動モードになり (`<storageKey>:mode` に保存)、
  手動モード中だけステータスバーに `Fit` ボタン (Columns の左) を出し、押すと自動モードに戻って全列を再計測する。
  検索画面 (PR Search / Work Items) の条件欄は `src/components/SearchBar.tsx` の部品で揃え、ラベルなしの
  1 行 (検索ボックス・スコープ選択・Filters 開閉ボタン〔設定済み件数バッジ〕・Search ボタン) に並べ、頻度の低い条件は
  Filters で開く 2 行目に置く。ネイティブ `<select>` は `NativeSelect` でカスタムドロップダウンと同じ枠・矢印に揃える。
  空のグリッド/プレビューは `PreviewEmptyState` (高さの 1/3 付近に 1 行 + キーボードのヒント) で統一する。
  dockview のパネルタブは、非表示タブを muted 色、表示中タブを太字 + primary の下線で示す。
  ドック (`DockableWorkspace`) は横並びパネルの最小幅合計 (`minRowWidth`) を下回る幅では右ペインを切らず、横スクロールにする。
- サーバ状態は TanStack Query 経由。ミューテーションで画面表示が変わる場合は該当クエリキーを更新/無効化する。
- 長いリストは既存のローカル windowing で仮想化する。スクロール位置の state は行を描くコンポーネントに持たせる (`useVirtualRowWindow`。Work Items グリッドは `WiGridBody`)。グリッドの親に持たせると、1 行スクロールするたびにヘッダー・ステータスバー・プレビュー・ドックの全パネルまで再描画される。
  通常のスクロール更新は非同期にまとめる。最後に描画が完了した位置からの移動が予備描画の範囲 (overscan − 1 行) を超える場合だけ、scroll イベント内で viewport の state を同期更新し、高速スクロールやスクロールバーの大移動で古い行の範囲が描画されるのを防ぐ。スクロール位置が同じ行内にある間は再描画しない。初期計測とリサイズは同期更新の対象にしない。
- 広範なリファクタは要求された変更に必要な場合のみ行う。
- テキスト入力の Enter / Escape / Tab は IME 変換中 (`isImeComposing`: `isComposing` または `key === "Process"`) は無視する。変換の確定・取り消しで検索実行・候補確定・メンション挿入・フォーカス移動が起きないようにするため、コマンドパレット、Code 検索、設定フィルタ、フィルタ候補、コメント入力、各種インライン編集欄、グローバルの Escape が共通で従う。
- 破壊的・不可逆な操作の確認 (組織削除、PR コメント削除、レビュアー削除、PR の Complete / Abandon など) はネイティブの `window.confirm` ではなく `ConfirmDialog` (`role="alertdialog"`、初期フォーカスは Cancel、Esc でキャンセル、閉じたら起点要素へフォーカス復帰) を使う。パイプラインの Re-run / Cancel はインライン確認バー。
- **Project info (Settings、issue #541)**: Settings の「Project」カテゴリ。アクティブな接続の 1 プロジェクトについて、チームとメンバー (`list_project_teams`: `projects/{id}/teams` と各チームの `members`。先頭 20 チームまで、超過時は注記)、サービス接続 (`list_service_connections`: `serviceendpoint/endpoints`。資格情報は読まない)、サービスフック (`list_service_hooks`: `hooks/subscriptions` をプロジェクトで絞り込み。Webhook URL などの consumerInputs は読まない) を読み取り専用で表示する。各セクションは `<details>` で、開いたときだけ取得する (権限不足などの失敗はそのセクションだけに表示)。チーム編集・接続/フックの作成・セキュリティ/権限設定の閲覧・Area/Iteration Path の編集は対象外。GitHub 接続は未対応 (`NotSupported`)。
- **廃止したビュー**: Analyze (WIQL の履歴集計・グループ管理) は削除し、`G → A` は Agent Auto Queue に割り当てた。Code (Files) ビュー (ファイル閲覧・コード検索・ブランチ/タグ管理・PR 作成) と Commits ビュー (コミット検索・バックグラウンドのコミット同期) は、Azure DevOps のレート制限 (TSTU 遅延) を招く API 呼び出しを減らすため削除した。コマンドパレットのコミット/コード検索 (`c:` / `code:`) と Analyze のブランチ別コミット推移も併せて削除。PR プレビューの Commits / Files changed タブも同じ理由で削除した (コミット一覧 `list_pull_request_commits` は Linked Work Items の `AB#NNN` 抽出、変更ファイル一覧 `list_pull_request_changes` は複数選択時のファイル重複検出で引き続き使う)。
- **対象外として確定した領域 (issues #538, #540)**: Test Plans (テストケース管理・実行)、Artifacts (パッケージフィード)、Wiki の編集、Azure DevOps 標準の通知購読 (個人/チーム) の閲覧・編集連携は実装しない。DevDeck は PR / Work Item / Commit / Pipeline / Code を横断する個人ダッシュボードで、これらは別プロダクト相当の大型機能になるため。通知は DevDeck 独自のローカルルール (§5) だけで管理し、ADO 側の購読設定とは意図的に非連動とする。Wiki は検索 + 読み取りプレビュー (`wiki:` パレット検索) まで。

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

デスクトップ版を偽の Azure DevOps で動かす: `pnpm tauri:fake` (`scripts/fake-ado/`)。偽サーバーを起動し、環境変数
`DEVDECK_ADO_BASE_URL` (REST の送り先) と `DEVDECK_DATA_DIR` (SQLite と共有キャッシュの置き場。既定
`%LOCALAPPDATA%\DevDeck-fake\<scenario>`) を付けて `tauri dev` を Vite ポート 1430 で起動する (通常の
`pnpm tauri dev` と並べて動かせる)。初回は Settings で組織 `fake` を PAT 認証 (任意の文字列) で追加する。シナリオは
`scenarios/<name>.mjs` で、`pnpm fake-ado:next` で次の段階 (新しいコメント) に進める。オプション: `--fresh` (データ
フォルダを消す。`DevDeck-fake` 配下のみ)、`--many-prs` (走査上限を超える数のレビュー PR)、`--reject-recent-mentions`
(`@RecentMentions` を拒否)、`--server-only`。どちらの環境変数も未設定なら通常どおり `dev.azure.com` と本来のデータ
フォルダを使う。

---

## 関連ドキュメント

- 設計解説 (初心者向け): [`docs/design/README.md`](design/README.md)
- 提案/将来計画: `docs/spec-daily-flow.md` (トレイ常駐・ディープリンクは仕様のみ),
  `docs/spec-cross-cutting-efficiency.md` (横断・運用効率),
  `docs/spec-reliability-foundation.md` (信頼性・基盤),
  `docs/spec-pr-review.md`, `docs/spec-keyboard-ux.md`,
  `docs/spec-ideas-market-research.md`, `docs/product-improvement-ideas.md`
- デモ/E2E: `docs/demo-harness.md`, `docs/e2e-agent-ui-checks.md`
- エージェント向け規約: [`AGENTS.md`](../AGENTS.md)
</content>
</invoke>
