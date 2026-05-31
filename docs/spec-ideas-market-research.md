# AzDoDeck 仕様アイデア調査メモ

## 目的

世の類似アプリや周辺ツールの機能を調べ、AzDoDeck の仕様案として使えるアイデアをできるだけ広く出す。

AzDoDeck の現在の軸は「Azure DevOps の Pull Requests / Work Items / Commits を desktop app で横断検索・監視する」こと。  
そのため、調査対象は単なる Git GUI ではなく、以下の観点に近いものを優先した。

- 自分が今見るべきレビュー・作業の inbox
- 複数 repository / project 横断の一覧
- dashboard / widget / saved view
- notification triage
- PR / issue / commit の関連づけ
- review bottleneck / risk / analytics
- AI review / automation

## 参考にしたプロダクト・ドキュメント

| 対象 | 参考 URL | 観察した主な要素 |
|------|----------|------------------|
| Azure DevOps Dashboards | https://learn.microsoft.com/en-us/azure/devops/report/dashboards/dashboard-focus?view=azure-devops | 個人 dashboard、Assigned to me、PR / work item widgets、team dashboard |
| Azure DevOps widget catalog | https://learn.microsoft.com/en-us/azure/Devops/report/dashboards/widget-catalog?view=azure-devops | Pull Request widget、Pull Request multiple repos、code tracking widgets |
| Azure DevOps personal notifications | https://learn.microsoft.com/en-us/azure/devops/organizations/notifications/manage-your-personal-notifications?view=azure-devops-2022 | work item / PR / commit / build の通知トリガー |
| GitHub Notifications Inbox | https://docs.github.com/subscriptions-and-notifications/reference/inbox-filters | `reason:review-requested` などの inbox filter |
| GitHub Projects filters | https://docs.github.com/issues/trying-out-the-new-projects-experience/filtering-projects | view filter、field filter、保存ビュー、reviewer / assignee filter |
| GitLab To-Do List | https://docs.gitlab.com/user/todos/ | 自分の入力待ち item、filter、sort、done / snooze 的な処理 |
| Graphite PR Inbox | https://graphite.dev/docs/use-pr-inbox | PR inbox、section customization、share filters、fuzzy search |
| GitKraken Launchpad | https://help.gitkraken.com/gitkraken-desktop/gitkraken-launchpad/ | PR / issue / WIP の統合 view、status bar summary、quick actions |
| Linear Inbox | https://linear.app/docs/inbox | notification center、keyboard navigation、issue detail in inbox |
| Linear Filters | https://linear.app/docs/filters | 自然言語風 filter、ほぼ全 view への filter 適用 |
| Jira dashboard gadgets | https://confluence.atlassian.com/display/SERVICEDESKCLOUD/Using%2Bdashboard%2Bgadgets | Assigned To Me、Activity Stream、Time Since Issues |
| YouTrack dashboards | https://www.jetbrains.com/youtrack/features/dashboards.html | personal / team dashboard、widgets、sharing、custom apps |
| JetBrains Space code review search | https://www.jetbrains.com/help/space/find-a-review.html | Needs my review などの review finder |
| CodeRabbit dashboard | https://docs.coderabbit.ai/guides/dashboard | PR review metrics、repository / user / team filters、AI review impact |
| Haystack Pull Requests | https://help.usehaystack.io/features/pull-requests | activity timeline、time in review、risk filters |

## 調査から見える設計パターン

### 1. Search より Inbox が強い

検索画面は「探す」には有効だが、毎日の作業開始時には「自分が今反応すべきもの」が欲しい。GitLab To-Do、GitHub Inbox、Graphite PR Inbox、Linear Inbox はすべてこの方向。

AzDoDeck では `Pull Requests > My Reviews` がすでにこの方向に近い。次は Work Items / Commits / Notifications も inbox 化できる。

### 2. 固定ビューより Saved View / Section が強い

Graphite は inbox section を編集・並べ替え・共有できる。GitHub Projects は filter を view として保存できる。Linear はほぼすべての view に filter を適用できる。

AzDoDeck でも「No Vote」「Waiting for Author」などを固定タブだけで終わらせず、ユーザーが自分用の section を作れるようにすると強い。

### 3. ただの一覧より Actionable status が重要

GitKraken Launchpad は PR を状態で要約し、ready to merge / CI failing / merge conflicts などを status bar で見せる。Haystack は time in review や risk を見せる。

AzDoDeck でも「一覧にある」だけではなく、「なぜ今見るべきか」を badge / section / alert にするべき。

### 4. Dashboard は widget 化すると伸びる

Azure DevOps、Jira、YouTrack は dashboard + widget を中心にしている。固定画面より、個人用 dashboard に「自分のレビュー」「今日の work items」「滞留 PR」「最近の commits」などを置ける方が拡張しやすい。

### 5. 通知は inbox に統合しないと散る

Azure DevOps の personal notifications は PR / work item / commit / build まで広い。メール通知だけだと流れるため、desktop app 側で notification source を normalizing して inbox にする価値がある。

### 6. PR / Work Item / Commit の関連グラフが差別化になる

Azure DevOps は PR と work item のリンク、commit と work item のリンクを持てる。AzDoDeck が desktop app として価値を出すなら、単体検索より「この変更はどの work item / PR / commit / build / deployment に繋がっているか」を即座に辿れることが強い。

### 7. AI はレビュー本文より triage 補助から入るのが現実的

CodeRabbit のような自動レビュー全体をいきなり実装するより、まずは「この PR は何を変えたか」「自分が見るべきファイルはどれか」「関連 work item と矛盾していないか」「レビュー観点チェックリストを作る」など、ローカル補助から入る方が安全。

## 仕様アイデア一覧

優先度は暫定:

- P0: 近い将来に入れると product value が大きい
- P1: 主要差別化になり得る
- P2: 便利だが依存機能が必要
- P3: 将来拡張・実験枠

### A. Information Architecture / Navigation

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| IA-01 | P0 | Home / Today を追加 | 起動時の初期画面を `Today` にし、My Reviews、My Work Items、CI failing PR、最近更新された自分関連 item をまとめる |
| IA-02 | P0 | Work Items を section 化 | `Work Items > Search` と `Work Items > My Items` に分ける |
| IA-03 | P1 | Commits を section 化 | `Commits > Search`、`Commits > My Commits`、`Commits > Recently Merged` を追加 |
| IA-04 | P1 | Inbox を top-level 化 | PR / work item / notification を統合した `Inbox` を置く |
| IA-05 | P1 | Saved Views を sidebar に pin | 任意 filter の保存ビューを sidebar に pin できる |
| IA-06 | P1 | Section badge | My Reviews / My Items / Inbox に未処理件数 badge を表示 |
| IA-07 | P2 | Focus mode | nav と詳細 pane を畳み、一覧だけを最大化する |
| IA-08 | P2 | Multi-org switcher | sidebar 上部で org を切り替える。後続で org 横断も可能にする |
| IA-09 | P2 | Command palette | `Ctrl+K` で view 移動、PR / work item / commit 検索、open action を実行 |
| IA-10 | P3 | Workspace profiles | `Work`, `OSS`, `Incident` など dashboard / filters / org set を profile として切り替える |

### B. Unified Inbox / Triage

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| IN-01 | P0 | Unified Inbox | 自分に関係する PR review request、work item assignment、mention、failed build を 1 つの時系列 inbox にする |
| IN-02 | P0 | Done / Archive | inbox item を手動で done にできる。source object が閉じたら自動 done |
| IN-03 | P0 | Snooze | 明日、来週、指定日時まで inbox から隠す |
| IN-04 | P0 | Reason badge | `Review requested`, `Assigned`, `Mentioned`, `Build failed`, `Returned to you` を明示 |
| IN-05 | P1 | Recommended sort | snoozed return、期限、古さ、blocking 度で優先順に並べる |
| IN-06 | P1 | Keyboard triage | `J/K` 移動、`E` done、`S` snooze、`O` open、`R` refresh |
| IN-07 | P1 | Inbox detail pane | item を開かずに詳細、comments、linked work items、latest activity を右 pane 表示 |
| IN-08 | P1 | Bulk triage | 複数選択して done / snooze / open |
| IN-09 | P1 | Triage rules | 条件に合う item を自動 snooze / priority set / label 付け |
| IN-10 | P2 | Notification subscription mirror | Azure DevOps personal notification の対象カテゴリを app 内で見える化 |
| IN-11 | P2 | Attention dedupe | 同じ PR への複数通知を 1 item にまとめ、activity count を増やす |
| IN-12 | P2 | Stale pending reminders | 長く未処理の inbox item を daily summary に出す |
| IN-13 | P3 | Inbox sharing | 自分の inbox section 設定をチームメンバーに export / import |
| IN-14 | P3 | Triage analytics | 自分の平均 triage time、snooze 回数、未処理 aging を表示 |

### C. Pull Request Reviews

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| PR-01 | P0 | PR status sections | `Needs my review`, `Waiting for author`, `Approved`, `Draft`, `CI failing`, `Merge conflicts` の section 表示 |
| PR-02 | P0 | CI / policy status column | Build validation、required reviewer、merge conflict、policy failure を一覧に出す |
| PR-03 | P0 | Review age | 作成日だけでなく「review requested からの経過時間」を表示 |
| PR-04 | P0 | Returned to me | 自分がコメント/Reject 後に author が更新した PR を上位表示 |
| PR-05 | P1 | Review checklist | repo / branch / file pattern ごとの review checklist を表示 |
| PR-06 | P1 | File risk hints | 変更ファイル数、差分行数、重要 path、テスト有無から risk badge を出す |
| PR-07 | P1 | Linked work item presence | work item 未リンク PR を警告する |
| PR-08 | P1 | PR dependency / stack view | target/source branch から stacked PR の上下関係を表示 |
| PR-09 | P1 | Quick local checkout | PR branch をローカル worktree に checkout する action |
| PR-10 | P1 | Review result attachment | 既存の local HTML review result を PR row と強く統合し、match confidence を表示 |
| PR-11 | P1 | Review comments summary | 未解決 thread 数、last commenter、自分宛 mention を一覧に出す |
| PR-12 | P1 | Author response needed | 自分が author の PR で reviewer から changes requested / comment が来たものを section 化 |
| PR-13 | P2 | Draft strategy | Draft を完全非表示ではなく `Draft but requested` や `Draft stale` で分ける |
| PR-14 | P2 | Approval expiry | 新 commit push で過去 approval が stale になった PR を表示 |
| PR-15 | P2 | Reviewer load | 自分以外の reviewer 状態も表示し、誰で止まっているかを見る |
| PR-16 | P2 | PR quick commands | Open, copy URL, copy branch, copy `#id`, open linked work items |
| PR-17 | P2 | PR templates validation | description の required section 未記入を警告 |
| PR-18 | P3 | AI review briefing | PR の目的、主要変更、見るべきファイル、懸念点を生成 |
| PR-19 | P3 | AI comment clustering | review comments を issue 別に cluster し、対応漏れを見つける |
| PR-20 | P3 | Cross-repo PR train | 複数 repo にまたがる同一 feature の PR 群を束ねて表示 |

### D. Work Items

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| WI-01 | P0 | My Work Items | `Assigned To = @Me` 相当を auto load する inbox view |
| WI-02 | P0 | Due / stale grouping | Due today、Overdue、No activity 7d、Blocked などで group |
| WI-03 | P0 | State transition quick action | Active / Resolved / Closed などへ直接更新する action |
| WI-04 | P1 | Work item detail pane | description、comments、links、relations、recent changes を右 pane |
| WI-05 | P1 | Linked PR / commit summary | work item に紐づく PR / commit を一画面に表示 |
| WI-06 | P1 | Blocked / blocking graph | parent / child / related / predecessor を graph 表示 |
| WI-07 | P1 | Query library | WIQL query を保存し、sidebar に pin できる |
| WI-08 | P1 | Natural language filter | `assigned to me and active and changed this week` を filter に変換 |
| WI-09 | P2 | Batch update | 複数 work items の state / assignee / tags を一括変更 |
| WI-10 | P2 | Time in state | `New -> Active -> Resolved` の滞留時間を表示 |
| WI-11 | P2 | Work item reminders | 自分用 reminder / snooze を app local に持つ |
| WI-12 | P2 | Planning hygiene | acceptance criteria なし、親なし、見積なしなどを警告 |
| WI-13 | P2 | Sprint focus | 現 sprint の自分の work item と related PR をまとめる |
| WI-14 | P3 | Offline notes | work item にローカル private note を添付 |
| WI-15 | P3 | AI issue digest | description と comments から「次にやること」を抽出 |

### E. Commits / Code History

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| CO-01 | P0 | My Commits | author = current user の commit を日付範囲で auto load |
| CO-02 | P0 | Recently touched repos | 最近 commit があった repo をカード化 |
| CO-03 | P1 | Commit detail pane | changed files、linked PR、linked work items、parents を表示 |
| CO-04 | P1 | Unlinked commits | work item / PR に紐づかない commit を見つける |
| CO-05 | P1 | Release range compare | branch / date / tag 間の commits と work items を抽出 |
| CO-06 | P1 | Commit activity heatmap | repo / author / day の commit activity を表示。ただし個人評価用途にしない注意書きを入れる |
| CO-07 | P2 | Search by touched path | `path:src/auth` のような filter |
| CO-08 | P2 | Search by commit metadata | author email、committer、merge commit、branch、tag |
| CO-09 | P2 | Cherry-pick candidates | release branch に未反映の commit を検出 |
| CO-10 | P2 | Commit message policy | work item ID 未記載などの policy warning |
| CO-11 | P3 | Local repo correlation | ローカル clone と Azure DevOps commit を照合し、open in editor / git log へ誘導 |
| CO-12 | P3 | AI change narrative | 指定期間の commits から「何が変わったか」を要約 |

### F. Cross-Linking / Traceability

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| TR-01 | P0 | Unified entity page | PR / work item / commit のどれから開いても関連 graph を表示 |
| TR-02 | P0 | Missing link warnings | PR without work item、commit without PR、work item without recent activity を警告 |
| TR-03 | P1 | Change story | work item -> branch -> commits -> PR -> build -> deployment の流れを timeline 表示 |
| TR-04 | P1 | Release manifest | date range / branch range から merged PR、commits、work items を一覧化 |
| TR-05 | P1 | Copy release notes | release manifest から markdown release notes を生成 |
| TR-06 | P1 | Impacted areas | changed paths と work item tags から affected component を推定 |
| TR-07 | P2 | Relation quality score | work item / PR / commit / build のリンク充足度を score 化 |
| TR-08 | P2 | Cross-org trace | 複数 org を使う会社向けに関連 URL を横断検索 |
| TR-09 | P3 | Custom relation rules | `AB#123` 以外の issue key / branch naming rule を設定 |

### G. Search / Query UX

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| SE-01 | P0 | Global search | PR / work item / commit を 1 box で横断検索 |
| SE-02 | P0 | Scoped search syntax | `type:pr repo:api author:alice stale:3d` のような filter language |
| SE-03 | P1 | Search suggestions | 入力中に field / value suggestion を表示 |
| SE-04 | P1 | Saved searches | query を保存し、名前・色・shortcut を付ける |
| SE-05 | P1 | Recent searches | 最近使った検索条件を quick restore |
| SE-06 | P1 | Fuzzy search | PR title、description、author、repo、work item title で fuzzy match |
| SE-07 | P2 | Search explain | 実際に適用された server-side / local filter を表示 |
| SE-08 | P2 | Query performance hint | 探索 project / repo 数、取得件数、所要時間を出す |
| SE-09 | P2 | Query templates | `My stale reviews`, `Unlinked PRs`, `CI failing PRs` など template |
| SE-10 | P3 | Natural language query | `show my PRs waiting on author for more than 3 days` を query に変換 |

### H. Dashboard / Widgets

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| DB-01 | P0 | Personal dashboard | My Reviews、My Items、Recent Commits、Notifications を 1 画面に配置 |
| DB-02 | P0 | Widget layout | widget を追加・削除・並び替え・サイズ変更できる |
| DB-03 | P1 | Query tile | 保存 query の count と click-through |
| DB-04 | P1 | Aging chart | PR / work item の age distribution |
| DB-05 | P1 | Activity stream | 自分関連 item の recent activity |
| DB-06 | P1 | Build health widget | 自分関連 PR の build / policy failure |
| DB-07 | P1 | Sprint focus widget | current sprint の自分の assigned work |
| DB-08 | P2 | Team dashboard | team view へ切り替え。ただし個人監視との境界を明確にする |
| DB-09 | P2 | Widget marketplace-ish | local plugin manifest で custom widget を追加 |
| DB-10 | P2 | Share dashboard config | dashboard layout を JSON export / import |
| DB-11 | P3 | Public read-only mode | credential を使わない local report export |

### I. Notifications / Reminders

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| NT-01 | P0 | Desktop notifications | new review request、assigned work item、failed PR build で toast |
| NT-02 | P0 | Quiet hours | 通知しない時間帯を設定 |
| NT-03 | P1 | Notification digest | 朝・夕方の未処理 digest |
| NT-04 | P1 | Notification rules | repo / project / reason / priority ごとの通知 ON/OFF |
| NT-05 | P1 | Local reminders | PR / work item に remind me later |
| NT-06 | P2 | Calendar-aware reminders | due date / sprint end 前に通知 |
| NT-07 | P2 | Slack / Teams handoff | open in Teams / copy summary / share link |
| NT-08 | P3 | Notification simulation | rule 作成時に過去 7 日の item で hit preview |

### J. Background Sync / Cache / Performance

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| SY-01 | P0 | Repository / project cache | project / repo discovery を cache し、全探索を減らす |
| SY-02 | P0 | Incremental sync | changed since / continuation token / updated date を使い差分取得 |
| SY-03 | P0 | Cancellation | 長い検索を cancel できる |
| SY-04 | P1 | Sync status bar | last sync、in progress、error、rate limit を表示 |
| SY-05 | P1 | Per-org refresh policy | org ごとに interval / manual only を設定 |
| SY-06 | P1 | Offline recent data | 直近 cache を offline でも参照可能 |
| SY-07 | P1 | Bounded concurrency | project / repo traversal を並列化しつつ API 負荷を制御 |
| SY-08 | P2 | Backoff visualization | 429 / 5xx retry をユーザーに見える形で表示 |
| SY-09 | P2 | Cache inspector | cache 件数、サイズ、最終更新、clear action |
| SY-10 | P3 | Sync profiles | lightweight / full / analytics sync を選ぶ |

### K. Analytics / Bottlenecks

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| AN-01 | P1 | Review bottleneck view | `waiting on me`, `waiting on author`, `waiting on CI`, `ready to merge` の count |
| AN-02 | P1 | Time in review | PR ごとの review state 滞留時間 |
| AN-03 | P1 | Stale PR report | 3d / 7d / 14d 以上の open PR |
| AN-04 | P1 | Unlinked work report | PR / commit / work item のリンク欠落 |
| AN-05 | P2 | Cycle time mini chart | work item created -> closed、PR opened -> merged |
| AN-06 | P2 | Flow efficiency | active time と idle time の推定 |
| AN-07 | P2 | Risk dashboard | large diff、old PR、CI failing、merge conflict、no reviewer |
| AN-08 | P2 | Personal load | 自分が抱える review / assigned work の WIP count |
| AN-09 | P3 | Team-level DORA | deployment frequency / lead time など。ただし scope は後続 |
| AN-10 | P3 | Anti-vanity guardrails | 個人評価に使われやすい raw metric には注意文と設計制限を入れる |

### L. Actions / Editing

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| AC-01 | P0 | Open actions everywhere | open in Azure DevOps、copy URL、copy markdown link |
| AC-02 | P1 | Approve / wait author quick action | PR row から vote を送る。初期は confirm 必須 |
| AC-03 | P1 | Work item state quick action | My Items から state を更新 |
| AC-04 | P1 | Add comment | PR / work item に comment を追加 |
| AC-05 | P1 | Assign to me / unassign | work item / PR reviewer の assignment 操作 |
| AC-06 | P2 | Create work item from PR | PR から linked work item を作る |
| AC-07 | P2 | Link existing work item | PR / commit に work item を link |
| AC-08 | P2 | Bulk open | 選択した PR / work item を browser tabs で開く |
| AC-09 | P3 | Local branch checkout | PR branch を clone/worktree に checkout |

### M. AI / Assistant Features

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| AI-01 | P1 | PR briefing | title、description、commits、files、linked work item から review brief を生成 |
| AI-02 | P1 | Review checklist generator | repo rule と changed files から checklist |
| AI-03 | P1 | Work item summarizer | long description / comments を next action に要約 |
| AI-04 | P1 | Release notes draft | merged PR / work items / commits から markdown 生成 |
| AI-05 | P2 | Risk explanation | `large diff + no tests + auth path` など risk badge の理由説明 |
| AI-06 | P2 | Query builder | natural language から AzDoDeck filter query |
| AI-07 | P2 | Duplicate issue finder | similar work item / PR を候補提示 |
| AI-08 | P2 | Comment tone helper | review comment を具体的で丁寧に書き換え |
| AI-09 | P3 | Automated pre-review | local diff / PR diff に対する optional AI review |
| AI-10 | P3 | Agent handoff bundle | selected PR / work item / commits を coding agent 用 context bundle に export |

### N. Security / Privacy / Governance

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| SG-01 | P0 | Credential health | PAT expiry / Azure CLI token status / auth provider を settings に表示 |
| SG-02 | P0 | Secret storage audit | secret は OS credential store のみ、DB に保存しないことを UI でも明示 |
| SG-03 | P1 | Permission-aware errors | 403 / missing project access を project 単位で表示 |
| SG-04 | P1 | Local-only mode | AI / analytics / telemetry を使わず local + Azure DevOps API のみ |
| SG-05 | P1 | Data retention settings | cache retention、clear cache、export data |
| SG-06 | P2 | Audit log | app から実行した update / comment / vote を local log に残す |
| SG-07 | P2 | Redaction for exports | release notes / AI context export から secret-like strings を除外 |
| SG-08 | P3 | Policy packs | org/team ごとの required links / branch rules / review rules を設定 |

### O. Customization / Extensibility

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| EX-01 | P1 | Custom columns | PR / work item / commit grid の表示列を選ぶ |
| EX-02 | P1 | Custom badges | query 条件に応じて badge を付ける |
| EX-03 | P1 | Color rules | stale / blocked / high priority などの行色 rules |
| EX-04 | P2 | User scripts / plugins | local JS/WASM plugin で custom widget / action |
| EX-05 | P2 | Webhook import | Azure DevOps service hook を受ける local companion は将来検討 |
| EX-06 | P2 | Export/import settings | JSON で settings / views / dashboards を移行 |
| EX-07 | P3 | Marketplace compatibility | Azure DevOps dashboard widget と完全互換は非目標だが、概念は参考にする |

## 推奨ロードマップ案

### M7-A: Personal Inbox

目的: Search app から daily driver へ寄せる。

- Unified Inbox の最小版
- My Work Items
- PR reason badge
- Done / Snooze
- desktop notification 最小版
- background sync status

### M7-B: Cache / Sync Foundation

目的: 大規模 organization で実用的にする。

- project / repository cache
- incremental refresh
- cancellation
- bounded concurrency
- sync status bar
- cache inspector

### M8-A: Traceability

目的: Azure DevOps 横断 app として差別化する。

- PR / work item / commit linked graph
- missing link warnings
- release manifest
- release notes markdown export
- unlinked commits / PRs report

### M8-B: Dashboard Widgets

目的: ユーザーごとの daily dashboard を作れるようにする。

- Today dashboard
- query tiles
- widget layout persistence
- saved views
- activity stream
- aging / risk widgets

### M9: Review Intelligence

目的: review workflow を短縮する。

- PR risk hints
- file path rules
- review checklist
- local HTML review result integration 強化
- optional AI PR briefing

## 最初に仕様化すべき 20 件

1. `Today` 初期画面
2. Unified Inbox data model
3. Inbox item reason / source / state / snooze model
4. My Work Items view
5. Project / repository cache schema
6. Sync status model
7. Saved view model
8. PR status section model
9. CI / policy status columns
10. PR review requested age
11. Work item detail pane
12. Commit detail pane
13. Entity relation graph model
14. Missing link warning rules
15. Release manifest command
16. Dashboard widget layout model
17. Query tile widget
18. Desktop notification settings
19. Credential health panel
20. AI PR briefing prompt boundary / privacy rules

## 注意点

- 個人 productivity metric は誤用されやすい。AzDoDeck は「自分が次に何をすべきか」を助ける設計を主軸にし、個人評価 dashboard に見える表現は避ける。
- Azure DevOps API は project / repository traversal が重くなりやすい。UX アイデアより先に cache / sync / cancellation の土台が必要な箇所が多い。
- AI 機能は secret / proprietary code の扱いが重い。まずはローカル要約、明示 opt-in、context redaction、操作前 confirm を前提にする。
- Desktop app の強みは「複数画面を開かずに今見るべきものを集約すること」。Azure DevOps Web の dashboard を再実装するより、個人 inbox / traceability / quick action に寄せる方が差別化しやすい。

## 2026-06-01 追加調査: issue / work item 操作 UX

追加で Azure Boards、GitHub Issues / Projects、Linear、YouTrack、Trello、GitKraken Launchpad の操作仕様を確認した。今回実装対象にした `?` shortcut help、`Ctrl+K` command palette、grid keyboard navigation、WorkItem preview inline editing はこの調査から P0 として切り出した。

参考 URL:

- Azure Boards queries: https://learn.microsoft.com/en-us/azure/devops/boards/queries/view-run-query
- Azure Boards work item management: https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/manage-work-items
- Azure Boards follow / notifications: https://learn.microsoft.com/en-gb/azure/devops/boards/work-items/follow-work-items
- GitHub keyboard shortcuts: https://docs.github.com/en/articles/using-keyboard-shortcuts
- Linear conceptual model: https://linear.app/docs/conceptual-model
- Linear triage: https://linear.app/docs/triage
- YouTrack saved searches: https://www.jetbrains.com/help/youtrack/cloud/saved-search.html
- YouTrack keyboard shortcuts: https://www.jetbrains.com/help/youtrack/cloud/keyboard-shortcuts.html
- Trello keyboard shortcuts: https://support.atlassian.com/trello/docs/using-keyboard-shortcuts-in-trello/
- GitKraken Launchpad: https://www.gitkraken.com/features/launchpad

追加アイデア:

| ID | 優先 | アイデア | 仕様案 |
|----|------|----------|--------|
| UX-01 | P0 | `?` shortcut overlay | 現在画面で使える shortcut をいつでも確認できる。GitHub / Trello / YouTrack と同系統 |
| UX-02 | P0 | `Ctrl+K` command palette | view 移動、focus 移動、WorkItem action、sync、help を検索して実行 |
| UX-03 | P0 | Grid-first keyboard UX | `J/K` と矢印で行移動、`Enter` で preview、`Esc` で入力欄から grid に戻す |
| UX-04 | P0 | Preview inline fields | WorkItem preview から State / Assigned / Priority を変更 |
| UX-05 | P0 | Preview single-key actions | preview focus 中に `S` State、`A` Assigned、`P` Priority、`M` Comment |
| UX-06 | P0 | Shortcut discoverability | ボタンや下部 status に shortcut chip を出し、覚えなくても使えるようにする |
| UX-07 | P1 | Default Azure Boards views | Assigned to me、Following、Mentioned、My Activity 相当の固定 view |
| UX-08 | P1 | Favorite saved searches | YouTrack 風に saved WIQL query を sidebar / views に pin |
| UX-09 | P1 | Typed filter syntax | `state:Doing assignee:me priority:1` のような field filter |
| UX-10 | P1 | Search suggestions | filter 入力中に State / Type / Project / Assignee / Tag の候補 |
| UX-11 | P1 | WorkItem unread markers | 未読コメント、メンション、最後に見た時刻以降の更新を強調 |
| UX-12 | P1 | Follow / Unfollow | Azure DevOps の Follow を preview から切り替える |
| UX-13 | P1 | Comment saved replies | GitHub saved replies 相当の定型コメント |
| UX-14 | P1 | Comment edit | 投稿済み WorkItem comment の編集 |
| UX-15 | P1 | Comment long text collapse | 長文コメントを折りたたみ、必要時に展開 |
| UX-16 | P1 | Rich link rendering | `@mention`、`#workitem`、PR link を本文中で正しく装飾 |
| UX-17 | P1 | Relations section | Parent / Child / Related / Linked PR / Commit を preview 下部に表示 |
| UX-18 | P1 | Triage inbox | Linear Triage 風に assigned / mentioned / review requested を処理する inbox |
| UX-19 | P1 | Snooze | WorkItem / PR を今日後で、明日、来週まで隠す |
| UX-20 | P1 | Reason badge | `Assigned`, `Mentioned`, `Followed`, `Review requested`, `CI failed` を明示 |
| UX-21 | P2 | Virtualized grid | 大量 WorkItem / PR でも軽い一覧表示 |
| UX-22 | P2 | Incremental preview prefetch | 選択行の前後だけ詳細を先読み |
| UX-23 | P2 | Cache inspector | cache 件数、サイズ、最終更新、clear action |
| UX-24 | P2 | Query performance hint | 取得件数、server-side / local filter、所要時間を表示 |
| UX-25 | P2 | Column presets | view ごとに列表示、列幅、sort、group を保存 |
| UX-26 | P2 | PR Launchpad | GitKraken Launchpad 風に review / issue / WIP を workspace 単位で統合 |
| UX-27 | P2 | Review returned-to-me | 自分がコメント後に author が更新した PR を上位表示 |
| UX-28 | P2 | Missing link warnings | WorkItem 未リンク PR、PR 未リンク commit などを警告 |
| UX-29 | P3 | AI WorkItem digest | Description / comments から次アクションを要約 |
| UX-30 | P3 | AI PR briefing | 変更概要、見るべきファイル、関連 WorkItem との整合性を要約 |
