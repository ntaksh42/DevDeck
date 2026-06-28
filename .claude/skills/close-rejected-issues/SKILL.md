---
name: close-rejected-issues
description: Close open GitHub issues in azdo-dashboard whose linked PR was closed without merging (the work was rejected/abandoned). Use whenever the user asks to close issues whose PRs were closed unmerged, clean up issues for rejected/abandoned PRs, tidy the issue backlog after a PR was rejected, or close "PRがマージされずに閉じられたISSUE". Trigger even if the user phrases it loosely as "close stale issues whose PR didn't land" or "整理して".
---

GitHub の用語上、マージされるのは PR であって Issue ではありません。このタスクの
本当の意味は「**ある Issue を対応するための PR が、マージされずにクローズ（=却下/放棄）
されたので、その Issue 自体ももう閉じてよい**」です。対象 Issue を見つけてクローズ
するのがこの Skill のゴールです。

## 用語の確認（最初にやること）

ユーザーが「マージされずに閉じた Issue」と言った場合、ほぼ確実に上記の意味です。
ただし別解釈（単に放置中の Issue 全部、等）の余地があれば、`gh issue list` で現状を
見せてから一言だけ確認してもよい。明らかに「却下された PR に紐づく Issue」の意図なら
確認せず進めてよい。

## 手順

リポジトリは `gh` が解決するカレントの GitHub リモート（DevDeck なら
`ntaksh42/DevDeck`）。

### 1. 未マージでクローズされた PR を列挙する

`mergedAt == null` かつ closed の PR がマージされずに閉じられた PR。

```bash
gh pr list --state closed --limit 300 --json number,title,body,mergedAt \
  -q '[.[] | select(.mergedAt == null)] | .[] | "PR #\(.number) | \(.title)\n\(.body)\n====="'
```

### 2. 各 PR が参照する Issue を抽出する

PR の本文・タイトルから GitHub のクローズ用キーワードで紐づく Issue 番号を拾う。
対象キーワード（大文字小文字問わず）: `Closes`, `Close`, `Closed`, `Fixes`, `Fix`,
`Fixed`, `Resolves`, `Resolve`, `Resolved` の直後に続く `#N`。

キーワードのない単なる `#N` 言及は対象にしない（議論の参照かもしれず、紐づきとは
言えないため）。Issue 参照のない PR（掃除系 PR など）はスキップする。

例: `Closes #54` → Issue #54、`Fixes #43` → Issue #43。

### 3. 参照先 Issue のうち「まだ OPEN なもの」だけ残す

すでに閉じている Issue は対象外。各候補の状態を確認する。

```bash
gh issue view <N> --json number,title,state -q '"#\(.number) [\(.state)] \(.title)"'
```

`state == OPEN` のものだけがクローズ対象。

### 4. 対象を一覧で示してからクローズする

確認は取らず自動で進めてよいが、**何をなぜ閉じるのかを必ずユーザーに表示**してから
実行する（後から追跡できるように）。Issue 番号・タイトル・紐づく未マージ PR 番号を
表で出す。

クローズは `not planned`（却下/放棄の意味合い）で行い、理由コメントを必ず添える。
コメントには紐づく PR 番号を入れ、再開する場合は新規起票するよう促す。

```bash
gh issue close <N> --reason "not planned" \
  --comment "対応 PR #<PR番号> がマージされずにクローズされたため、本 Issue もクローズします。再度対応する場合は新規 Issue/PR で起票してください。"
```

複数あれば 1 件ずつ同様に閉じる。

## 完了報告

閉じた Issue を表で報告する（Issue 番号 / タイトル / 紐づく未マージ PR / 結果）。
Issue 参照がなかったためスキップした未マージ PR があれば、その旨も一言添える
（対象外だが見落としでないことを示すため）。

対象 Issue が 0 件だった場合は「未マージでクローズされた PR に紐づくオープン Issue は
ありませんでした」と明示する。
