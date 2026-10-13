# Inbox「その場で判断できる」改善 設計仕様案

- 日付: 2026-10-13
- 対象アプリ: AzDoDeck (Tauri + React + Rust)
- ステータス: **案（レビュー待ち）**。合意後に `docs/spec-overview.md` の Inbox 節を更新して実装する。

## 1. 背景 / 課題

Inbox は「自分が対応すべきもの」を一覧し、その場で返信・Resolve・Done できる。
しかし実際には、項目を見ても**何をすればよいか判断できず、毎回ブラウザで開いている**。

現状のプレビュー (`InboxPreview` / `InboxPreviewPanels`) が出す情報:

| 項目 | 現状 | 足りないもの |
| --- | --- | --- |
| PR メンション / 返信 (`pr_mention` / `pr_reply`) | スレッドのコメント列 (`PrThreadCard`) とファイルパス | コメント対象の**コード** (該当行の前後)、PR の説明、このスレッドが PR 全体の中でどういう位置かの情報 |
| 自分の PR へのコメント | 同上 | 同上 |
| Returned (`pr_returned`) | 自分の投票ボタンと PR 説明 | 何が push されたか (新しいコミット / 変更ファイル) |
| WI (`wi_assigned` / `wi_mention`) | 状態・担当・優先度とコメント | 本文 (Description / Repro steps)、親 / 関連 |
| 承認待ち | 承認 / 却下ボタン | どのパイプライン・ブランチ・誰の実行か |

操作面の不足: Done / Snooze のあと次の項目へ自動で進まない、誤操作の取り消しがない、
Resolve + Done はボタンのみでキーがない、プレビューを読み進めるたびに `Enter` → `Esc` で
一覧とプレビューを往復する必要がある。

## 2. ゴール / 非ゴール

### ゴール

- 項目を選んだだけで、**「何についての、どんな依頼か」と「返信 / Done の判断材料」**がプレビュー内で揃う。
- 一覧 → 判断 → 処理 → 次の項目、をキーボードだけで往復できる (既存の `E` / `Z` / `R` の流れを崩さない)。
- ブラウザを開くのは「Azure DevOps 固有の操作が必要なとき」だけにする。

### 非ゴール

- コードレビュー全体 (全ファイル diff、行コメント投稿) の再実装。それは My Reviews の領分。
- 検出対象の拡大 (新しい項目種別の追加)。本案は表示と操作の改善に限る。
- 状態を Azure DevOps へ書き戻すこと (従来どおりローカルのみ)。

## 3. 表示の改善

### 3.1 Context セクション (新設、Conversation パネル上部)

見出し直下、`Thread` バンドの前に折りたためる `Context` を置く。既定は展開、
開閉状態は項目種別ごとに `localStorage` へ保存する。

**PR のスレッド系 (`pr_mention` / `pr_reply` / 自分の PR へのコメント)**

1. **コードスニペット**: `thread.filePath` と `rightLine` (削除行なら `leftLine`) があるとき、
   該当行の前後 各 5 行を行番号付き・等幅で表示し、コメント行を強調する。
   - 取得元: 既存の `get_pull_request_file_diff` (`baseContent` / `targetContent`)。
     新しい IPC は作らない。選択したときだけ遅延取得し、`prFileDiff` クエリキーで 5 分キャッシュする。
   - 取得できない (`*UnavailableReason`、バイナリ、巨大ファイル) ときは理由を 1 行で出し、
     スニペット欄を畳む。エラーで他のプレビューを塞がない。
   - 行コメントでないスレッド (PR 全体へのコメント) はスニペット欄を出さない。
2. **PR 要約行**: `!ID タイトル`、作成者、`source → target`、ドラフト、自分の投票、
   必須レビュアーの未投票数。説明 (`description`) は先頭 3 行を畳んで表示し、`D` で全文展開。
3. **スレッドの位置づけ**: 同じファイルの未解決スレッド数 (`同じファイルに他に N 件`) と、
   PR 全体の未解決スレッド数。押すと My Reviews の該当 PR を開く (`Shift+Enter` と同じ)。

**Returned (`pr_returned`)**: 要約行に加え、直近の push のコミット一覧 (最大 5 件、
`list_pull_request_commits` 既存) と変更ファイル数を出す。

**WI (`wi_assigned` / `wi_mention`)**: 状態・担当・優先度の行は現状維持。
その下に Description / Repro steps (サニタイズ済み HTML、先頭を畳む。`D` で全文)、
親 WI のタイトル、直近の状態変更を 1 行で出す。取得は既存の `getWorkItemPreview` の
返却を拡張するか、足りなければ同コマンドへ項目を足す (IPC 4 点セットとデモ分岐を揃える)。

**承認待ち**: パイプライン名、ブランチ、実行者、待機開始からの経過時間、承認対象の環境を出す。

### 3.2 リンクの扱い

コメント内の `AB#n` / `!n` / URL は現状どおりプレビュー下部に番号付きで並べ、`1`-`9` で開く。
変更点: 同一 URL の重複を除き、ラベルにリンク先の種別 (WI / PR / 外部) を添える。

### 3.3 一覧行

行のスニペットは「最新コメントの冒頭」を維持しつつ、**行コメントなら `ファイル名:行`** を先頭に付ける
(例: `Foo.cs:42  null チェックが…`)。選ばなくてもコード上の位置が分かる。

## 4. 操作の改善 (キーボード)

既存の割り当て (`J K ↑ ↓ Home End PageUp PageDown`, `Enter/→`, `Esc`, `E`, `Z`, `R`, `Q`, `C`, `O`,
`Shift+Enter`, `1`-`9`, `/`) は変えない。追加するもの:

| キー | 動作 |
| --- | --- |
| `Space` / `Shift+Space` | 一覧にフォーカスしたまま、プレビューを 1 画面ぶんスクロール。`Enter` / `Esc` の往復を減らす |
| `D` | Context の説明 / Description の展開・折りたたみ |
| `Shift+E` | Resolve + Done (スレッド系のみ。現状ボタンだけ) |
| `U` | 直前の Done / Snooze / Resolve + Done を元に戻す (本セッション内、直近 1 件。5 秒間トーストで案内) |
| `E` / `Z` / `Shift+E` 後 | 次の行を選択して一覧にフォーカスを残す (最後の行なら 1 つ前)。現行は処理後に `focusList()` するのみで、選択の移り先は実装時に確認して明示的に固定する |

- Snooze メニュー (`SnoozeMenu`) の既存プリセットを数字キーでも選べるようにする (割り当ては実装時に現行の並びへ合わせる)。
  既存の `↑↓` + `Enter` 操作は残す。
- 新しい `D` / `U` / `Space` は Help の Inbox 節と、プレビューのツールチップに載せる。
- 追加 UI (Context の折りたたみ、トースト) は、Esc で閉じてフォーカスを一覧へ戻す。

## 5. データ / IPC への影響

| 変更 | 影響 |
| --- | --- |
| コードスニペット | 既存 `get_pull_request_file_diff` を再利用。Rust 変更なし |
| PR 要約 / Returned | 既存 `prReview` キャッシュ (`description` / `reviewers` / `threads`) と `list_pull_request_commits` を再利用 |
| WI Description / 親 | `getWorkItemPreview` の拡張が必要な場合のみ。`azdoCommands.ts` のスキーマとデモ、Rust サービス、`lib.rs` の登録を揃える |
| 承認待ちの詳細 | `pipeline_approval` の導出データに項目を足す (Rust の導出とデモ) |
| Undo | フロントのみ。`set_action_inbox_item_state` で直前の状態へ戻す |
| スキーマ | **変更なし** (`SCHEMA_VERSION` は据え置き) |

## 6. 受け入れ条件

- PR の行コメント項目を選ぶと、ブラウザを開かずに該当行の前後コードとコメント、PR 説明の冒頭が見える。
- WI 項目を選ぶと、状態・担当に加えて本文の冒頭が見える。
- `E` で Done にすると次の行が選択され、`U` で戻せる。すべてキーボードだけで完結する。
- ファイル取得に失敗しても返信・Done・Snooze は使える。
- ブラウザのデモモードで、スニペット / Description / Undo が動く (`azdoDemo.ts` に fixture を追加)。
- Playwright (`tests/e2e/inbox-actions.spec.ts`, `inbox-focus.spec.ts`) に自動前進・Undo・`Space` スクロールと、
  Done 後のフォーカスが一覧に残ることを追加する。

## 7. 実装の分割案

1. 操作: 自動前進 + `U` Undo + `Shift+E` + `Space` (フロントのみ、小さい)
2. PR 側 Context: 要約行 + コードスニペット + 行ラベル
3. WI 側 Context: Description / 親 (IPC 拡張を含む)
4. 承認待ち / Returned の詳細

1 から順に別 PR にでき、1 だけでも体感は改善する。

## 8. 未決事項

- スニペットの前後行数 (5 行で足りるか)。
- Undo を複数段にするか (本案は直近 1 件)。
- 自動前進を設定で切れるようにするか (本案は常時オン)。
- WI の Description を `getWorkItemPreview` に足すか、別コマンドにするか (返却サイズ次第)。
