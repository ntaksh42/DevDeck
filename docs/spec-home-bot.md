# 仕様書: Home (Look around と Orchestrator チャット)

Home は、DevDeck が同期した PR・Work Item・Inbox・Agent の会話を横断して読み、次に手を付けるものを提案するビューである。右ペインでは Orchestrator と常設のチャットで話せる。Orchestrator は質問に答え、コードやログを読む作業を worker に任せ、結果を要約して同じチャットに返す。Look around と Orchestrator は読み取り専用で動き、Azure DevOps には書き込まない。

設計の参考は Orca の Bot (stablyai/orca `src/main/bots`: Look around / Up next / Home Chat) である。設計時の比較と画面案は `C:\Users\aksh0\reports\proposals\proposal014.html` にある。

## 画面

- サイドバー最上位 (Inbox の上) の **Home**。`G` → `H` で開く。未読の提案があれば件数バッジを出す (Home を開いている間は出さない)。
- ドック 3 枚 (`azdodeck:home:dockview:v1`): **Suggestions** (左)、**Orchestrator** と **Workers** (右、同じグループのタブ)。開いた直後は Orchestrator タブを前に出し、フォーカスは提案一覧に置く。
- Suggestions: 上にブリーフ (最後に成功した見回りの 1〜3 行。使ったエージェント・モデルは見出しのツールチップ)、下に提案。提案は 3 件まで出し、残りは「Show n more」。選択行は理由を折り返して全文出す。依頼文は出さず、Start で入力欄に入れる。見回り中はタブ帯の時刻が「Looking…」になり、最後の見回りが失敗していればその理由を 1 行の帯で出す (帯はボタンで、Enter かクリックで全文を展開、Esc で提案一覧へ戻る)。タブ帯の右に最終見回りの時刻と Look now ボタン、ステータスバーに件数・未読数・次の見回り時刻と、主なキー (Q / E / L) の案内を出す。残りのキーは `?` で開く Help の Home 節に載せる。
- Orchestrator: 一般的なチャットアプリの形にする。日付の区切り線、自分の発言は右寄せの青い吹き出し (時刻はホバー時)、Orchestrator は左にアバターと名前・時刻 (同じ発言者が続く間は省く) と灰色の吹き出し (4 行を超える返信は畳み、「Show more」/「Show less」のボタンで開閉する)、返信中は入力中の 3 点表示。上にスクロールしている間に新しい発言が来たら「New messages」ボタンを出す。空のチャットには書き出しの候補を出す。ブリーフがあればその各行 (最大 3 行) から「<行> について詳しく」を作り、無ければ固定の 3 つを出す。押すと入力欄に入る。Orchestrator が起動した worker は発言の下にカードで出し、クリックで Agent パネルのその会話を開く。DevDeck 自身の注記 (実行しなかった指示など) は琥珀色の 1 行で出す。タブ帯の右に状態 (Thinking / Waiting on n workers / Idle) と New chat。入力欄は常に開いた角丸の枠で、文字数に応じて伸びる (最大 200px)。枠の上端に対象のチップ (`About !798`)、下端に Claude / Codex の切り替え・モデル・送信ボタン (`HomeChatComposer`)。エージェントとモデルの初期値は Home Bot 設定で、送信のたびに初期値へ戻る。
- Workers: このチャットから起動した worker を新しい順に並べる。状態は Queued / Running / Needs you / Done / Failed / Stopped。ステータスバーに実行中の数と上限 10。

## キー

| キー | 場所 | 動作 |
| --- | --- | --- |
| `G` → `H` | どこでも | Home を開く |
| `↑` / `↓` | 提案一覧 | 移動 (4 件目以降へ移ると全件を表示) |
| `Q` | 提案一覧 | Start: 依頼文を Orchestrator の入力欄に入れ、対象をチップに付けてフォーカスする。送信はしない |
| `E` | 提案一覧 | Dismiss (次の提案を選ぶ) |
| `L` | 提案一覧 | Look now |
| `M` / `Enter` / `→` | 提案一覧 | Orchestrator の入力欄へ |
| `W` | 提案一覧 | Workers タブへ |
| `N` | 提案一覧 | New chat |
| `O` / `Ctrl+Enter` | 提案一覧 | 対象をブラウザで開く |
| `Enter` / `Shift+Enter` | 入力欄 | 送信 / 改行 (IME 変換中の Enter は送らない) |
| `Esc` | 入力欄・Workers | 提案一覧へ戻る (入力中の文は残す) |
| `Enter` | Workers | worker の会話を Agent パネルで開く |
| `X` → `Enter` / `Esc` | Workers | worker を止める / 取り消す (行内で確認) |

## Look around

- 実行: `run_home_look_now`、またはスケジュールの枠。DevDeck が同期キャッシュから概要 (Markdown、最大 6 万字) を作り、エージェントを読み取り専用で起動する。概要に入るのは、接続ごとの Inbox の未処理 (判断メモの判定付き)、レビュー対象 PR (自分の投票・CI・マージ状態)、自作 PR (承認数・マージ可能か)、割当 WI と、Needs you の Agent 会話。各行の先頭に対象キー (`pr:{org}/{repositoryId}/{id}` / `wi:{org}/{id}`) を付ける。見回りのときだけ、Pipelines ビューで Watch しているパイプライン (先頭 30 件) の最新の実行を API で読み、失敗・一部失敗・取り消しのものを URL 付きで、残りは件数だけ「Watched pipelines」の節に入れる (読めなかったものは理由を書く)。Watch 一覧はフロントの localStorage にあるので、保存のたびと Home を開いたときに `save_home_pipelines` で `app_settings` の `home_bot_pipelines` に写す。パイプラインの提案は対象キーを持たない。Orchestrator のターンの概要にはパイプラインを入れない。
- 出力: JSON `{brief: string[], suggestions: [{title, why, ask, target}]}`。DevDeck が検証し、題 40 字・理由 80 字・依頼文 2000 字・ブリーフ 3 行 (各 60 字)・提案 5 件で切る。題・理由・ブリーフの行は、切ったときに末尾を「…」にする。プロンプトでは題 25 字・理由とブリーフ各行 30 字以内の体言止めを求める。概要に無い `target` を名指しした提案は捨てる。
- 提案の状態: open / started (送信した) / dismissed / replaced。同じ提案 (対象キー、無ければ空白と大小文字を無視した題) が再び来たら元の行を更新する。見回りが成功すると、その回に出なかった open は replaced。open は 3 日で replaced、replaced・started・dismissed は 30 日で削除。dismissed から 30 日以内の同じ提案は保存しない。プロンプトには表示中・着手済み (14 日)・却下 (30 日) の題を渡す。
- 未読: Home を開いた時刻 (`mark_home_seen`) より後に作られた open の提案。
- スケジュール (ローカル時刻、夜は動かさない): Every 4 hours (8/12/16/20 時) / Every 2 hours (8〜20 時の偶数時) / **Twice a day (8・13 時、既定)** / Mornings (8 時)。既定は平日のみ。1 分ごとに確認し、その日のうちの直近の枠を 1 回だけ実行する (スリープで飛ばした枠は同じ日に取り戻す)。Home を一度も開いていない間 (未 armed)、オンにする前の枠、実行中、Look now から 1 時間以内の枠、利用上限で止まってから 1 時間は実行しない。
- 失敗: 10 回続けて失敗 (利用上限は数えない) すると Look around をオフにする。打ち切りは 10 分。終了時に実行中だった見回りは、次の起動時に失敗として記録する。

## Orchestrator チャット

- チャットは常設の 1 本 (`home_bot_chat` に現在のチャット ID)。New chat で区切る。発言は SQLite (`home_chat_messages`) に保存する。
- 返信は 3 行か箇条書き 3 点まで、挨拶・質問の言い直し・締めの申し出なしとプロンプトで指示する。worker の要約は 1 件につき 2 行以内の箇条書き 1 点。
- 1 ターン = 読み取り専用のエージェント実行 1 回 (ツールなし、打ち切り 5 分)。プロンプトには概要、worker の一覧、直近の発言 (最大 6.4 万字) と、今回の入力 (ユーザーの発言、または終わった worker の結果) を入れる。
- worker の起動・依頼・停止は、Orchestrator が返信の末尾に書く ```` ```devdeck-dispatch ```` の JSON 配列 (`start` / `send` / `stop`) を DevDeck が検証して実行する。`start` の `target` は概要の対象キーか null に限る。同じ対象で動いている worker があれば起動せず、その旨を注記する。1 ターンの起動は 10 件まで。読めない指示ブロックは何も実行せず注記する。
- worker は、対象が PR / WI でその結果フォルダ (Review / Work item result folder) が設定されていれば、その項目の Agent 会話 (`pr-{id}` / `wi-{id}`) として作り、結果 HTML をその結果フォルダに書かせる。それ以外は `ask-{id}` の会話として作る (`context_document` に対象の情報)。対象が PR / WI なのに結果フォルダが未設定か存在しないために `ask-{id}` になったときは、チャットに DevDeck の注記 (どの設定が無いか、結果 HTML は残らないこと) を出す。どの会話で答えるかは `home_dispatches.note_target` / `note_id` に残し、Workers の Enter とカードはその会話を Agent パネルで開く。既存の `run_agent` の起動経路 (`az` 未ログイン、`git push` 無効) で動かす。同時実行 10 件、待ち 10 件。PR の worker は、起動前に DevDeck が PR の差分・説明・スレッドを自動レビューと同じ形で取得して会話の資料 (`_context`) に足し (`auto_agent::material`)、Agent workspace が設定されていればリポジトリの浅いクローンを PR の head に合わせてから、そのクローンで起動する。取得に失敗したときはその理由を資料に書き、推測せずに足りないものを返信で尋ねさせる。worker は Azure DevOps には未ログインのままで、クローンからの fetch はできるが push はできない。Orchestrator には、worker にコードの取得方法を指示したりクローンを禁じたりしないよう指示する。差分を取得している間も Running として数える。エージェントは送信時に選んだもの (`start` に `agent` があればそれ)。
- worker のプロセスが終わったら、メモから状態を決める: メモを `_done/` に移していれば Done、最後の返信がエージェントなら Needs you、返信が無ければ Failed。結果 (最後のエージェント返信、最大 1.6 万字) を未報告として積み、Orchestrator を 1 ターン起こして要約させる (この要約ターンでは worker を起動しない)。ターン中に終わった分は、そのターンの後でまとめて要約する。
- 終了時に Running だった worker は、次の起動時に Failed として要約対象にする。

## PR レビューのスキル (`devdeck-pr-review`)

PR レビューの観点、結果 HTML の章立て、変更の種類 (機能追加 / バグ修正 / その他) ごとの図 (「追加された機能」の構成図、「バグの起きる仕組み」のフロー図と「直し方」の Before / After 図) は、スキル `devdeck-pr-review` に置く。正本は `~/.claude/skills/devdeck-pr-review/SKILL.md` (Claude Code が無ければ `agent-notes/skills/`) で、DevDeck は初回に既定の文 (`agent_notes/review_skill.md`) を置くだけで上書きしない。利用者が編集してよい。Codex には起動時に `~/.codex/skills/devdeck-pr-review/SKILL.md` へ写す (印の付いた写しだけを更新する)。自動レビューと Home の worker の Note 本文、結果フォルダの `AGENTS.md` の PR の節は、このファイルの絶対パスを名指しして読ませる。

## 設定

Settings → Views & workflow → **Home Bot**。値は `app_settings` の `home_bot` キーに JSON で保存する (`AppSettings` とは別、`get_home_bot` の `settings` で読む)。

| 項目 | 既定 | 説明 |
| --- | --- | --- |
| `enabled` | true | スケジュールでの見回り。Look now とチャットはオフでも使える |
| `every` | `twice-daily` | `every-4h` / `every-2h` / `twice-daily` / `mornings` |
| `weekdaysOnly` | true | 土日は見回らない |
| `agent` | `claude` | 見回りと、チャットの既定のエージェント (`claude` / `codex`) |
| `model` | `sonnet` | 空ならエージェント自身の設定 |
| `focus` | 空 | 何を探すか (500 字まで) |

却下した提案の件数と Clear (却下の記憶を消す) も同じ欄にある。

## 読み取り専用の担保

- Claude Code: `claude -p --output-format json --restricted --strict-mcp-config` に、見回りは `--tools "Read,Grep,Glob"`、チャットのターンは `--tools ""`。
- Codex: `codex exec --skip-git-repo-check --sandbox read-only --output-last-message <file> -` (書き込み・ネットワークなし)。
- どちらも Azure DevOps のトークン環境変数を外して起動する。概要と worker の結果はデータとして扱うようプロンプトで指示する。worker への指示は DevDeck が対象キーを検証してから実行する。

## IPC

`get_home_bot` / `run_home_look_now` / `mark_home_seen` / `dismiss_home_suggestion` / `start_home_suggestion` / `save_home_bot_settings` / `save_home_pipelines` (`pipelines`: Watch 一覧) / `clear_home_dismissed` / `count_home_dismissed` / `get_home_chat` / `send_home_message` (`text`, `target`, `suggestionId`, `agent`, `model`) / `new_home_chat` / `stop_home_worker`。変化はイベント `home:updated` で知らせ、フロントは `["homeBot"]` / `["homeChat"]` を無効化する。ブラウザのデモ (`src/lib/demo/homeBot.ts`) は固定の提案と、メッセージごとに worker を 1 つ起動して約 5 秒後に要約する台本で動く。

## データ (スキーマ v32)

`bot_runs` (見回り 1 回ごと: 契機・枠・開始/終了・結果・エラー・ブリーフ・エージェント)、`bot_suggestions`、`home_chat_messages`、`home_dispatches` (worker: 対象・`ask_id`・エージェント・依頼・状態・要約済みか)。`app_settings` に `home_bot` (設定)、`home_bot_armed_at`、`home_bot_seen_at`、`home_bot_enabled_since`、`home_bot_chat`。

## 未対応

Orca の Items (複数日の追跡項目)、Bot から人への選択式の質問、SOUL.md / MEMORY.md と夜間の記憶整理、パイプラインの状態を概要に入れること。
