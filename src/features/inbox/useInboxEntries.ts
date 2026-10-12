import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getActionInboxCounts,
  getActiveOrganization,
  listActionInboxItems,
  listPipelineApprovals,
  listPipelineProjects,
  summarizeAgentNotes,
  type AgentNoteSummary,
  type AgentNoteTarget,
  type PipelineApprovalSummary,
} from "@/lib/azdoCommands";
import {
  agentNoteSummariesKey,
  useSummaries as useAgentNoteSummaries,
} from "@/components/agent-notes/useAgentNoteSummaries";
import { matchesInboxFilter, type InboxEntry, type InboxTab } from "./inboxPresentation";
import { useInboxAgentEntries } from "./useInboxAgentEntries";

/** Approvals are project-scoped, so cap how many projects one refresh asks. */
const MAX_APPROVAL_PROJECTS = 20;
const APPROVAL_REFRESH_MS = 60_000;

/** Stable negative id: derived entries never collide with stored (positive) ids. */
function derivedId(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return -(Math.abs(hash) + 1);
}

function approvalEntry(
  organizationId: string,
  project: { id: string; name: string },
  approval: PipelineApprovalSummary,
): InboxEntry {
  const instructions = approval.instructions?.trim() || null;
  return {
    // Approval ids are only unique per project; the key must not repeat.
    id: derivedId(`${project.id}:${approval.id}`),
    organizationId,
    kind: "pipeline_approval",
    subjectId: 0,
    projectId: project.id,
    projectName: project.name,
    repositoryId: "",
    repositoryName: "",
    threadId: 0,
    commentId: 0,
    title: instructions ?? "Pipeline approval",
    author: null,
    snippet: instructions ?? `Approval required in ${project.name}`,
    webUrl: null,
    state: "open",
    snoozedUntil: null,
    detectedAt: approval.createdOn ?? new Date().toISOString(),
    doneAt: null,
    extra: { approvalId: approval.id },
  };
}

function agentEntry(
  organizationId: string,
  target: AgentNoteTarget,
  summary: AgentNoteSummary,
): InboxEntry {
  const label =
    target === "pull-request"
      ? `PR !${summary.itemId}`
      : target === "ask"
        ? "Agent request"
        : `Work item #${summary.itemId}`;
  return {
    id: derivedId(`agent:${target}:${summary.itemId}`),
    organizationId,
    kind: "agent_reply",
    subjectId: summary.itemId,
    projectId: "",
    projectName: "",
    repositoryId: "",
    repositoryName: "",
    threadId: 0,
    commentId: 0,
    title: label,
    author: "agent",
    snippet: `${summary.needsYou} note${summary.needsYou === 1 ? "" : "s"} waiting for your answer`,
    webUrl: null,
    state: "open",
    snoozedUntil: null,
    detectedAt: summary.lastAgentReplyAt ?? summary.lastModifiedAt ?? new Date().toISOString(),
    doneAt: null,
    extra: { agentTarget: target },
  };
}

/**
 * Pipeline approvals waiting for the user, fetched live (they are not part of
 * the sync cache). The Inbox view and the sidebar badge share this query key,
 * so the shortest `refetchMs` of the mounted observers wins.
 */
export function useInboxApprovals(
  organizationId: string,
  { enabled, refetchMs }: { enabled: boolean; refetchMs: number },
) {
  return useQuery({
    queryKey: ["inboxApprovals", organizationId],
    queryFn: async (): Promise<InboxEntry[]> => {
      const projects = (await listPipelineProjects({ organizationId })).slice(
        0,
        MAX_APPROVAL_PROJECTS,
      );
      const perProject = await Promise.all(
        projects.map(async (project) => {
          try {
            const approvals = await listPipelineApprovals({
              organizationId,
              projectId: project.id,
            });
            return approvals
              .filter((approval) => approval.status === "pending")
              .map((approval) => approvalEntry(organizationId, project, approval));
          } catch {
            // One unreachable project must not hide the others' approvals.
            return [];
          }
        }),
      );
      // The id is a hash of project + approval; keep one row per id so a
      // collision can never produce duplicate React keys.
      const unique = new Map<number, InboxEntry>();
      for (const entry of perProject.flat()) unique.set(entry.id, entry);
      return [...unique.values()];
    },
    enabled: enabled && organizationId !== "",
    staleTime: 30_000,
    refetchInterval: refetchMs,
    retry: false,
  });
}

/** Without the Inbox open the approvals only feed the badge, so poll slowly. */
const BADGE_APPROVAL_REFRESH_MS = 5 * 60_000;

/**
 * Sidebar badge: the number of rows the Inbox tab lists (stored items, pending
 * approvals and agent replies waiting for the user), so the two never disagree.
 */
export function useInboxBadge({
  organizationId,
  pipelinesSupported,
}: {
  organizationId: string;
  pipelinesSupported: boolean;
}): number | null {
  const counts = useQuery({
    queryKey: ["actionInbox", "counts"],
    queryFn: () => getActionInboxCounts(),
    staleTime: 30_000,
  });
  const approvals = useInboxApprovals(organizationId, {
    enabled: pipelinesSupported,
    refetchMs: BADGE_APPROVAL_REFRESH_MS,
  });
  const pullRequestSummaries = useAgentNoteSummaries("pull-request");
  const workItemSummaries = useAgentNoteSummaries("work-item");
  const askSummaries = useAgentNoteSummaries("ask");
  if (!counts.data) return null;
  const agentReplies = [pullRequestSummaries.data, workItemSummaries.data, askSummaries.data]
    .flatMap((summaries) => summaries ?? [])
    .filter((summary) => summary.needsYou > 0).length;
  return counts.data.open + (approvals.data?.length ?? 0) + agentReplies;
}

/**
 * The rows of the Inbox for one tab: the stored items from the backend plus,
 * on the open tab, the pipeline approvals waiting for the user (fetched live,
 * since approvals are not part of the sync cache).
 */
export function useInboxEntries({
  tab,
  organizationId,
  filterText,
}: {
  tab: InboxTab;
  organizationId: string;
  filterText: string;
}) {
  const listQuery = useQuery({
    queryKey: ["actionInbox", "list", tab, organizationId],
    queryFn: () =>
      listActionInboxItems({ state: tab, organizationId: organizationId || undefined }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const activeOrganizationQuery = useQuery({
    queryKey: ["activeOrganization"],
    queryFn: getActiveOrganization,
    staleTime: 5 * 60_000,
    enabled: tab === "open",
  });
  const approvalOrganizationId = organizationId || activeOrganizationQuery.data?.id || "";

  const approvalsQuery = useInboxApprovals(approvalOrganizationId, {
    enabled: tab === "open",
    refetchMs: APPROVAL_REFRESH_MS,
  });

  // Agent replies waiting for the user. These share the per-target summary
  // queries the app-wide watcher polls, so no extra scan is made.
  const pullRequestSummaries = useQuery({
    queryKey: agentNoteSummariesKey("pull-request"),
    queryFn: () => summarizeAgentNotes({ target: "pull-request" }),
    refetchInterval: 5_000,
    retry: false,
    enabled: tab === "open",
  });
  const workItemSummaries = useQuery({
    queryKey: agentNoteSummariesKey("work-item"),
    queryFn: () => summarizeAgentNotes({ target: "work-item" }),
    refetchInterval: 5_000,
    retry: false,
    enabled: tab === "open",
  });
  const askSummaries = useQuery({
    queryKey: agentNoteSummariesKey("ask"),
    queryFn: () => summarizeAgentNotes({ target: "ask" }),
    refetchInterval: 5_000,
    retry: false,
    enabled: tab === "open",
  });
  const agentSummaries = useMemo<InboxEntry[]>(() => {
    const organization = organizationId || activeOrganizationQuery.data?.id || "";
    const build = (target: AgentNoteTarget, data: AgentNoteSummary[] | undefined) =>
      (data ?? [])
        .filter((summary) => summary.needsYou > 0)
        .map((summary) => agentEntry(organization, target, summary));
    return [
      ...build("pull-request", pullRequestSummaries.data),
      ...build("work-item", workItemSummaries.data),
      ...build("ask", askSummaries.data),
    ];
  }, [
    organizationId,
    activeOrganizationQuery.data?.id,
    pullRequestSummaries.data,
    workItemSummaries.data,
    askSummaries.data,
  ]);
  const agentEntries = useInboxAgentEntries(tab === "open" ? agentSummaries : [], organizationId);

  const entries = useMemo(() => {
    const stored: InboxEntry[] = listQuery.data ?? [];
    const derived = tab === "open" ? [...(approvalsQuery.data ?? []), ...agentEntries] : [];
    const merged = [...stored, ...derived].filter((entry) =>
      matchesInboxFilter(entry, filterText),
    );
    // The backend already orders the snoozed (by deadline) and done (by finish
    // time) tabs; only the open tab mixes in derived entries by recency.
    if (tab === "open") {
      merged.sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt) || b.id - a.id);
    }
    return merged;
  }, [listQuery.data, approvalsQuery.data, agentEntries, tab, filterText]);

  return {
    entries,
    derivedCount: tab === "open" ? (approvalsQuery.data?.length ?? 0) + agentEntries.length : 0,
    isLoading: listQuery.isLoading,
    error: listQuery.isError ? listQuery.error : null,
    refetch: () => void listQuery.refetch(),
  };
}
