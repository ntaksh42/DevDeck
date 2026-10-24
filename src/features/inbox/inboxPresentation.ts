import type { InboxItem } from "@/lib/azdoCommands";
import type { AgentSubject, OpenAgentPanelDetail } from "@/components/agent/agentSubject";

export type InboxTab = "open" | "snoozed" | "done";
export type InboxPriority = "all" | "priority" | "other";

export function matchesInboxPriority(item: Pick<InboxItem, "kind">, priority: InboxPriority): boolean {
  const mention = item.kind === "pr_mention" || item.kind === "wi_mention";
  return priority === "all" || (priority === "priority" ? mention : !mention);
}

/** A row of the Inbox: a comment addressed to the user, stored by the sync. */
export type InboxEntry = InboxItem;

/** How Q opens the Agent panel for an entry: on its pull request (with the thread) or work item. */
export function agentRequestOf(entry: InboxEntry): OpenAgentPanelDetail {
  const base = {
    id: entry.subjectId,
    title: entry.title,
    organizationId: entry.organizationId,
    projectId: entry.projectId,
    webUrl: entry.webUrl,
  };
  if (isPullRequestItem(entry)) {
    return {
      subject: {
        kind: "pull-request",
        ...base,
        repositoryId: entry.repositoryId,
        repositoryName: entry.repositoryName,
        // A mention / reply is about its thread; the material puts it first.
        ...(isThreadItem(entry) && entry.threadId > 0 ? { threadId: entry.threadId } : {}),
      },
    };
  }
  if (isWorkItemItem(entry)) return { subject: { kind: "work-item", ...base } };
  return { subject: null };
}

/** What the Agent panel follows while this entry is selected: its pull request (with the thread) or work item. */
export function inboxAgentSubject(entry: InboxEntry): AgentSubject | null {
  return agentRequestOf(entry).subject ?? null;
}

// Review / Returned / Assigned are no longer created, but their finished rows
// stay in the Done list for up to 30 days.
const KIND_LABELS: Record<string, string> = {
  pr_mention: "Mention",
  pr_reply: "Reply",
  pr_review_request: "Review",
  pr_returned: "Returned",
  wi_mention: "WI mention",
  wi_assigned: "Assigned",
};

const KIND_CLASSES: Record<string, string> = {
  pr_mention: "text-amber-700 dark:text-amber-300",
  pr_reply: "text-sky-700 dark:text-sky-300",
  pr_review_request: "text-blue-700 dark:text-blue-300",
  pr_returned: "text-violet-700 dark:text-violet-300",
  wi_mention: "text-emerald-700 dark:text-emerald-300",
  wi_assigned: "text-emerald-700 dark:text-emerald-300",
};

export function inboxKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function inboxKindClass(kind: string): string {
  return KIND_CLASSES[kind] ?? "text-muted-foreground";
}

/** Whether the item belongs to a pull request (so PR commands apply). */
export function isPullRequestItem(item: Pick<InboxItem, "kind">): boolean {
  return item.kind.startsWith("pr_");
}

/** A comment on a pull request thread the user can answer in place. */
export function isThreadItem(item: Pick<InboxItem, "kind">): boolean {
  return item.kind === "pr_mention" || item.kind === "pr_reply";
}

export function isWorkItemItem(item: Pick<InboxItem, "kind">): boolean {
  return item.kind.startsWith("wi_");
}

/** `!42 api-gateway` / `#3120 Platform` — what the item is about, in one token. */
export function inboxSubjectLabel(item: InboxEntry): string {
  if (isPullRequestItem(item)) return `!${item.subjectId} ${item.repositoryName}`;
  if (isWorkItemItem(item)) return `#${item.subjectId} ${item.projectName}`;
  return item.projectName ? `${item.projectName}` : item.title;
}

/**
 * The PR / work item title for rows whose own text is a comment, so the row
 * says what the comment is about. Rows that already show the title (no
 * comment) and non-PR / WI rows have none.
 */
export function inboxRowTitle(item: InboxItem): string | null {
  if (!item.snippet || !item.title) return null;
  if (!isPullRequestItem(item) && !isWorkItemItem(item)) return null;
  return item.title === item.snippet ? null : item.title;
}

/** `refs/heads/feature/x` → `feature/x`. */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function matchesInboxFilter(item: InboxItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.title, item.author, item.snippet, item.repositoryName, item.projectName, `!${item.subjectId}`]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes(needle));
}

/** Where a link was found; the preview groups the links by it, in this order. */
export type InboxLinkOrigin = "linked" | "description" | "comment" | "attachment";

type InboxLinkBase = {
  origin: InboxLinkOrigin;
  label: string;
  /** What the link points at (a work item / pull request title), when known. */
  title?: string | null;
  /** Short extra context such as a state, a relation type or a PR status. */
  detail?: string | null;
};

export type InboxLink =
  | (InboxLinkBase & { kind: "workItem"; id: number })
  | (InboxLinkBase & { kind: "pullRequest"; id: number; repositoryId?: string | null })
  | (InboxLinkBase & { kind: "external"; url: string });

const LINK_PATTERN = /https?:\/\/[^\s<>"')\]]+|\bAB#\d+|(?<![\w/])!\d+\b/gi;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

export function shortUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const label = `${parsed.host}${path}`;
    return label.length > 48 ? `${label.slice(0, 47)}…` : label;
  } catch {
    return url;
  }
}

/**
 * Links found in texts, in order of appearance and without duplicates:
 * `AB#123` (work item), `!45` (pull request) and http(s) URLs.
 */
export function extractInboxLinks(
  texts: (string | null | undefined)[],
  origin: InboxLinkOrigin = "comment",
): InboxLink[] {
  const links: InboxLink[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(LINK_PATTERN)) {
      const raw = match[0];
      let link: InboxLink;
      if (/^AB#/i.test(raw)) {
        const id = Number(raw.slice(3));
        link = { kind: "workItem", id, label: `AB#${id}`, origin };
      } else if (raw.startsWith("!")) {
        const id = Number(raw.slice(1));
        link = { kind: "pullRequest", id, label: `!${id}`, origin };
      } else {
        const url = trimUrl(raw);
        link = { kind: "external", url, label: shortUrlLabel(url), origin };
      }
      const key =
        link.kind === "external" ? link.url : `${link.kind}:${link.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(link);
    }
  }
  return links;
}

/** `Mon 9:00`-style label for a snooze deadline. */
export function formatSnoozeUntil(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** `dashboard.ts:7` for a comment on a line of code; null for PR-wide threads and other kinds. */
export function inboxLocationLabel(item: Pick<InboxEntry, "filePath" | "line">): string | null {
  if (!item.filePath) return null;
  const name = item.filePath.split("/").filter(Boolean).pop() ?? item.filePath;
  return item.line ? `${name}:${item.line}` : name;
}
