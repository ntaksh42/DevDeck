# 03. データフロー（処理の流れ）

このページは、画面で操作したことが **裏側でどう処理され、結果が返ってくるか** を追います。
「ボタンを押すと何が起きるの？」に答えるページです。

> 編集可能な drawio 版: [`diagrams/data-flow.drawio`](diagrams/data-flow.drawio)

---

## まず大前提：2つの実行モード

AzDoDeck は **2通りの動かし方** があり、データの行き先が変わります。
ここを理解すると、後の図がぐっと分かりやすくなります。

```mermaid
flowchart TD
    Start["画面が azdoCommands の関数を呼ぶ"]
    Check{"isTauriRuntime()<br/>デスクトップ？"}
    Desktop["デスクトップ (pnpm tauri dev / 配布アプリ)<br/>invoke() で Rust を呼ぶ<br/>→ 本物の Azure DevOps"]
    Browser["ブラウザ (pnpm dev)<br/>demoInvoke() を呼ぶ<br/>→ 偽のデモデータを返す"]

    Start --> Check
    Check -->|はい| Desktop
    Check -->|いいえ| Browser

    classDef d fill:#dcfce7,stroke:#22c55e,color:#14532d;
    classDef b fill:#f3e8ff,stroke:#a855f7,color:#581c87;
    class Desktop d;
    class Browser b;
```

- **デスクトップモード**（`pnpm tauri dev`、または配布された `.exe`/`.msi`）
  … 本物の Tauri が動いており、`invoke()` で Rust を呼び、実際の Azure DevOps に繋がります。
- **ブラウザモード**（`pnpm dev`）
  … Tauri が無い環境。UI開発を素早く回すために、`demoInvoke()` が **偽のデモデータ** を返します。
  本物のクラウドには一切繋がりません。

> **なぜ2モードあるの？**
> 画面（UI）の見た目や操作を試すだけなら、毎回クラウドに繋ぐのは遅くて不便です。
> ブラウザモードなら、ネット接続も認証もなしに、すぐ画面を確認できます。
> この切り替えは `src/lib/azdoCommands.ts` が自動で行うため、画面側のコードは同じまま動きます。

---

## 読み取りの流れ（例：プルリクエスト検索）

「PR検索」で[検索]ボタンを押したときの、デスクトップモードでの道のりです。

```mermaid
sequenceDiagram
    autonumber
    participant UI as 画面 (React)
    participant Cmd as azdoCommands.ts<br/>(フロント境界)
    participant Tauri as Tauri IPC
    participant Lib as lib.rs<br/>(コマンド層)
    participant Svc as PullRequestService<br/>(ドメインサービス)
    participant DB as SQLite キャッシュ
    participant Client as azdo-client
    participant ADO as Azure DevOps REST

    UI->>Cmd: searchPullRequests(条件)
    Cmd->>Tauri: invoke("search_pull_requests", 条件)
    Tauri->>Lib: search_pull_requests(入力)
    Lib->>Svc: service.search(入力)
    Svc->>DB: キャッシュを参照
    alt 新しく取得が必要
        Svc->>Client: get_json(...)
        Client->>ADO: HTTPS リクエスト
        ADO-->>Client: JSON 応答
        Client-->>Svc: 変換済みデータ
        Svc->>DB: 結果を保存（キャッシュ更新）
    end
    Svc-->>Lib: 結果
    Lib-->>Tauri: 結果(JSON)
    Tauri-->>Cmd: 結果(JSON)
    Cmd->>Cmd: Zod で形を検証
    Cmd-->>UI: 検証済みデータ
    UI->>UI: TanStack Query が表を更新
```

ポイント:

- 画面は **直接クラウドを呼ばない**。必ず「フロント境界 → IPC → コマンド層 → サービス → 通信係」の順。
- サービスは **まず SQLite キャッシュ** を見て、必要に応じて Azure DevOps に取りに行きます。
- 返り値は **Zod で検証** されてから画面に渡るので、壊れたデータが表示されにくい。

---

## 書き込みの流れ（例：PRへのコメント投稿・投票）

データを「読む」だけでなく「変更する」操作（コメント投稿、投票、作業項目の状態変更など）もあります。
読み取りとの違いは、**書き込みガード** が入る点です。

```mermaid
sequenceDiagram
    autonumber
    participant UI as 画面 (React)
    participant Cmd as azdoCommands.ts
    participant Lib as lib.rs (コマンド層)
    participant Guard as ensure_write_enabled()
    participant Svc as PrReviewService
    participant Client as azdo-client
    participant ADO as Azure DevOps REST

    UI->>Cmd: postPullRequestComment(...)
    Cmd->>Lib: invoke("post_pull_request_comment", ...)
    Lib->>Guard: 書き込み可否を確認
    alt 読み取り専用モードが有効
        Guard-->>UI: エラー（書き込み禁止）
    else 通常モード
        Lib->>Svc: post_comment(...)
        Svc->>Client: post_json(...) で送信
        Client->>ADO: HTTPS (POST)
        ADO-->>Client: 作成結果
        Client-->>Svc: 結果
        Svc-->>UI: 投稿されたスレッド
    end
```

ポイント:

- 書き込み系コマンド（`post_pull_request_comment`、`submit_pull_request_vote`、
  `set_work_items_state` など）は、最初に **`ensure_write_enabled()`** を通ります。
- 設定で **「読み取り専用バリデーションモード」** が有効なときは、ここで止めて
  誤って本番データを変更しないようにします（動作確認時の安全装置）。
- 画面に変更が反映されるよう、フロント側では関連する **TanStack Query のキャッシュを更新/無効化** します。

---

## 通信の信頼性：リトライとエラー処理

クラウドとの通信は、混雑や一時的な障害で失敗することがあります。
`azdo-client`（`AdoClient`）は、共通の入口（`get_json` / `post_json` 等）で次のように対処します。

```mermaid
flowchart TD
    Req["リクエスト送信"]
    Resp{"応答は？"}
    OK["成功 (2xx)<br/>→ JSON を返す"]
    U401["401 認証切れ<br/>→ Unauthorized エラー"]
    R429["429 混雑<br/>(Retry-After 尊重)"]
    E5xx["5xx サーバ障害"]
    Retry{"再試行の<br/>余地あり？"}
    Wait["少し待つ<br/>(指数バックオフ)"]
    Fail["エラーを返す<br/>(AppError → 画面へ)"]

    Req --> Resp
    Resp -->|2xx| OK
    Resp -->|401| U401
    Resp -->|429| R429
    Resp -->|5xx| E5xx
    R429 --> Retry
    E5xx --> Retry
    Retry -->|あり| Wait --> Req
    Retry -->|なし| Fail

    classDef ok fill:#dcfce7,stroke:#22c55e,color:#14532d;
    classDef err fill:#fee2e2,stroke:#ef4444,color:#7f1d1d;
    class OK ok;
    class U401,Fail err;
```

具体的な既定値（`crates/azdo-client/src/client.rs`）:

- **試行回数**: 最大 3 回
- **待ち時間の基準**: 250 ミリ秒から始め、回を追うごとに倍に（指数バックオフ。上限 2 秒）
- **429（混雑）**: サーバが返す `Retry-After` を尊重（上限 5 秒でキャップ）
- **再試行する条件**: 429 / 5xx の応答、または接続・タイムアウトのネットワークエラー
- **401（認証切れ）**: 再試行せず、すぐ認証エラーとして返す

エラーは Rust 側で **`AppError`**（`src-tauri/src/error.rs`）にまとめられ、JSON の `message` として
画面へ届きます。画面側は `commandErrorMessage()` でその文言を取り出して表示します。

---

## IPC を増やす/変えるときの「4点契約」

新しいコマンド（機能）を1つ足すときは、**4か所をセットで** 直すのがこのプロジェクトの決まりです
（`AGENTS.md` 由来）。1か所でも欠けると、ブラウザモードや型チェックが壊れます。

```mermaid
flowchart LR
    A["① lib.rs<br/>#[tauri::command] を追加し<br/>generate_handler![] に登録"]
    B["② ドメインサービス<br/>(prs.rs など) に<br/>実処理を書く"]
    C["③ azdoCommands.ts<br/>呼び出し関数 + Zodスキーマ<br/>+ ブラウザ用デモ分岐"]
    D["④ React の画面<br/>その関数を呼ぶ"]
    A --> B --> C --> D
```

| # | 場所 | やること |
|---|---|---|
| 1 | `src-tauri/src/lib.rs` | `#[tauri::command]` 関数を追加し、`generate_handler![]` に登録 |
| 2 | 対応するサービス（`prs.rs` 等） | ドメインの実処理を実装 |
| 3 | `src/lib/azdoCommands.ts` | 呼び出し関数・**Zodスキーマ**・**ブラウザ用デモ分岐** を追加 |
| 4 | React の機能コンポーネント | 追加した関数を呼ぶ |

> ③のデモ分岐とスキーマは「後回しの飾り」ではなく **必須作業** です。
> これが無いとブラウザモードが動かなくなります。

---

## 次のページへ

最後に、データが「どこに保存され、どう最新化されるか」を見ていきます。

→ [04-data-and-sync.md](04-data-and-sync.md)
