import type {
  DeletePullRequestCommentInput,
  EditPullRequestCommentInput,
  GetPullRequestFileDiffInput,
  PostPullRequestCommentInput,
  PrChangedFile,
  PrCommit,
  PrFileDiff,
  PrThread,
  SetPullRequestThreadStatusInput,
} from "@/lib/azdoCommands";

let demoPrThreadSeq = 100;
const demoPrThreads = new Map<number, PrThread[]>();

export function demoVoteLabel(vote: number): string {
  switch (vote) {
    case 10:
      return "Approved";
    case 5:
      return "Approved w/ Suggestions";
    case -5:
      return "Waiting";
    case -10:
      return "Rejected";
    default:
      return "No Vote";
  }
}

export function demoThreadsFor(pullRequestId: number): PrThread[] {
  const existing = demoPrThreads.get(pullRequestId);
  if (existing) return existing;
  const threads: PrThread[] = [
    {
      id: 1,
      status: "active",
      isResolved: false,
      filePath: null,
      rightLine: null,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "Could you add a test for the empty case?",
          author: "Riley Reviewer",
          publishedDate: "2026-05-22T09:00:00Z",
          isSystem: false,
          isMine: false,
        },
      ],
    },
    {
      id: 2,
      status: "closed",
      isResolved: true,
      filePath: "/src/app/dashboard.ts",
      rightLine: 2,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "This constant should be configurable.",
          author: "Riley Reviewer",
          publishedDate: "2026-05-21T15:00:00Z",
          isSystem: false,
          isMine: false,
        },
        {
          id: 2,
          parentCommentId: 1,
          content: "Fixed in the latest iteration.",
          author: "Demo User",
          publishedDate: "2026-05-22T10:00:00Z",
          isSystem: false,
          isMine: true,
        },
      ],
    },
    {
      id: 3,
      status: null,
      isResolved: false,
      filePath: null,
      rightLine: null,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "Riley Reviewer voted 10",
          author: "Riley Reviewer",
          publishedDate: "2026-05-20T12:00:00Z",
          isSystem: true,
          isMine: false,
        },
      ],
    },
  ];
  demoPrThreads.set(pullRequestId, threads);
  return threads;
}

// Per-PR changed files so the multi-select conflict-overlap warning has
// something to detect in browser/demo mode. PRs share `/src/app/dashboard.ts`
// to produce a visible overlap; odd PR ids also share a config file.
export function demoPrFilesFor(pullRequestId: number): PrChangedFile[] {
  const files: PrChangedFile[] = [
    { path: "/src/app/dashboard.ts", changeType: "edit", originalPath: null },
    { path: `/src/app/feature-${pullRequestId}.ts`, changeType: "add", originalPath: null },
  ];
  if (pullRequestId % 2 === 1) {
    files.push({ path: "/src/app/config.ts", changeType: "edit", originalPath: null });
  }
  return files;
}

export const DEMO_DIFF_BASE = `import { fetchData } from "./api";
import { Logger } from "./logger";

const logger = new Logger("dashboard");

export function loadDashboard() {
  const refreshIntervalMs = 30000;
  logger.info("loading dashboard");
  return fetchData(refreshIntervalMs);
}

// The widgets below stay unchanged across iterations, so a reviewer can fold
// this section away while focusing on the edited code above and below it.
export const widgets = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "network", label: "Network" },
  { id: "errors", label: "Errors" },
  { id: "latency", label: "Latency" },
  { id: "throughput", label: "Throughput" },
];

export function summarize(widgetId: string) {
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  return widget ? widget.label : "unknown";
}
`;

export const demoPrCommits: PrCommit[] = [
  {
    commitId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    shortCommitId: "a1b2c3d4",
    comment: "Make the refresh interval configurable",
    authorName: "Avery Author",
    authorDate: "2026-05-22T10:00:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    commitId: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
    shortCommitId: "b2c3d4e5",
    comment: "Extract useDashboardData hook",
    authorName: "Avery Author",
    authorDate: "2026-05-21T16:30:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  },
  {
    commitId: "c3d4e5f60718293a4b5c6d7e8f90123456789012",
    shortCommitId: "c3d4e5f6",
    comment: "Remove the legacy dashboard loader",
    authorName: "Avery Author",
    authorDate: "2026-05-20T09:15:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/c3d4e5f60718293a4b5c6d7e8f90123456789012",
  },
];

export const DEMO_DIFF_TARGET = `import { fetchData } from "./api";
import { Logger } from "./logger";

const logger = new Logger("dashboard");

export function loadDashboard(options: DashboardOptions) {
  const refreshIntervalMs = options.refreshIntervalMs ?? 30000;
  logger.info("loading dashboard");
  return fetchData(refreshIntervalMs);
}

// The widgets below stay unchanged across iterations, so a reviewer can fold
// this section away while focusing on the edited code above and below it.
export const widgets = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "network", label: "Network" },
  { id: "errors", label: "Errors" },
  { id: "latency", label: "Latency" },
  { id: "throughput", label: "Throughput" },
];

export function summarize(widgetId: string) {
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  return widget ? \`\${widget.label} — a deliberately long, unchanged-but-reflowed descriptive suffix that shows how split view now wraps very long lines instead of clipping them\` : "unknown";
}
`;

export function demoPrFileDiff(input: GetPullRequestFileDiffInput | undefined): PrFileDiff {
  const filePath = input?.filePath ?? "";
  if (filePath.endsWith(".png")) {
    return {
      filePath,
      baseContent: null,
      targetContent: null,
      baseUnavailableReason: null,
      targetUnavailableReason: "binary",
    };
  }
  const tokens = (input?.changeType ?? "edit")
    .toLowerCase()
    .split(",")
    .map((token) => token.trim());
  const isAdd = tokens.includes("add") || tokens.includes("undelete");
  const isDelete = tokens.includes("delete");
  return {
    filePath,
    baseContent: isAdd ? null : DEMO_DIFF_BASE,
    targetContent: isDelete ? null : DEMO_DIFF_TARGET,
    baseUnavailableReason: null,
    targetUnavailableReason: null,
  };
}

export function demoPostPrComment(input: PostPullRequestCommentInput): PrThread {
  const threads = demoThreadsFor(input.pullRequestId);
  if (input.threadId != null) {
    const thread = threads.find((candidate) => candidate.id === input.threadId);
    if (!thread) throw new Error(`thread not found: ${input.threadId}`);
    thread.comments.push({
      id: thread.comments.length + 1,
      parentCommentId: thread.comments[0]?.id ?? 0,
      content: input.content,
      author: "Demo User",
      publishedDate: new Date().toISOString(),
      isSystem: false,
      isMine: true,
    });
    return thread;
  }
  const thread: PrThread = {
    id: ++demoPrThreadSeq,
    status: "active",
    isResolved: false,
    filePath: input.filePath ?? null,
    rightLine: input.rightLine ?? null,
    leftLine: input.leftLine ?? null,
    comments: [
      {
        id: 1,
        parentCommentId: 0,
        content: input.content,
        author: "Demo User",
        publishedDate: new Date().toISOString(),
        isSystem: false,
        isMine: true,
      },
    ],
  };
  threads.unshift(thread);
  return thread;
}

export function demoEditPrComment(input: EditPullRequestCommentInput): PrThread {
  const thread = demoThreadsFor(input.pullRequestId).find(
    (candidate) => candidate.id === input.threadId,
  );
  if (!thread) throw new Error(`thread not found: ${input.threadId}`);
  const comment = thread.comments.find((candidate) => candidate.id === input.commentId);
  if (comment) comment.content = input.content;
  return thread;
}

export function demoDeletePrComment(input: DeletePullRequestCommentInput): null {
  const thread = demoThreadsFor(input.pullRequestId).find(
    (candidate) => candidate.id === input.threadId,
  );
  if (thread) {
    thread.comments = thread.comments.filter((candidate) => candidate.id !== input.commentId);
  }
  return null;
}

export function demoSetPrThreadStatus(input: SetPullRequestThreadStatusInput): PrThread {
  const thread = demoThreadsFor(input.pullRequestId).find(
    (candidate) => candidate.id === input.threadId,
  );
  if (!thread) throw new Error(`thread not found: ${input.threadId}`);
  thread.status = input.status;
  thread.isResolved = input.status === "closed";
  return thread;
}
