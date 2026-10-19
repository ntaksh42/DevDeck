import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentNote,
  deleteAgentNote,
  restoreAgentNote,
  setAgentNoteStatus,
  submitAgentNoteDrafts,
  getAppSettings,
  noteNeedsYou,
  listAgentAsks,
  listAgentNotes,
  replyAgentNote,
  runAgent,
  type AgentKind,
  type AgentNote,
  type AgentNoteItem,
} from "@/lib/azdoCommands";
import { agentNoteSummariesKey } from "@/components/agent-notes/useAgentNoteSummaries";
import type { AgentListScope } from "./agentListScope";
import { contextIsAbout, contextLine, noteItemOf, type AgentQuote, type AgentSubject } from "./agentSubject";
import { buildContextDocument } from "./contextDocument";
import { modelChoices, settingsModel } from "./agentModels";

export const AGENT_ASKS_KEY = ["agentAsks"];

export type Conversation = {
  key: string;
  note: AgentNote;
  item: AgentNoteItem;
  section: "item" | "ask";
};

export type SendInput = {
  body: string;
  replyTo: Conversation | null;
  /** Result text the new note is about (subject item notes only). */
  quote?: AgentQuote | null;
};

/** List order: waiting for the user first, then open, then done; newest first within each. */
const urgency = (note: AgentNote) => (noteNeedsYou(note) ? 0 : note.status === "done" ? 2 : 1);
const activityTime = (note: AgentNote) => Date.parse(note.replies[note.replies.length - 1]?.createdAt ?? note.createdAt) || 0;

/** A new request's id: its local timestamp, `yyyyMMddHHmmss`. */
function newAskId(): number {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number(
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  );
}

/** Agent and model picked in the panel; null follows Settings. */
export type AgentChoice = { agent: AgentKind | null; model: string | null };

/**
 * Conversations for the Agent panel and the action that sends to the agent.
 * `choice` overrides the agent and model chosen in Settings for what this
 * panel starts.
 */
export function useAgentPanelData(
  subject: AgentSubject | null,
  enabled: boolean,
  list: AgentListScope | null = null,
  choice: AgentChoice = { agent: null, model: null },
) {
  const queryClient = useQueryClient();
  const item = noteItemOf(subject);
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings, staleTime: 5 * 60_000 });
  const readOnly = settingsQuery.data?.readOnlyValidationModeEnabled ?? false;
  const defaultAgent: AgentKind = settingsQuery.data?.defaultAgent === "codex" ? "codex" : "claude";
  const runWith = choice.agent ?? defaultAgent;
  const model = choice.model ?? settingsModel(settingsQuery.data, runWith);

  const itemNotesQuery = useQuery({
    queryKey: ["agentNotes", item?.target, item?.itemId],
    queryFn: () => listAgentNotes(item!),
    enabled: enabled && !!item,
    refetchInterval: 60_000,
  });
  const asksQuery = useQuery({
    queryKey: AGENT_ASKS_KEY,
    queryFn: listAgentAsks,
    enabled,
    refetchInterval: 5_000,
  });

  const conversations: Conversation[] = [
    // Drafts (left in the Result panel by older versions) stay visible until sent.
    ...(item ? (itemNotesQuery.data ?? []) : [])
      .map((note) => ({ key: `${item!.target}:${item!.itemId}:${note.id}`, note, item: item!, section: "item" as const })),
    // Requests (anything but a PR / work item) show only while their subject is the current one.
    ...(item ? [] : (asksQuery.data ?? [])).flatMap((ask) =>
      ask.notes.filter((note) => contextIsAbout(note.context, subject)).map((note) => ({
        key: `ask:${ask.itemId}:${note.id}`,
        note,
        item: { target: "ask" as const, itemId: ask.itemId },
        section: "ask" as const,
      })),
    ),
  ].sort((a, b) => urgency(a.note) - urgency(b.note) || activityTime(b.note) - activityTime(a.note));

  const refresh = (target: AgentNoteItem) => {
    void queryClient.invalidateQueries({ queryKey: ["agentNotes", target.target, target.itemId] });
    void queryClient.invalidateQueries({ queryKey: agentNoteSummariesKey(target.target) });
    void queryClient.invalidateQueries({ queryKey: AGENT_ASKS_KEY });
  };

  const setStatus = useMutation({
    mutationFn: async (c: Conversation) => {
      await setAgentNoteStatus({ ...c.item, noteId: c.note.id, status: c.note.status === "done" ? "open" : "done" });
      refresh(c.item);
    },
  });
  // Delete moves the file to the trash; the last delete can be undone.
  const [deleted, setDeleted] = useState<Conversation | null>(null);
  const remove = useMutation({
    mutationFn: async (c: Conversation) => {
      await deleteAgentNote({ ...c.item, noteId: c.note.id });
      setDeleted(c);
      refresh(c.item);
    },
  });
  const undoDelete = useMutation({
    mutationFn: async () => {
      if (!deleted) return;
      await restoreAgentNote({
        ...deleted.item,
        noteId: deleted.note.id,
        status: deleted.note.status === "draft" ? "draft" : "open",
      });
      setDeleted(null);
      refresh(deleted.item);
    },
  });
  const submitDrafts = useMutation({
    mutationFn: async () => {
      if (!item) return;
      await submitAgentNoteDrafts(item);
      refresh(item);
      if (readOnly) return;
      await runAgent({ ...item, repositoryName: subject?.kind === "pull-request" ? subject.repositoryName : null, agent: runWith, model });
    },
  });

  const send = useMutation({
    mutationFn: async ({ body, replyTo, quote }: SendInput) => {
      let target: AgentNoteItem;
      if (replyTo) {
        target = replyTo.item;
        await replyAgentNote({ ...target, noteId: replyTo.note.id, body });
      } else {
        target = item ?? { target: "ask", itemId: newAskId() };
        const quoted = target.target !== "ask" && quote ? quote : null;
        await createAgentNote({
          ...target,
          body,
          // No kind: the agent judges from the text (see the notes guide).
          kind: null,
          quote: quoted?.quote ?? null,
          quotePrefix: quoted?.prefix ?? null,
          quoteSuffix: quoted?.suffix ?? null,
          quoteOffset: quoted?.offset ?? null,
          resultFile: quoted?.resultFile ?? null,
          resultHash: quoted?.resultHash ?? null,
          context: subject || list ? contextLine(subject, list) : null,
          contextDocument: subject || list ? await buildContextDocument(subject, list) : null,
        });
      }
      refresh(target);
      if (readOnly) return;
      await runAgent({
        ...target,
        repositoryName: subject?.kind === "pull-request" && target.target === "pull-request" ? subject.repositoryName : null,
        agent: runWith,
        model,
      });
    },
  });

  // Starts the agent on notes already written (e.g. quoted notes left in a
  // Result panel) without adding a new one.
  const runNow = useMutation({
    mutationFn: (target: AgentNoteItem) =>
      runAgent({
        ...target,
        repositoryName: subject?.kind === "pull-request" && target.target === "pull-request" ? subject.repositoryName : null,
        agent: runWith,
        model,
      }),
  });

  return {
    conversations,
    runNow,
    setStatus,
    remove,
    deleted,
    undoDelete,
    submitDrafts,
    loading: itemNotesQuery.isLoading || asksQuery.isLoading,
    error:
      itemNotesQuery.error ?? asksQuery.error ?? setStatus.error ?? remove.error ?? undoDelete.error ?? submitDrafts.error ?? null,
    send,
    readOnly,
    autoPost: settingsQuery.data?.agentAutoPostEnabled ?? false,
    defaultAgent,
    agent: runWith,
    model,
    modelChoices: modelChoices(settingsQuery.data, runWith),
  };
}
