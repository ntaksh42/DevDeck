import type {
  InboxCounts,
  InboxItem,
  ListInboxItemsInput,
  SetInboxItemStateInput,
} from "@/lib/azdoCommands";

const DEMO_ORG = "contoso";

// Thread ids match the demo pull request review threads (1-3) so the preview
// can show a real thread. Built lazily so the relative timestamps are anchored
// to when the demo starts, and kept in module state so Done / Snooze in the
// browser preview stick.
let items: InboxItem[] | null = null;

function buildSeed(): InboxItem[] {
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const base = {
    organizationId: DEMO_ORG,
    projectId: "platform",
    projectName: "Platform",
    state: "open",
    snoozedUntil: null,
    doneAt: null,
    filePath: null,
    line: null,
    hitCount: 1,
    insight: null,
  };
  const seed: InboxItem[] = [
    {
      ...base,
      id: 5,
      kind: "pr_mention",
      subjectId: 42,
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      threadId: 1,
      filePath: "/src/app/dashboard.ts",
      line: 7,
      commentId: 5011,
      hitCount: 2,
      title: "Add pull request search dashboard",
      author: "Frank Lee",
      snippet: "@you ここの null 扱いを確認してください",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
      detectedAt: minsAgo(12),
      // Matches the demo thread 1 shown for this PR (a request for a test).
      insight: {
        status: "ready",
        verdict: "fix",
        reason: "未指定 (undefined) の分岐はあるが、それを確かめるテストが無い。",
        evidence: [
          {
            text: "refreshIntervalMs が未指定なら ?? で 30000 ms になる",
            location: "src/app/dashboard.ts:7",
            code: "const refreshIntervalMs = options.refreshIntervalMs ?? 30000;",
            guess: false,
          },
          {
            text: "dashboard.test.ts は値を渡すケースだけで、未指定のケースが無い",
            location: "src/app/dashboard.test.ts:12",
            code: "loadDashboard({ refreshIntervalMs: 5000 });",
            guess: false,
          },
          {
            text: "0 を渡すと既定値にならず 0 ms で回り続ける",
            location: "src/app/dashboard.ts:7",
            code: null,
            guess: true,
          },
        ],
        replyDraft:
          "未指定のケース (30 秒の既定値になること) のテストを dashboard.test.ts に追加します。0 を渡したときも既定値に寄せるか、あわせて相談させてください。",
        error: null,
      },
    },
    {
      ...base,
      id: 7,
      kind: "wi_mention",
      subjectId: 123,
      repositoryId: "",
      repositoryName: "",
      threadId: 0,
      commentId: 9001,
      title: "Validate onboarding with PAT credentials",
      author: "Frank Lee",
      snippet: "@you 影響範囲を教えてください",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
      detectedAt: minsAgo(25),
      // Worked out from the thread alone: no clone to look into.
      insight: {
        status: "ready",
        verdict: "reply",
        reason: "スレッド上で既に出荷済み・ブロッカー無しとされており、影響範囲を答えれば済む。",
        evidence: [
          { text: "Alice が「先週出荷済み、ブロッカー無し」とコメントしている", location: null, code: null, guess: false },
          { text: "変更はオンボーディングの PAT 入力画面に閉じているはず", location: null, code: null, guess: true },
        ],
        replyDraft: "影響はオンボーディングの PAT 入力画面だけです。Azure CLI 経由のサインインと同期処理は変えていません。",
        error: null,
      },
    },
    {
      ...base,
      id: 4,
      kind: "pr_reply",
      subjectId: 103,
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      threadId: 3,
      commentId: 4102,
      title: "Refactor authentication flow with OAuth 2.0 PKCE",
      author: "Grace Kim",
      snippet: "修正しました。再確認をお願いします",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/103",
      detectedAt: minsAgo(95),
      // Still being written by Claude Code.
      insight: { status: "pending", verdict: null, reason: null, evidence: [], replyDraft: null, error: null },
    },
    {
      ...base,
      id: 3,
      kind: "pr_mention",
      subjectId: 189,
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      threadId: 1,
      filePath: "/src/app/dashboard.ts",
      line: 7,
      commentId: 3103,
      title: "Fix crash on back press during payment flow",
      author: "Frank Lee",
      snippet: "@you 決済フローの再現手順を追記しました",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/189",
      detectedAt: minsAgo(300),
      insight: {
        status: "failed",
        verdict: null,
        reason: null,
        evidence: [],
        replyDraft: null,
        error: "claude did not finish within 5 minutes",
      },
    },
  ];
  return seed;
}

function all(): InboxItem[] {
  if (!items) items = buildSeed();
  return items;
}

function effectiveState(item: InboxItem, now: number): "open" | "snoozed" | "done" {
  if (item.state === "done") return "done";
  if (item.state === "snoozed") {
    return item.snoozedUntil && Date.parse(item.snoozedUntil) > now ? "snoozed" : "open";
  }
  return "open";
}

export function demoListInboxItems(input?: ListInboxItemsInput): InboxItem[] {
  const now = Date.now();
  const state = input?.state ?? "open";
  return all()
    .filter((item) => effectiveState(item, now) === state)
    .filter((item) => !input?.organizationId || item.organizationId === input.organizationId)
    // Open items newest first, like the backend's `detected_at DESC`.
    .sort((a, b) =>
      state === "open"
        ? Date.parse(b.detectedAt) - Date.parse(a.detectedAt) || b.id - a.id
        : b.id - a.id,
    )
    .slice(0, input?.limit ?? 200);
}

export function demoInboxCounts(organizationId?: string): InboxCounts {
  const now = Date.now();
  const counts: InboxCounts = { open: 0, snoozed: 0, done: 0 };
  for (const item of all()) {
    if (organizationId && item.organizationId !== organizationId) continue;
    counts[effectiveState(item, now)] += 1;
  }
  return counts;
}

export function demoSetInboxItemState(input: SetInboxItemStateInput): number {
  if (input.state === "snoozed") {
    if (!input.snoozedUntil || Date.parse(input.snoozedUntil) <= Date.now()) {
      throw new Error("snoozedUntil must be in the future");
    }
  }
  const ids = new Set(input.ids);
  let changed = 0;
  for (const item of all()) {
    if (!ids.has(item.id)) continue;
    item.state = input.state;
    item.snoozedUntil = input.state === "snoozed" ? (input.snoozedUntil ?? null) : null;
    item.doneAt = input.state === "done" ? new Date().toISOString() : null;
    changed += 1;
  }
  return changed;
}

/** Test helper: restores the seed data. */
export function resetDemoInbox(): void {
  items = null;
}
