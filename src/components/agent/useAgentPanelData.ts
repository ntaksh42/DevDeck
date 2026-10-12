import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentNote,
  deleteAgentNote,
  restoreAgentNote,
  setAgentNoteStatus,
  submitAgentNoteDrafts,
  getAppSettings,
  listAgentAsks,
  listAgentNotes,
  replyAgentNote,
  runAgent,
  type AgentNote,
  type AgentNoteItem,
  type AgentNoteKind,
} from "@/lib/azdoCommands";
import { agentNoteSummariesKey } from "@/components/agent-notes/useAgentNoteSummaries";
import { contextLine, noteItemOf, type AgentQuote, type AgentSubject } from "./agentSubject";
import { buildContextDocument } from "./contextDocument";

export const AGENT_ASKS_KEY = ["agentAsks"];

export type Conversation = {
  key: string;
  note: AgentNote;
  item: AgentNoteItem;
  section: "item" | "ask";
};

export type SendInput = {
  body: string;
  kind: AgentNoteKind;
  replyTo: Conversation | null;
  /** Result text the new note is about (subject item notes only). */
  quote?: AgentQuote | null;
};

/** A new request's id: its local timestamp, `yyyyMMddHHmmss`. */
function newAskId(): number {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number(
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  );
}

/** Conversations for the Agent panel and the action that sends to the agent. */
export function useAgentPanelData(subject: AgentSubject | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const item = noteItemOf(subject);
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings, staleTime: 5 * 60_000 });
  const readOnly = settingsQuery.data?.readOnlyValidationModeEnabled ?? false;

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
    ...(asksQuery.data ?? []).flatMap((ask) =>
      ask.notes.map((note) => ({
        key: `ask:${ask.itemId}:${note.id}`,
        note,
        item: { target: "ask" as const, itemId: ask.itemId },
        section: "ask" as const,
      })),
    ),
  ];

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
      await runAgent({ ...item, repositoryName: subject?.kind === "pull-request" ? subject.repositoryName : null });
    },
  });

  const send = useMutation({
    mutationFn: async ({ body, kind, replyTo, quote }: SendInput) => {
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
          kind: kind === "fix" ? null : kind,
          quote: quoted?.quote ?? null,
          quotePrefix: quoted?.prefix ?? null,
          quoteSuffix: quoted?.suffix ?? null,
          quoteOffset: quoted?.offset ?? null,
          resultFile: quoted?.resultFile ?? null,
          resultHash: quoted?.resultHash ?? null,
          context: subject ? contextLine(subject) : null,
          contextDocument: subject ? await buildContextDocument(subject) : null,
        });
      }
      refresh(target);
      if (readOnly) return;
      await runAgent({
        ...target,
        repositoryName: subject?.kind === "pull-request" && target.target === "pull-request" ? subject.repositoryName : null,
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
  };
}
