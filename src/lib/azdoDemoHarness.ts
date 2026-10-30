import type {
  InboxItem,
  NotificationRecord,
  PullRequestSummary,
  ReviewPullRequestSummary,
  WorkItemPreview,
  WorkItemSummary,
} from "@/lib/azdoCommands";

const DEMO_SCENARIO_STORAGE_KEY = "azdodeck:demo:scenario";

type DemoScenario =
  | "default"
  | "empty"
  | "large-data"
  | "rich-text"
  | "api-errors"
  | "slow-network";

const DEMO_SCENARIOS = new Set<DemoScenario>([
  "default",
  "empty",
  "large-data",
  "rich-text",
  "api-errors",
  "slow-network",
]);

function currentDemoScenario(): DemoScenario {
  const value = readScenarioValue();
  return isDemoScenario(value) ? value : "default";
}

export function demoResponseDelayMs(): number {
  return currentDemoScenario() === "slow-network" ? 900 : 100;
}

export function shouldFailDemoCommand(command: string): boolean {
  if (currentDemoScenario() !== "api-errors") return false;
  return new Set([
    "search_pull_requests",
    "list_my_review_pull_requests",
    "search_work_items",
    "add_work_item_comment",
    "update_work_item_fields",
  ]).has(command);
}

export function applyPullRequestScenario(
  pullRequests: PullRequestSummary[],
): PullRequestSummary[] {
  const scenario = currentDemoScenario();
  if (scenario === "empty") return [];
  if (scenario !== "large-data") return pullRequests;
  return repeatPullRequests(pullRequests, 180);
}

export function applyReviewPullRequestScenario(
  pullRequests: ReviewPullRequestSummary[],
): ReviewPullRequestSummary[] {
  const scenario = currentDemoScenario();
  if (scenario === "empty") return [];
  if (scenario !== "large-data") return pullRequests;
  return repeatReviewPullRequests(pullRequests, 260);
}

export function applyWorkItemScenario(
  workItems: WorkItemSummary[],
): WorkItemSummary[] {
  const scenario = currentDemoScenario();
  if (scenario === "empty") return [];
  if (scenario !== "large-data") return workItems;
  return repeatWorkItems(workItems, largeWorkItemCount());
}

/** `?wiCount=3000` lengthens the large-data work item lists (default 420). */
function largeWorkItemCount(): number {
  const requested = Number(new URLSearchParams(window.location.search).get("wiCount"));
  return Number.isInteger(requested) && requested > 0 ? requested : 420;
}

export function applyNotificationScenario(
  notifications: NotificationRecord[],
): NotificationRecord[] {
  const scenario = currentDemoScenario();
  if (scenario === "empty") return [];
  if (scenario !== "large-data") return notifications;
  return [...notifications, ...repeatNotifications(notifications, 300)];
}

export function applyInboxScenario(items: InboxItem[]): InboxItem[] {
  const scenario = currentDemoScenario();
  if (scenario === "empty") return [];
  if (scenario !== "large-data") return items;
  return [...items, ...repeatInboxItems(items, 300)];
}

export function applyWorkItemPreviewScenario(
  preview: WorkItemPreview,
): WorkItemPreview {
  const scenario = currentDemoScenario();
  if (scenario === "rich-text") {
    return {
      ...preview,
      descriptionHtml: richTextDescription(preview),
      acceptanceCriteriaHtml: richTextAcceptanceCriteria(),
      comments: richTextComments(preview),
    };
  }
  if (scenario === "large-data") {
    return {
      ...preview,
      descriptionHtml: `${preview.descriptionHtml ?? ""}${largeDescriptionSuffix()}`,
      comments: repeatComments(preview.comments, 80),
    };
  }
  return preview;
}

function readScenarioValue(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("scenario");
  if (fromUrl) return fromUrl;
  return window.localStorage.getItem(DEMO_SCENARIO_STORAGE_KEY);
}

function isDemoScenario(value: string | null): value is DemoScenario {
  return value !== null && DEMO_SCENARIOS.has(value as DemoScenario);
}

function repeatPullRequests(
  base: PullRequestSummary[],
  count: number,
): PullRequestSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const source = base[index % base.length];
    const id = 10_000 + index;
    return {
      ...source,
      pullRequestId: id,
      title: `${source.title} #${index + 1}`,
      creationDate: shiftedIso(source.creationDate, index),
      webUrl: source.webUrl?.replace(
        /pullrequest\/\d+$/,
        `pullrequest/${id}`,
      ) ?? null,
    };
  });
}

function repeatReviewPullRequests(
  base: ReviewPullRequestSummary[],
  count: number,
): ReviewPullRequestSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const source = base[index % base.length];
    const id = 20_000 + index;
    return {
      ...source,
      pullRequestId: id,
      title: `${source.title} #${index + 1}`,
      creationDate: shiftedIso(source.creationDate, index),
      webUrl: source.webUrl?.replace(
        /pullrequest\/\d+$/,
        `pullrequest/${id}`,
      ) ?? null,
      isDraft: index % 17 === 0,
      myVote: index % 11 === 0 ? -10 : source.myVote,
      myVoteLabel: index % 11 === 0 ? "Rejected" : source.myVoteLabel,
    };
  });
}

// Assignee only: views filter on state and type, so those must stay put.
const LONG_ASSIGNEES = [
  "Alexandra Montgomery-Watanabe",
  "Christopher Nakamura",
  "Maximilian Okonkwo-Fernandes",
  "Bo Li",
];

function repeatWorkItems(
  base: WorkItemSummary[],
  count: number,
): WorkItemSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const source = base[index % base.length];
    const id = 30_000 + index;
    // Real result sets mix short and long values, and the long ones often
    // only appear further down, so auto-fitted columns keep growing while
    // scrolling, as they do against a real organization.
    const assignedTo =
      index >= 40 && index % 4 === 0 ? LONG_ASSIGNEES[(index / 4) % LONG_ASSIGNEES.length] : source.assignedTo;
    return {
      ...source,
      assignedTo,
      id,
      title: `${source.title} #${index + 1}`,
      changedDate: source.changedDate
        ? shiftedIso(source.changedDate, index)
        : source.changedDate,
      webUrl: source.webUrl?.replace(/edit\/\d+$/, `edit/${id}`) ?? null,
    };
  });
}

// Negative ids sort the extra rows after the seed rows (the list is ordered by
// id, newest first) and never collide with ids recorded during the session.
function repeatNotifications(
  base: NotificationRecord[],
  count: number,
): NotificationRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const source = base[index % base.length];
    return {
      ...source,
      id: -(index + 1),
      title: `${source.title} #${index + 1}`,
      createdAt: shiftedIso(source.createdAt, index + 60),
      isRead: index % 3 !== 0,
    };
  });
}

function repeatInboxItems(base: InboxItem[], count: number): InboxItem[] {
  return Array.from({ length: count }, (_, index) => {
    const source = base[index % base.length];
    return {
      ...source,
      id: 50_000 + index,
      title: `${source.title} #${index + 1}`,
      detectedAt: shiftedIso(source.detectedAt, index + 60),
    };
  });
}

function repeatComments(
  comments: WorkItemPreview["comments"],
  count: number,
): WorkItemPreview["comments"] {
  return Array.from({ length: count }, (_, index) => {
    const source = comments[index % Math.max(comments.length, 1)];
    return {
      id: 40_000 + index,
      text: source?.text ?? `Harness comment ${index + 1}`,
      renderedText:
        source?.renderedText ??
        `<p>Harness comment ${index + 1} with enough text to exercise wrapping.</p>`,
      createdBy: source?.createdBy ?? "Demo User",
      createdById: source?.createdById ?? "demo-user",
      createdByUniqueName:
        source?.createdByUniqueName ?? "demo.user@contoso.example",
      createdDate: shiftedIso(
        source?.createdDate ?? "2026-05-27T14:00:00Z",
        index,
      ),
    };
  });
}

function shiftedIso(value: string, index: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  date.setMinutes(date.getMinutes() - index * 13);
  return date.toISOString();
}

function richTextDescription(preview: WorkItemPreview): string {
  return `<p><strong>${escapeHtml(preview.title)}</strong> includes rich Azure DevOps content.</p>
<p><span data-vss-mention="version:2.0,demo-user">@Demo User</span> please verify the embedded assets.</p>
<table><thead><tr><th>Case</th><th>Expected</th></tr></thead><tbody><tr><td>Image</td><td>Renders through fetch_work_item_image</td></tr><tr><td>Link</td><td><a href="https://dev.azure.com/contoso">Azure DevOps</a></td></tr></tbody></table>
<blockquote>Quoted discussion should stay readable in the preview.</blockquote>
<pre><code>azdo-harness --scenario rich-text</code></pre>
<p><img alt="Harness preview image" src="https://dev.azure.com/contoso/${encodeURIComponent(preview.projectName)}/_apis/wit/attachments/harness-image?fileName=harness.svg"></p>`;
}

function richTextAcceptanceCriteria(): string {
  return "<ol><li>Mentions show a display name.</li><li>Images render.</li><li>Tables remain compact.</li></ol>";
}

function richTextComments(preview: WorkItemPreview): WorkItemPreview["comments"] {
  return [
    {
      id: 90_001,
      text: "@Demo User rich text comment",
      renderedText:
        '<div><a href="#" data-vss-mention="version:2.0,demo-user">@Demo User</a>&nbsp;rich text comment</div>',
      createdBy: "Alice Johnson",
      createdById: "demo-alice",
      createdByUniqueName: "alice@contoso.example",
      createdDate: "2026-05-27T15:00:00Z",
    },
    {
      id: 90_002,
      text: "Image and link comment",
      renderedText:
        '<p>Screenshot follows.</p><p><img alt="Comment image" src="https://dev.azure.com/contoso/_apis/wit/attachments/comment-image?fileName=comment.svg"></p><p><a href="https://dev.azure.com/contoso">Open project</a></p>',
      createdBy: "Bob Tanaka",
      createdById: "demo-bob",
      createdByUniqueName: "bob@contoso.example",
      createdDate: "2026-05-27T14:30:00Z",
    },
    ...preview.comments,
  ];
}

function largeDescriptionSuffix(): string {
  return Array.from(
    { length: 24 },
    (_, index) =>
      `<p>Large scenario paragraph ${index + 1}: this exercises preview height, scrolling, and rendering cost.</p>`,
  ).join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
