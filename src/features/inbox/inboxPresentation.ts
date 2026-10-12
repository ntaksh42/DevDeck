import type { AgentNoteTarget, InboxItem } from "@/lib/azdoCommands";
import type { AgentSubject, OpenAgentPanelDetail } from "@/components/agent/agentSubject";

export type InboxTab = "open" | "snoozed" | "done";

/**
 * A row of the Inbox. Stored items come from the backend as they are;
 * entries the view derives from live data (pipeline approvals) carry what they
 * need in `extra` and have no local state to change.
 */
export type InboxEntry = InboxItem & {
  extra?: { approvalId?: string; agentTarget?: AgentNoteTarget };
};

/**
 * How Q opens the Agent panel for an entry: on its pull request / work item,
 * or, for an agent reply, on the conversation waiting for an answer.
 */
export function agentRequestOf(entry: InboxEntry): OpenAgentPanelDetail {
  const target = entry.extra?.agentTarget;
  const reply = target !== undefined;
  if (target === "ask") return { subject: null, askId: entry.subjectId, reply };
  const base = {
    id: entry.subjectId,
    // Unresolved agent summaries have only a label, not the subject's title.
    title: reply && !entry.webUrl ? "" : entry.title,
    organizationId: entry.organizationId,
    projectId: entry.projectId,
    webUrl: entry.webUrl,
  };
  if (target === "pull-request" || (!target && entry.kind.startsWith("pr_"))) {
    return {
      subject: {
        kind: "pull-request",
        ...base,
        repositoryId: entry.repositoryId,
        repositoryName: entry.repositoryName,
        // A mention / reply is about its thread; the material puts it first.
        ...(!target && isThreadItem(entry) && entry.threadId > 0 ? { threadId: entry.threadId } : {}),
      },
      reply,
    };
  }
  if (target === "work-item" || (!target && entry.kind.startsWith("wi_"))) {
    return { subject: { kind: "work-item", ...base }, reply };
  }
  return { subject: null };
}

/**
 * What the Agent panel follows while this entry is selected: its pull request
 * (with the target thread) or work item. Pipeline approvals carry no run id
 * and an agent request has no item, so those have none.
 */
export function inboxAgentSubject(entry: InboxEntry): AgentSubject | null {
  return agentRequestOf(entry).subject ?? null;
}

/** Derived entries cannot be finished or snoozed; acting on them removes them. */
export function isDerivedEntry(item: InboxEntry): boolean {
  return item.extra !== undefined;
}

const KIND_LABELS: Record<string, string> = {
  pr_mention: "Mention",
  pr_reply: "Reply",
  pr_review_request: "Review",
  pr_returned: "Returned",
  wi_mention: "WI mention",
  wi_assigned: "Assigned",
  pipeline_approval: "Approval",
  agent_reply: "Agent",
};

const KIND_CLASSES: Record<string, string> = {
  pr_mention: "text-amber-700 dark:text-amber-300",
  pr_reply: "text-sky-700 dark:text-sky-300",
  pr_review_request: "text-blue-700 dark:text-blue-300",
  pr_returned: "text-violet-700 dark:text-violet-300",
  wi_mention: "text-emerald-700 dark:text-emerald-300",
  wi_assigned: "text-emerald-700 dark:text-emerald-300",
  pipeline_approval: "text-red-700 dark:text-red-300",
  agent_reply: "text-violet-700 dark:text-violet-300",
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

/** A pull request that waits for the user's vote. */
export function isVoteItem(item: Pick<InboxItem, "kind">): boolean {
  return item.kind === "pr_review_request" || item.kind === "pr_returned";
}

export function isWorkItemItem(item: Pick<InboxItem, "kind">): boolean {
  return item.kind.startsWith("wi_");
}

/** `!42 api-gateway` / `#3120 Platform` — what the item is about, in one token. */
export function inboxSubjectLabel(item: InboxEntry): string {
  if (item.extra?.agentTarget === "pull-request") return `!${item.subjectId} ${item.repositoryName}`.trim();
  if (item.extra?.agentTarget === "work-item") return `#${item.subjectId} ${item.projectName}`.trim();
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

export type InboxLink =
  | { kind: "workItem"; id: number; label: string }
  | { kind: "pullRequest"; id: number; label: string }
  | { kind: "external"; url: string; label: string };

const LINK_PATTERN = /https?:\/\/[^\s<>"')\]]+|\bAB#\d+|(?<![\w/])!\d+\b/gi;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

function shortUrlLabel(url: string): string {
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
 * Links found in comment texts, in order of appearance and without duplicates:
 * `AB#123` (work item), `!45` (pull request) and http(s) URLs.
 */
export function extractInboxLinks(texts: (string | null | undefined)[]): InboxLink[] {
  const links: InboxLink[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(LINK_PATTERN)) {
      const raw = match[0];
      let link: InboxLink;
      if (/^AB#/i.test(raw)) {
        const id = Number(raw.slice(3));
        link = { kind: "workItem", id, label: `AB#${id}` };
      } else if (raw.startsWith("!")) {
        const id = Number(raw.slice(1));
        link = { kind: "pullRequest", id, label: `!${id}` };
      } else {
        const url = trimUrl(raw);
        link = { kind: "external", url, label: shortUrlLabel(url) };
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
