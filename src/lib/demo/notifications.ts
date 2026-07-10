import type {
  ListNotificationsInput,
  NotificationRecord,
  RecordNotificationInput,
} from "@/lib/azdoCommands";

const DEMO_ORG = "contoso";

// Seed records are built lazily (once) so their `createdAt` timestamps are
// relative to the moment the demo actually starts, rather than baked in.
let seededNotifications: NotificationRecord[] | null = null;
// Records added via `record_notification` during the session, newest first.
const recordedNotifications: NotificationRecord[] = [];
let nextRecordedId = 1000;

function buildSeedNotifications(): NotificationRecord[] {
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  return [
    {
      id: 10,
      createdAt: minsAgo(8),
      organizationId: DEMO_ORG,
      kind: "prReviewRequested",
      title: "レビュー依頼: Add pull request search dashboard",
      body: "Demo User があなたにレビューを依頼しました。",
      payload: {
        pullRequestId: 42,
        repositoryId: "azdo-dashboard",
        repositoryName: "azdo-dashboard",
        projectName: "Platform",
        webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
        commentAuthor: null,
        snippet: null,
      },
      isRead: false,
    },
    {
      id: 9,
      createdAt: minsAgo(25),
      organizationId: DEMO_ORG,
      kind: "prVoteReset",
      title: "投票がリセットされました: Refactor authentication flow with OAuth 2.0 PKCE",
      body: "新しい変更がプッシュされたため、あなたの投票はリセットされました。",
      payload: {
        pullRequestId: 103,
        repositoryId: "api-gateway",
        repositoryName: "api-gateway",
        projectName: "Platform",
        webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/103",
        commentAuthor: null,
        snippet: null,
      },
      isRead: false,
    },
    {
      id: 8,
      createdAt: minsAgo(40),
      organizationId: DEMO_ORG,
      kind: "prCommentReply",
      title: "返信: Fix crash on back press during payment flow",
      body: "Frank Lee があなたのコメントに返信しました。",
      payload: {
        pullRequestId: 189,
        repositoryId: "android-app",
        repositoryName: "android-app",
        projectName: "Mobile",
        webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/189",
        commentAuthor: "Frank Lee",
        snippet: "ここの null チェックは必要ですか？",
      },
      isRead: true,
    },
    {
      id: 7,
      createdAt: minsAgo(60),
      organizationId: DEMO_ORG,
      kind: "wiAssigned",
      title: "割り当て: Validate onboarding with PAT credentials",
      body: "このワークアイテムがあなたに割り当てられました。",
      payload: {
        workItemId: 123,
        projectName: "Platform",
        state: "Active",
        previousState: null,
        webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
      },
      isRead: false,
    },
    {
      id: 6,
      createdAt: minsAgo(95),
      organizationId: DEMO_ORG,
      kind: "wiStateChanged",
      title: "状態変更: Rate limiting middleware causes 429 cascade on retries",
      body: "New から Active に変更されました。",
      payload: {
        workItemId: 118,
        projectName: "Platform",
        state: "Active",
        previousState: "New",
        webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/118",
      },
      isRead: true,
    },
    {
      id: 5,
      createdAt: minsAgo(130),
      organizationId: DEMO_ORG,
      kind: "syncFailed",
      title: "同期に失敗しました",
      body: "3 回連続で同期に失敗しました。次回は 120 秒後に再試行します。",
      payload: {
        consecutiveFailures: 3,
        retryInSecs: 120,
        lastError: "Request timed out",
      },
      isRead: false,
    },
    {
      id: 4,
      createdAt: minsAgo(180),
      organizationId: DEMO_ORG,
      kind: "pipelineWatchStarted",
      title: "パイプライン監視を開始: CI",
      body: "ビルド 20260613.4 の監視を開始しました。",
      payload: {
        definitionName: "CI",
        projectName: "Demo Project",
        buildNumber: "20260613.4",
        sourceBranch: "refs/heads/feature/login",
        webUrl: null,
      },
      isRead: true,
    },
    {
      id: 3,
      createdAt: minsAgo(210),
      organizationId: DEMO_ORG,
      kind: "pipelineWatchFinished",
      title: "パイプラインが完了: CI",
      body: "ビルド 20260613.3 が成功しました。",
      payload: {
        definitionName: "CI",
        projectName: "Demo Project",
        buildNumber: "20260613.3",
        sourceBranch: "refs/heads/main",
        webUrl: null,
      },
      isRead: true,
    },
    {
      id: 2,
      createdAt: minsAgo(260),
      organizationId: DEMO_ORG,
      kind: "pipelineRunQueued",
      title: "パイプラインがキューに追加されました: Nightly",
      body: "ビルド 20260613.5 がキューに追加されました。",
      payload: {
        definitionName: "Nightly",
        projectName: "Demo Project",
        buildNumber: "20260613.5",
        sourceBranch: "refs/heads/main",
        webUrl: null,
      },
      isRead: false,
    },
    {
      id: 1,
      createdAt: minsAgo(320),
      organizationId: DEMO_ORG,
      kind: "wiAssigned",
      title: "割り当て: Fix crash on launch for Android 14",
      body: "このワークアイテムがあなたに割り当てられました。",
      payload: {
        workItemId: 187,
        projectName: "Mobile",
        state: "Active",
        previousState: null,
        webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/187",
      },
      isRead: true,
    },
  ];
}

function allDemoNotifications(): NotificationRecord[] {
  if (!seededNotifications) {
    seededNotifications = buildSeedNotifications();
  }
  return [...recordedNotifications, ...seededNotifications].sort((a, b) => b.id - a.id);
}

export function demoListNotifications(input?: ListNotificationsInput): {
  items: NotificationRecord[];
  hasMore: boolean;
} {
  const limit = input?.limit ?? 20;
  const kindsFilter = input?.kinds && input.kinds.length > 0 ? new Set(input.kinds) : null;

  let filtered = allDemoNotifications();
  if (input?.organizationId) {
    filtered = filtered.filter((n) => n.organizationId === input.organizationId);
  }
  if (input?.unreadOnly) {
    filtered = filtered.filter((n) => !n.isRead);
  }
  if (kindsFilter) {
    filtered = filtered.filter((n) => kindsFilter.has(n.kind));
  }
  if (input?.beforeId != null) {
    filtered = filtered.filter((n) => n.id < input.beforeId!);
  }

  const items = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  return { items, hasMore };
}

export function demoUnreadNotificationsCount(): number {
  return allDemoNotifications().filter((n) => !n.isRead).length;
}

export function demoMarkNotificationsRead(ids: number[]): void {
  const idSet = new Set(ids);
  for (const notification of allDemoNotifications()) {
    if (idSet.has(notification.id)) {
      notification.isRead = true;
    }
  }
}

export function demoMarkAllNotificationsRead(): void {
  for (const notification of allDemoNotifications()) {
    notification.isRead = true;
  }
}

export function demoRecordNotification(input: RecordNotificationInput): void {
  recordedNotifications.unshift({
    id: nextRecordedId++,
    createdAt: new Date().toISOString(),
    organizationId: input.organizationId ?? null,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    payload: input.payload,
    isRead: false,
  });
}
