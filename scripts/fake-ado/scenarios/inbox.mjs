// Inbox scenario: one review PR, one PR of yours and four work items, in two
// stages. Stage 0 is what the first sync sees; `pnpm fake-ado:next` moves to
// stage 1, which adds the comments the Inbox should pick up on the next sync.
//
// What to expect (Inbox after each sync):
//   stage 0: !101 t1 Mention (waiting, seen on first sight)
//            !101 t4 Team    (team mention, waiting)
//            not listed: !101 t2 (answered), t3 (resolved), t5 (old reply)
//   stage 1: !103 t1 Mention (PR that appeared mid-discussion)
//            !101 t5 Reply   (new reply in a thread you are in)
//            !102 t6 Reply   (new thread on your PR; 3 comments, counted once)
//            #201 WI reply   (after your comment, assigned to you)
//            #202 WI reply   (after your comment, not assigned)
//            #203 WI reply   (only if you follow #203 in DevDeck first)
//            #204 WI mention (not listed with --reject-recent-mentions)

export const ME = { id: "11111111-1111-4111-8111-111111111111", displayName: "You (fake)", uniqueName: "you@fake.example" };
export const TEAM = { id: "22222222-2222-4222-8222-222222222222", displayName: "[Platform]\\Reviewers", descriptor: "vssgp.fake-reviewers" };
const TANAKA = { id: "33333333-3333-4333-8333-333333333333", displayName: "Tanaka Hiro", uniqueName: "tanaka@fake.example" };
const SUZUKI = { id: "44444444-4444-4444-8444-444444444444", displayName: "Suzuki Mei", uniqueName: "suzuki@fake.example" };
const GRACE = { id: "55555555-5555-4555-8555-555555555555", displayName: "Grace Kim", uniqueName: "grace@fake.example" };

export const PROJECT = { id: "p-platform", name: "Platform" };
export const REPO = { id: "r-api", name: "api-gateway", project: PROJECT, defaultBranch: "refs/heads/main" };

const mention = (who) => `@<${who.id}>`;
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

let nextId = 1000;
function comment(author, content, minutes) {
  nextId += 1;
  return { id: nextId, parentCommentId: 0, content, commentType: "text", author, publishedDate: ago(minutes), isDeleted: false };
}
function thread(id, status, comments, filePath, line) {
  return {
    id,
    status,
    isDeleted: false,
    comments,
    threadContext: filePath ? { filePath, rightFileStart: { line, offset: 1 }, rightFileEnd: { line, offset: 1 } } : null,
  };
}
function pr(id, title, createdBy, reviewers, minutes, threads) {
  return {
    pullRequestId: id,
    title,
    description: `Fake PR ${id} for the Inbox scenario.`,
    status: "active",
    creationDate: ago(minutes),
    createdBy,
    repository: REPO,
    sourceRefName: `refs/heads/feature/fake-${id}`,
    targetRefName: "refs/heads/main",
    isDraft: false,
    mergeStatus: "succeeded",
    reviewers: reviewers.map((r) => ({ ...r, vote: 0, isRequired: false })),
    threads,
  };
}
function workItem(id, title, assignedTo, comments, minutes) {
  return {
    id,
    fields: {
      "System.Id": id,
      "System.Title": title,
      "System.WorkItemType": "Task",
      "System.State": "Active",
      "System.Reason": "New",
      "System.AssignedTo": assignedTo,
      "System.CreatedBy": TANAKA,
      "System.CreatedDate": ago(minutes + 600),
      "System.ChangedDate": ago(minutes),
      "System.TeamProject": PROJECT.name,
      "System.Tags": "",
      "System.Description": `<div>Fake work item ${id}.</div>`,
    },
    comments,
  };
}
function wiComment(author, text, minutes) {
  nextId += 1;
  return { id: nextId, text, renderedText: text, createdDate: ago(minutes), createdBy: author, reactions: [] };
}

/** Builds the stage-0 state. `options.manyPrs` adds review PRs past the scan cap. */
export function createState(options = {}) {
  const pr101 = pr(101, "Retry policy for the gateway client", TANAKA, [ME], 300, [
    thread(1, "active", [comment(TANAKA, `${mention(ME)} この再試行回数で十分か見てもらえますか`, 240)], "/src/retry.ts", 12),
    thread(2, "active", [comment(TANAKA, `${mention(ME)} ログの書式も確認お願いします`, 230), comment(ME, "確認しました。問題ありません", 220)]),
    thread(3, "fixed", [comment(SUZUKI, `${mention(ME)} 型の修正をお願いします`, 210)], "/src/types.ts", 3),
    thread(4, "active", [comment(GRACE, `${mention(TEAM)} キャッシュの無効化方針をチームで確認してください`, 200)]),
    thread(5, "active", [comment(ME, "タイムアウトは 30 秒で良いですか", 190), comment(TANAKA, "はい、30 秒で", 180)]),
  ]);
  const pr102 = pr(102, "Add health endpoint", ME, [TANAKA, SUZUKI], 500, [
    thread(1, "active", [comment(SUZUKI, "命名は health より healthz に揃えませんか", 400)], "/src/health.ts", 1),
  ]);
  const prs = [pr101, pr102];
  if (options.manyPrs) {
    for (let i = 0; i < 105; i++) {
      prs.push(pr(2000 + i, `Bulk review PR ${i + 1}`, SUZUKI, [ME], 2000 + i * 10, []));
    }
  }
  const workItems = [
    workItem(201, "Gateway timeout investigation", ME, [wiComment(ME, "再現手順をまとめました", 300), wiComment(TANAKA, "ありがとうございます", 290)], 290),
    workItem(202, "Document the retry policy", TANAKA, [wiComment(ME, "README に追記する方針で良いですか", 280)], 280),
    workItem(203, "Rate limit dashboard", SUZUKI, [wiComment(SUZUKI, "ダッシュボードの案です", 270)], 270),
    workItem(204, "Release checklist", GRACE, [wiComment(GRACE, "チェックリストの初版です", 260)], 260),
  ];
  return { stage: 0, prs, workItems, options };
}

/** Moves the state to the next stage. Returns a short description, or null at the end. */
export function advance(state) {
  if (state.stage !== 0) return null;
  state.stage = 1;
  const find = (id) => state.prs.find((p) => p.pullRequestId === id);
  const wi = (id) => state.workItems.find((w) => w.id === id);
  const touch = (item) => (item.fields["System.ChangedDate"] = new Date().toISOString());

  find(101).threads.find((t) => t.id === 5).comments.push(comment(TANAKA, "接続側のタイムアウトも同じ値にします", 2));
  find(102).threads.find((t) => t.id === 1).comments.push(comment(TANAKA, "healthz に賛成です", 3));
  find(102).threads.push(
    thread(6, "active", [
      comment(TANAKA, "このエンドポイントは認証なしで良いですか", 3),
      comment(SUZUKI, "社内向けなので良いと思います", 2),
      comment(TANAKA, "了解です", 1),
    ], "/src/health.ts", 8),
  );
  state.prs.push(
    pr(103, "Split the auth middleware", SUZUKI, [ME], 600, [
      thread(1, "active", [comment(SUZUKI, `${mention(ME)} トークン検証の分け方を見てください`, 120)], "/src/auth.ts", 40),
      thread(2, "active", [comment(TANAKA, "ここは別 PR にしませんか", 110)]),
    ]),
  );
  for (const [id, author, text] of [
    [201, TANAKA, "再現しました。原因は接続プールの枯渇でした"],
    [202, SUZUKI, "README で良いと思います"],
    [203, GRACE, "ダッシュボードにエラー率も足しました"],
    [204, GRACE, `<div><a href="#" data-vss-mention="version:2.0,${ME.id}">@You</a> リリース前に項目を確認してください</div>`],
  ]) {
    wi(id).comments.push(wiComment(author, text, 1));
    touch(wi(id));
  }
  return "stage 1: new comments on !101 !102, new PR !103, new comments on #201-#204";
}

/** Ids a WIQL query returns. */
export function wiqlIds(state, query) {
  const q = query.toLowerCase();
  if (q.includes("@recentmentions")) {
    if (state.options.rejectRecentMentions) return { error: "TF51005: The query references a field that does not exist. (@RecentMentions)" };
    return { ids: [204, 201] };
  }
  if (q.includes("ever @me")) return { ids: [201, 202] };
  if (q.includes("[system.assignedto] = @me")) return { ids: state.workItems.filter((w) => w.fields["System.AssignedTo"]?.id === ME.id).map((w) => w.id) };
  return { ids: state.workItems.map((w) => w.id) };
}
