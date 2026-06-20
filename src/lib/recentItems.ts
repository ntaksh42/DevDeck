/**
 * Tracks recently opened Work Items and Pull Requests so the command palette can
 * offer them as "Recent" entries. Two localStorage stores back this: one for
 * work items (already written by the work item grid) and one for pull requests.
 *
 * All reads tolerate missing or corrupt data — a broken value must never crash
 * the palette — and writes are best-effort.
 */
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import type { PullRequestSummary, ReviewPullRequestSummary, WorkItemSummary } from "@/lib/azdoCommands";

const RECENT_WORK_ITEMS_STORAGE_KEY = "azdodeck:workItems:recent";
const RECENT_PULL_REQUESTS_STORAGE_KEY = "azdodeck:pullRequests:recent";
const RECENT_ITEMS_MAX = 20;

export type RecentWorkItem = {
  key: string;
  id: number;
  organizationId: string;
  projectId: string;
  projectName: string;
  title: string;
  viewedAt: string;
  /** Monotonic insertion order; breaks ties when viewedAt collides. */
  seq?: number;
  webUrl: string | null;
};

export type RecentPullRequest = {
  key: string;
  pullRequestId: number;
  organizationId: string;
  repositoryId: string;
  repositoryName: string;
  title: string;
  viewedAt: string;
  /** Monotonic insertion order; breaks ties when viewedAt collides. */
  seq?: number;
  webUrl: string | null;
};

/** A normalized recent entry the command palette can render and act on. */
export type RecentPaletteEntry = {
  kind: "workItems" | "pullRequests";
  key: string;
  label: string;
  detail?: string;
  /** Query string used to re-open the item in its feature view. */
  query: string;
  organizationId: string;
  webUrl: string | null;
  viewedAt: string;
  seq?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function loadRecentWorkItems(): RecentWorkItem[] {
  return readStoredJson(
    RECENT_WORK_ITEMS_STORAGE_KEY,
    (raw) => {
      if (!Array.isArray(raw)) return undefined;
      return raw.filter(
        (entry): entry is RecentWorkItem =>
          isRecord(entry) &&
          typeof entry.key === "string" &&
          typeof entry.id === "number" &&
          typeof entry.organizationId === "string" &&
          typeof entry.title === "string",
      );
    },
    [],
  );
}

function loadRecentPullRequests(): RecentPullRequest[] {
  return readStoredJson(
    RECENT_PULL_REQUESTS_STORAGE_KEY,
    (raw) => {
      if (!Array.isArray(raw)) return undefined;
      return raw.filter(
        (entry): entry is RecentPullRequest =>
          isRecord(entry) &&
          typeof entry.key === "string" &&
          typeof entry.pullRequestId === "number" &&
          typeof entry.organizationId === "string" &&
          typeof entry.title === "string",
      );
    },
    [],
  );
}

/**
 * Returns the next monotonic sequence value across both recent stores. viewedAt
 * has only millisecond resolution, so items opened in the same tick would tie;
 * the sequence preserves their real insertion order.
 */
function nextSequence(): number {
  const maxSeq = (entries: { seq?: number }[]): number =>
    entries.reduce((max, entry) => Math.max(max, entry.seq ?? 0), 0);
  return Math.max(maxSeq(loadRecentWorkItems()), maxSeq(loadRecentPullRequests())) + 1;
}

/** Records a work item as recently opened. Most-recent first, capped and deduped. */
export function recordRecentWorkItem(item: WorkItemSummary): void {
  const key = `${item.organizationId}:${item.projectId}:${item.id}`;
  const next: RecentWorkItem[] = [
    {
      key,
      id: item.id,
      organizationId: item.organizationId,
      projectId: item.projectId,
      projectName: item.projectName,
      title: item.title,
      viewedAt: new Date().toISOString(),
      seq: nextSequence(),
      webUrl: item.webUrl,
    },
    ...loadRecentWorkItems().filter((entry) => entry.key !== key),
  ].slice(0, RECENT_ITEMS_MAX);
  writeStoredJson(RECENT_WORK_ITEMS_STORAGE_KEY, next);
}

/** Records a pull request as recently opened. Most-recent first, capped and deduped. */
export function recordRecentPullRequest(
  pr: PullRequestSummary | ReviewPullRequestSummary,
): void {
  const key = `${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`;
  const next: RecentPullRequest[] = [
    {
      key,
      pullRequestId: pr.pullRequestId,
      organizationId: pr.organizationId,
      repositoryId: pr.repositoryId,
      repositoryName: pr.repositoryName,
      title: pr.title,
      viewedAt: new Date().toISOString(),
      seq: nextSequence(),
      webUrl: pr.webUrl,
    },
    ...loadRecentPullRequests().filter((entry) => entry.key !== key),
  ].slice(0, RECENT_ITEMS_MAX);
  writeStoredJson(RECENT_PULL_REQUESTS_STORAGE_KEY, next);
}

/**
 * Returns recently opened work items and pull requests merged into a single
 * list, newest first. `showOrg` controls whether the organization id is shown
 * in the detail line (only useful with multiple organizations).
 */
export function loadRecentPaletteEntries(showOrg: boolean): RecentPaletteEntry[] {
  const workItems: RecentPaletteEntry[] = loadRecentWorkItems().map((item) => ({
    kind: "workItems",
    key: `wi:${item.key}`,
    label: `#${item.id} ${item.title}`,
    detail:
      [showOrg ? item.organizationId : null, item.projectName].filter(Boolean).join(" · ") ||
      undefined,
    query: String(item.id),
    organizationId: item.organizationId,
    webUrl: item.webUrl,
    viewedAt: item.viewedAt,
    seq: item.seq,
  }));
  const pullRequests: RecentPaletteEntry[] = loadRecentPullRequests().map((pr) => ({
    kind: "pullRequests",
    key: `pr:${pr.key}`,
    label: `PR ${pr.pullRequestId} ${pr.title}`,
    detail:
      [showOrg ? pr.organizationId : null, pr.repositoryName].filter(Boolean).join(" · ") ||
      undefined,
    query: String(pr.pullRequestId),
    organizationId: pr.organizationId,
    webUrl: pr.webUrl,
    viewedAt: pr.viewedAt,
    seq: pr.seq,
  }));
  return [...workItems, ...pullRequests].sort((left, right) => {
    const seqLeft = left.seq ?? -1;
    const seqRight = right.seq ?? -1;
    if (seqLeft !== seqRight) return seqRight - seqLeft;
    return right.viewedAt.localeCompare(left.viewedAt);
  });
}
