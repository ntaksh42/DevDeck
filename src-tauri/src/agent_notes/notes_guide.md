# DevDeck の Agent notes

人が DevDeck から残した依頼 (Note) を読み、対応して返信する手順。Note は 1 件 1 つの Markdown ファイルで、
ファイルそのものが正本 (DevDeck の DB には無い)。DevDeck は 5 秒ごとにフォルダを読み直し、返信を画面に出す。

## 置き場所

`{notes_root}` の下に、対象ごとのフォルダがある。

| フォルダ | 対象 | 結果 HTML |
| --- | --- | --- |
| `wi-{番号}` | Work Item の調査 | 設定の Work item result folder |
| `pr-{番号}` | Pull Request のレビュー | 設定の Review result folder |
| `ask-{yyyyMMddHHmmss}` | 対象に紐づかない依頼 (パイプライン実行・Wiki・一覧など) | なし |

- **各フォルダ直下の `.md` だけが未対応の Note。** 起動時に指定されたフォルダだけを扱う。
- `_done/` (対応済み)・`_draft/` (人の下書き)・`_trash/` (削除済み) と `.` で始まるファイルは読まない・触らない。
- `_context/{Note のファイル名}` は DevDeck が集めた資料 (読み取り専用)。front-matter の `context_file` がその絶対パス。

## Note の形式

```markdown
---
target: pull-request
id: 45
created: 2026-10-12T09:30:00+09:00
kind: fix
result_file: "PR45.html"
quote: "接続文字列をハードコードしている"
context_file: "C:\\...\\agent-notes\\pr-45\\_context\\20261012-093000.md"
---
本文 (人の指示)

<!-- reply claude 2026-10-12T09:35:00+09:00 -->
エージェントの返信

<!-- reply user 2026-10-12T09:40:00+09:00 -->
人の返信 (最後の返信が新しい指示)
```

front-matter は `key: value` の行。値は JSON 文字列か素のテキスト。

| キー | 意味 |
| --- | --- |
| `target` | `work-item` / `pull-request` / `ask` |
| `id` | WI / PR の番号 (`ask` はフォルダ名の時刻) |
| `kind` | 依頼の種類 (下記) |
| `result_file` / `result_hash` | 依頼を書いた時点の結果 HTML のファイル名と指紋 |
| `quote` | 結果 HTML のうち指示の対象箇所。無ければ結果全体への指示 |
| `quote_prefix` / `quote_suffix` / `quote_offset` | 引用の前後の文脈と位置 (同じ文字列が複数あるときの区別) |
| `context` | 依頼の対象 1 行 (タイトル・URL)。`ask` で無ければ対象なし |
| `context_file` | DevDeck が取得した資料 (フィールド・コメント・ログ・表) |
| `resolved` | 対応済みの一行要約。複数あれば最後の行が有効 |

## kind ごとの対応

| kind | WI / PR | ask |
| --- | --- | --- |
| `fix` | 引用箇所 (無ければ本文の指示) を直し、結果 HTML を作り直す | — |
| `redo` | 調査 / レビューをやり直し、結果 HTML を作り直す | — |
| `investigate` | 調査 / レビューして結果 HTML を作る / 作り直す | 調べて原因・結論を返信する |
| `question` | 返信で答えるだけ。結果 HTML は変えない | 返信で答える |
| `summarize` | 要約を返信する。結果 HTML は変えない | 要約を返信する |
| (無し) | `quote` があれば `fix`。無ければ本文から判断: 結果の修正・やり直しなら `fix`、質問・要約なら `question` | `question` |

結果 HTML を直したときは、直した要素に `data-agent-note="{Note のファイル名}"` 属性を付ける
(DevDeck が「直した箇所」として示す)。

## 返信の書き方

返信はファイル末尾に、マーカー行と本文を追記する。既存部分 (front-matter・本文・過去の返信) は書き換えない。

```markdown

<!-- reply claude 2026-10-12T09:35:00+09:00 -->
本文
```

- マーカーは `<!-- reply {名前} {ISO 8601 時刻 (オフセット付き)} -->` の 1 行。名前は英小文字 1 語
  (`claude` / `codex` など)。DevDeck では `@Claude` のように表示される。`user` は人用なので使わない。
- 本文中に `<!-- reply ... -->` の形の行を書かない (返信の区切りと誤認される)。
- 本文は Markdown で、DevDeck 内で描画される: 段落・リスト・コード・コードブロック・引用・リンク。
  生の HTML は除去される。`#123` は Work Item、`!45` は Pull Request へのアプリ内リンクになり、
  `http(s)://` のリンクは外部ブラウザで開く。
- Note の言語で書く (日本語の Note には日本語で)。
- 結論を先に書く。続けて、根拠 (ファイル・行・ログの該当箇所) と、結果 HTML で何を変えたかを短く書く。
  作業の経過や Note の言い直しは書かない。
- 質問するときは、人が答えれば作業を進められる形で具体的に聞く (選択肢があれば並べる)。
- WI / PR へのコメント投稿は人が DevDeck から行う。返信は人がそのまま使える文面にしてよい。

## 終え方

- 対応を終えた Note: front-matter に `resolved: 一行要約` を追記してから、ファイルを `_done/` へ移す。本文は書き換えない。
- 質問がある・対応できない Note: 理由や質問を返信として追記し、ファイルは移さずに残す
  (最後の返信がエージェントの Note は、DevDeck で「人の対応待ち (Needs you)」と表示される)。
- 人が `_done/` の Note に返信すると、DevDeck はそれをフォルダ直下に戻す。最後の返信を新しい指示として扱い、
  終えたら新しい `resolved:` 行を追記して再び `_done/` へ移す。
- ファイルを書き換えるときは、同じフォルダの一時ファイル (例: `.{ファイル名}.tmp`。拡張子を `.md` にしない)
  に書いてから置き換える (DevDeck に書きかけを読ませない)。

## 守ること

- Azure DevOps には書き込まない。`az` CLI は使えない (DevDeck が未ログインの状態で起動する)。
- `git push` しない (DevDeck が push 先を無効にして起動する)。fetch や手元での commit はしてよい。
- 必要な情報は `context_file` と手元のファイル (クローン・結果 HTML) から得る。足りなければ、何が要るかを返信で聞く。
- 秘密情報 (PAT・トークン) を Note・返信・結果 HTML に書かない。
