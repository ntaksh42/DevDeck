import type {
  CommitActivityDay,
  CommitActivityInput,
  CommitPullRequest,
  CommitRepositoryOption,
  CommitSummary,
  SearchCommitsInput,
} from "@/lib/azdoCommands";

export function demoCommitRepositories(): CommitRepositoryOption[] {
  return [
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
    },
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
    },
    {
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
    },
    {
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
    },
  ];
}

// Demo branches for the code browser. `main` is the default and sorts first.
export function demoRepoBranches() {
  return [
    { name: "main", isDefault: true },
    { name: "develop", isDefault: false },
    { name: "feature/dashboard", isDefault: false },
  ];
}

// A tiny virtual repository for the code browser demo. Keyed by the parent
// folder path; each entry lists that folder's direct children (folders first).
const DEMO_REPO_TREE: Record<string, { name: string; path: string; isFolder: boolean }[]> = {
  "/": [
    { name: "assets", path: "/assets", isFolder: true },
    { name: "src", path: "/src", isFolder: true },
    { name: "README.md", path: "/README.md", isFolder: false },
    { name: "package.json", path: "/package.json", isFolder: false },
  ],
  "/assets": [{ name: "logo.png", path: "/assets/logo.png", isFolder: false }],
  "/src": [
    { name: "lib", path: "/src/lib", isFolder: true },
    { name: "App.tsx", path: "/src/App.tsx", isFolder: false },
  ],
  "/src/lib": [
    { name: "azdoCommands.ts", path: "/src/lib/azdoCommands.ts", isFolder: false },
    { name: "azdoDemo.ts", path: "/src/lib/azdoDemo.ts", isFolder: false },
  ],
};

const DEMO_LAST_COMMIT = {
  shortId: "7219380a",
  commitId: "7219380abc1234567890",
  message: "Initial calculator service",
  author: "naoto akashi",
  date: "2026-06-13T00:00:00Z",
};

export function demoRepoTree(path?: string, includeLastCommit?: boolean) {
  const key = !path || path.trim() === "" ? "/" : path.replace(/\/+$/, "") || "/";
  const items = DEMO_REPO_TREE[key] ?? [];
  return items.map((item) => ({
    ...item,
    lastCommit: includeLastCommit ? DEMO_LAST_COMMIT : null,
  }));
}

// Demo file contents keyed by path, with a generic fallback so any file opens.
const DEMO_REPO_FILES: Record<string, string> = {
  "/README.md":
    "# azdo-dashboard\n\nA Tauri + React dashboard for Azure DevOps.\n\n## Getting started\n\n```sh\npnpm install\npnpm dev\n```\n",
  "/package.json": '{\n  "name": "azdo-dashboard",\n  "version": "0.1.16",\n  "private": true\n}\n',
  "/src/App.tsx":
    'import { useState } from "react";\n\nexport function App() {\n  const [view, setView] = useState("code");\n  return <div className="app">{view}</div>;\n}\n',
  "/src/lib/azdoCommands.ts":
    'import { z } from "zod";\n\nexport async function searchCode(input: { query: string }) {\n  const result = await invokeCommand("search_code", { input });\n  return codeSearchResultsSchema.parse(result);\n}\n',
  "/src/lib/azdoDemo.ts":
    'export async function demoInvoke(command: string, args?: unknown) {\n  // Returns canned data so the browser preview works without a backend.\n  return null;\n}\n',
};

// A 1x1 transparent PNG so the browser preview can exercise the image pane.
const DEMO_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function demoRepoFile(path: string) {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) {
    return {
      path,
      content: "",
      isBinary: true,
      tooLarge: false,
      truncated: false,
      imageDataUrl: DEMO_IMAGE_DATA_URL,
    };
  }
  const content =
    DEMO_REPO_FILES[path] ?? `// ${path}\n// Demo content for the code browser preview.\n`;
  return { path, content, isBinary: false, tooLarge: false, truncated: false, imageDataUrl: null };
}

// Every file/folder path in the demo repository, flattened for the recursive
// tree filter.
export function demoRepoPaths() {
  const items = Object.values(DEMO_REPO_TREE)
    .flat()
    .map(({ name, path, isFolder }) => ({ name, path, isFolder }))
    .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  return { items, truncated: false };
}

// Demo commit history for the Files > History tab. A short, fixed list so the
// browser preview shows the layout without a backend.
export function demoRepoHistory(path: string) {
  const scoped = path && path !== "/" ? ` (${path})` : "";
  return [
    {
      shortId: "7219380a",
      commitId: "7219380abc1234567890",
      message: `Initial calculator service${scoped}`,
      author: "naoto akashi",
      date: "2026-06-13T00:00:00Z",
    },
    {
      shortId: "a1b2c3d4",
      commitId: "a1b2c3d4ef5678901234",
      message: "Add expression utilities",
      author: "naoto akashi",
      date: "2026-06-12T00:00:00Z",
    },
  ];
}

// A merge-commit id used by the demo `get_commit_changes` response so the
// browser preview can exercise the parent selector (#530) with a real
// two-parent commit.
export const DEMO_MERGE_COMMIT_ID = "demomerge";

export function demoCommitChanges(commitId?: string) {
  const id = commitId ?? "demosha";
  const isMerge = id === DEMO_MERGE_COMMIT_ID;
  return {
    commitId: id,
    parents: isMerge ? ["demoparent", "demoparent2"] : ["demoparent"],
    files: [
      { path: "/src/app.ts", changeType: "edit", originalPath: null },
      { path: "/README.md", changeType: "add", originalPath: null },
    ],
  };
}

// Demo commit → PR relationships. Only a couple of commits map to PRs so the
// "no related PRs" path stays exercised for the rest.
export function demoCommitPullRequests(commitId?: string): CommitPullRequest[] {
  const map: Record<string, CommitPullRequest[]> = {
    abcdef1234567890abcdef1234567890abcdef12: [
      {
        pullRequestId: 4242,
        repositoryId: "azdo-dashboard",
        title: "Add commit search dashboard",
        status: "completed",
        myVote: 10,
        myVoteLabel: "Approved",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/4242",
      },
    ],
    cafe5678901234567890abcdef1234567890cafe: [
      {
        pullRequestId: 4310,
        repositoryId: "api-gateway",
        title: "Fix Retry-After header parsing",
        status: "active",
        myVote: 0,
        myVoteLabel: "No Vote",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/4310",
      },
      {
        pullRequestId: 4288,
        repositoryId: "api-gateway",
        title: "Rate limiting hardening",
        status: "abandoned",
        myVote: -5,
        myVoteLabel: "Waiting",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/4288",
      },
    ],
  };
  return commitId ? map[commitId] ?? [] : [];
}

// Representative changed paths per demo commit so the `path:` filter (#302) has
// something to match against in the browser preview. Real commits resolve this
// server-side via searchCriteria.itemPath.
const DEMO_COMMIT_PATHS: Record<string, string[]> = {
  abcdef1234567890abcdef1234567890abcdef12: ["/src/features/commits/CommitSearch.tsx"],
  beef1234567890abcdef1234567890abcdef1234: ["/src/features/pull-requests/MyReviewsGrid.tsx"],
  "1234567890abcdef1234567890abcdef12345678": ["/src/middleware/tracing.go"],
  cafe5678901234567890abcdef1234567890cafe: ["/src/ratelimit/retry.go"],
  fedcba9876543210fedcba9876543210fedcba98: ["/app/src/main/java/payment/Checkout.kt"],
  dead1234567890abcdef1234567890abcdefdead: ["/app/src/main/java/auth/Biometric.kt"],
  f00d5678901234567890abcdef1234567890f00d: ["/modules/eks/main.tf"],
  babe1234567890abcdef1234567890abcdefbabe: ["/modules/ecs/task.tf"],
};

function normalizeDemoPath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function demoCommitMatchesPath(commitId: string, normalized: string): boolean {
  const paths = DEMO_COMMIT_PATHS[commitId] ?? [];
  return paths.some((path) => path === normalized || path.startsWith(`${normalized}/`));
}

export function demoCommits(input?: SearchCommitsInput): CommitSummary[] {
  const commits: CommitSummary[] = [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      commitId: "abcdef1234567890abcdef1234567890abcdef12",
      shortCommitId: "abcdef12",
      comment: "Add commit search dashboard with grid view and keyboard nav",
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/abcdef1234567890abcdef1234567890abcdef12",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      commitId: "beef1234567890abcdef1234567890abcdef1234",
      shortCommitId: "beef1234",
      comment: "feat(ui): add per-column resize handles to MyReviewsGrid",
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: "2026-05-26T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/beef1234567890abcdef1234567890abcdef1234",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      commitId: "1234567890abcdef1234567890abcdef12345678",
      shortCommitId: "12345678",
      comment: "Tune request tracing middleware to reduce overhead",
      authorName: "Alice Johnson",
      authorEmail: "alice@example.com",
      authorDate: "2026-05-26T09:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/commit/1234567890abcdef1234567890abcdef12345678",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      commitId: "cafe5678901234567890abcdef1234567890cafe",
      shortCommitId: "cafe5678",
      comment: "fix: correct Retry-After header parsing for rate limiting",
      authorName: "Bob Tanaka",
      authorEmail: "bob@example.com",
      authorDate: "2026-05-25T16:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/commit/cafe5678901234567890abcdef1234567890cafe",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      commitId: "fedcba9876543210fedcba9876543210fedcba98",
      shortCommitId: "fedcba98",
      comment: "Fix payment flow back navigation crash on Android 14",
      authorName: "Frank Lee",
      authorEmail: "frank@example.com",
      authorDate: "2026-05-25T03:15:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/commit/fedcba9876543210fedcba9876543210fedcba98",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      commitId: "dead1234567890abcdef1234567890abcdefdead",
      shortCommitId: "dead1234",
      comment: "Add biometric auth screen with fallback PIN entry",
      authorName: "Carol Wang",
      authorEmail: "carol@example.com",
      authorDate: "2026-05-24T11:45:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/commit/dead1234567890abcdef1234567890abcdefdead",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      commitId: "f00d5678901234567890abcdef1234567890f00d",
      shortCommitId: "f00d5678",
      comment: "chore: bump EKS node group AMI to al2023-x86_64-1.29",
      authorName: "Eve Nakamura",
      authorEmail: "eve@example.com",
      authorDate: "2026-05-23T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/commit/f00d5678901234567890abcdef1234567890f00d",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      commitId: "babe1234567890abcdef1234567890abcdefbabe",
      shortCommitId: "babe1234",
      comment: "feat: add Datadog APM agent to ECS task definitions",
      authorName: "Eve Nakamura",
      authorEmail: "eve@example.com",
      authorDate: "2026-05-21T13:20:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/commit/babe1234567890abcdef1234567890abcdefbabe",
    },
  ];

  const projectFilter = new Set((input?.projectIds ?? []).filter(Boolean));
  const repositoryFilter = new Set((input?.repositoryIds ?? []).filter(Boolean));

  const itemPath = input?.itemPath?.trim();
  // Mirror the backend contract: branch- or path-scoped search needs exactly
  // one repository because it queries Azure DevOps live instead of the cache.
  if ((input?.branch?.trim() || itemPath) && repositoryFilter.size !== 1) {
    throw new Error("select a single repository to search a specific branch or path");
  }
  const normalizedPath = itemPath ? normalizeDemoPath(itemPath) : null;

  const query = input?.query?.trim().toLowerCase();
  const author = input?.author?.trim().toLowerCase();
  const fromDate = input?.fromDate ? new Date(`${input.fromDate}T00:00:00Z`) : null;
  const toDate = input?.toDate ? new Date(`${input.toDate}T23:59:59Z`) : null;

  return commits.filter((commit) => {
    if (projectFilter.size > 0 && !projectFilter.has(commit.projectId)) {
      return false;
    }
    if (repositoryFilter.size > 0 && !repositoryFilter.has(commit.repositoryId)) {
      return false;
    }
    if (normalizedPath && !demoCommitMatchesPath(commit.commitId, normalizedPath)) {
      return false;
    }
    if (
      query &&
      ![
        commit.comment,
        commit.projectName,
        commit.repositoryName,
        commit.authorName ?? "",
        commit.authorEmail ?? "",
        commit.commitId,
      ].some((value) => value.toLowerCase().includes(query))
    ) {
      return false;
    }
    if (
      author &&
      ![commit.authorName ?? "", commit.authorEmail ?? ""].some((value) =>
        value.toLowerCase().includes(author),
      )
    ) {
      return false;
    }
    const authorDate = commit.authorDate ? new Date(commit.authorDate) : null;
    if (fromDate && authorDate && authorDate < fromDate) {
      return false;
    }
    if (toDate && authorDate && authorDate > toDate) {
      return false;
    }
    return true;
  });
}

export function demoCommitActivity(input?: CommitActivityInput): CommitActivityDay[] {
  // Synthesize a deterministic, GitHub-style cadence over the requested window
  // (defaulting to the last 90 days) so the browser demo shows a populated
  // heatmap. Filters narrow the volume to mimic per-author / per-repo activity.
  const end = input?.toDate ? new Date(`${input.toDate}T00:00:00Z`) : new Date();
  const start = input?.fromDate
    ? new Date(`${input.fromDate}T00:00:00Z`)
    : new Date(end.getTime() - 89 * 86_400_000);
  if (start > end) return [];

  const narrowed = (input?.author?.trim() ? 1 : 0) + (input?.repositoryId ? 1 : 0);
  const scale = narrowed >= 2 ? 0.3 : narrowed === 1 ? 0.55 : 1;

  const days: CommitActivityDay[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const dow = cursor.getUTCDay();
    // Deterministic pseudo-random based on the date string.
    let seed = 0;
    for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const base = seed % 7; // 0..6
    const weekendDamping = dow === 0 || dow === 6 ? 0.25 : 1;
    const count = Math.round(base * weekendDamping * scale);
    if (count > 0) days.push({ date, count });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function demoSearchCode(query: string) {
  if (!query) return { count: 0, results: [], notice: null };
  return {
    // The Search API reports total matches, which can exceed the returned
    // results (the backend caps results at 50). Mirror that here.
    count: 137,
    notice: null,
    results: [
      {
        fileName: "azdoCommands.ts",
        path: "/src/lib/azdoCommands.ts",
        projectName: "Demo Project",
        repositoryName: "azdo-dashboard",
        branch: "main",
        webUrl:
          "https://dev.azure.com/demo/Demo%20Project/_git/azdo-dashboard?path=/src/lib/azdoCommands.ts&_a=contents&version=GBmain",
      },
      {
        fileName: "App.tsx",
        path: "/src/App.tsx",
        projectName: "Demo Project",
        repositoryName: "azdo-dashboard",
        branch: "main",
        webUrl:
          "https://dev.azure.com/demo/Demo%20Project/_git/azdo-dashboard?path=/src/App.tsx&_a=contents&version=GBmain",
      },
    ],
  };
}

export function demoGetCodeSearchContext(query: string) {
  return {
    totalMatches: 2,
    truncated: false,
    blocks: [
      {
        lines: [
          { lineNumber: 521, text: "", isMatch: false },
          { lineNumber: 522, text: `export async function ${query}(input: {`, isMatch: true },
          { lineNumber: 523, text: "  organizationId?: string;", isMatch: false },
        ],
      },
      {
        lines: [
          { lineNumber: 530, text: "}): Promise<CodeSearchResults> {", isMatch: false },
          { lineNumber: 531, text: `  const result = await invokeCommand("${query}", { input });`, isMatch: true },
          { lineNumber: 532, text: "  return codeSearchResultsSchema.parse(result);", isMatch: false },
        ],
      },
    ],
  };
}
