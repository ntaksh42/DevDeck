# 仕様書: 日常フロー改善 (トレイ常駐 / PR 次アクション / 前回閲覧以降の差分 / ディープリンク / 設定の移行)

ステータス: 提案 + 一部実装。各節の「実装状況」を参照。

目的: 「ウィンドウを閉じても通知が届き」「一覧を見れば次にやることが分かり」
「前回から何が変わったかが分かり」「外部の URL からそのまま開け」「環境を持ち運べる」
状態にする。新しい Azure DevOps API は使わず、同期済みキャッシュとローカル保存だけで成立させる。

---

## 1. PR の「次アクション」判定 (Next action)

実装状況: 実装 (フロント純関数 + 列/バッジ)。

### 1.1 状態

| 状態 | 意味 | 表示 |
|---|---|---|
| `needsMe` | 自分の投票/対応待ち | 赤 |
| `waitingAuthor` | 自分は投票済み (待機/要修正)。著者の更新待ち | 琥珀 |
| `ciFailed` | CI 失敗。著者が直すまで待ち | 赤 |
| `ciRunning` | CI 実行中 | 青 |
| `conflict` | マージコンフリクトあり | 赤 |
| `readyToMerge` | 承認済みでマージ可 (自分の PR) | 緑 |
| `waitingReviewers` | レビュー待ち (自分の PR) | 灰 |
| `draft` | ドラフト | 灰 |
| `done` | 自分の対応は不要 (承認/却下済みなど) | 灰 |

### 1.2 判定規則 (`src/features/pull-requests/nextAction.ts`、純関数)

My Reviews (`ReviewPullRequestSummary`) — 先に当たった規則を採用:

1. `isDraft` → `draft`
2. `mergeStatus` が conflicts → `conflict`
3. `ciStatus === "failed"` → `ciFailed`
4. `myVote === 0` → `needsMe`
5. `myVote` が 5 (承認+コメント) または -5 (待機)、-10 (却下) → `waitingAuthor`
6. それ以外 (10 = 承認) → `done`

My Pull Requests (`MyCreatedPullRequestSummary`):

1. `isDraft` → `draft`
2. `readyToMerge` → `readyToMerge`
3. それ以外 → `waitingReviewers`

(作成 PR の要約には CI/コンフリクトが無いため、判定しない。要約に追加された時点で
 My Reviews と同じ規則を適用する。)

### 1.3 UI

- 判定は `nextAction.ts` の純関数として実装済み。既存のバッジ (Ready to merge / Conflicts / Returned) は変えない。
- My Pull Requests では `N` / `Shift+N` で、一覧内の次/前の「自分の対応が要る行」
  (`needsMe`・`conflict`・`ciFailed`・`readyToMerge`) へ選択を移す (端で折り返す。該当なしなら動かない)。
  入力欄にフォーカスがある間は無効。ヘルプ (`?`) に載せる。
- My Reviews への `N` 配線は未実装 (グリッドが 500 行上限に近いため、キー処理を分割してから行う)。

---

## 2. 前回閲覧以降の差分 (Changed since last view)

実装状況: 実装 (ローカル保存 + 判定 + バッジ)。

- 項目を選択して開いたとき、その項目の観測可能な状態の指紋 (fingerprint) をローカルに保存する
  (`src/lib/lastSeen.ts`: `markSeen` / `changedSince` / `fingerprintOf`)。
  - My Reviews の PR の指紋: タイトル・ドラフト・マージ状態・CI 結果・ターゲットブランチ
    (`reviewFingerprint.ts`)。自分の投票は含めない (自分の操作は更新ではないため)。
  - 作業項目 (rev) への適用は未実装。
- 同期後の指紋が保存済みの指紋と異なる行に「Updated」バッジを出す。一度も開いていない項目は対象外。
  「Returned」バッジが出ている行では重ねて出さない。開いた時点で既読になる。
- 保存は localStorage (`azdodeck:lastSeen:v1`)。上限 2000 件で古い順に捨てる。
  サーバ側の既読情報は使わない (Azure DevOps に公開 API が無いため)。

---

## 3. 設定のエクスポート / インポート

実装状況: 実装 (Settings > Data & sync)。

- エクスポート: ローカル設定を 1 つの JSON ファイルにする。
  - 対象: **許可リスト**の接頭辞に一致する localStorage キーのみ (`src/lib/settingsTransfer.ts`):
    レイアウト、ビュー、キー割り当て、行の色ルール、保存済み Work Item View / テンプレート / フィールドプリセット、
    Analyze グループ、Quick Pipelines、パイプライン購読、テーマ、UI スケール。
  - **除外**: 許可リストに無いキー全般 (最終閲覧、返却追跡、最近開いた項目、検索履歴など個人の行動履歴)。
    加えて、許可リストに一致しても `pat|token|secret|password|credential|azure-cli` を含むキーは拒否する (二重防御)。
- インポート: JSON を検証 (`app: "devdeck"`、`version: 1`、値は文字列のみ、許可リストのキーのみ。
  それ以外は件数を数えて無視) し、確認ダイアログ (`ConfirmDialog`、初期フォーカスは Cancel) の後に上書き保存して再読み込みする。
  不正なファイルはエラー表示のみで何も書かない。
- アプリ設定 (SQLite の `AppSettings`) は対象外 (組織・シークレットとの関係が複雑なため、将来拡張)。

---

## 4. トレイ常駐

実装状況: 仕様のみ (Rust/Tauri 側の実装が必要。本環境では Tauri のビルド依存が無く検証できないため未実装)。

- ウィンドウの閉じるボタンで終了せずトレイに格納する (設定 `close_to_tray`、既定 off)。
  格納中も同期ループと通知は動き続ける。
- トレイアイコン: 未対応件数 (My Reviews の未投票 + Inbox の Open) をツールチップに出す。
  左クリックでウィンドウを表示/前面化、右クリックメニューに「Open」「Sync now」「Quit」。
- 起動時に自動開始する設定 (`launch_at_startup`) を追加する。
- 実装方針: Tauri 2 の `tray-icon` feature、`on_window_event` の `CloseRequested` で
  `prevent_close()` + `hide()`。`SCHEMA_VERSION` の移行で設定列を追加し、
  IPC 4 層契約 (lib.rs / settings.rs / azdoCommands.ts + デモ / Settings UI) に従う。
- 受け入れ基準: 閉じても `sync:updated` が発火し続ける。トレイの Quit で完全終了する。

---

## 5. ディープリンク

実装状況: 仕様のみ (Rust/Tauri 側の実装が必要。上と同じ理由で未実装)。

- スキーム `devdeck://` を登録する (`tauri-plugin-deep-link` + 単一インスタンス)。
- 形式:
  - `devdeck://pr/{org}/{project}/{repo}/{id}`
  - `devdeck://wi/{org}/{id}`
- 既に起動中なら新規ウィンドウを作らず既存ウィンドウへ渡す。受け取ったら、
  既存のコマンドパレット URL 解決 (`src/app/paletteUrl.ts`) と同じ経路で PR Search / Work Item Search を開く。
- 未登録の組織名は「not registered」を表示し、何も開かない。
- 受け入れ基準: 不正な形式・余分なパスは無視する。外部入力なので ID は数値のみ許可する。

---

## 6. 横断する制約

- ブラウザデモ (`pnpm dev`) を壊さない。本書の実装済み部分はすべてフロントのみで、デモでも動く。
- 配色はデザイントークンを使い、手書きのライト/ダーク色ペアを増やさない。
- 新規 UI は完全にキーボード操作できること。
