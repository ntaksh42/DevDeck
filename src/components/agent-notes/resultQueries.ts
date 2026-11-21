import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAppSettings,
  getReviewResultPreview,
  getWorkItemResultPreview,
  listAgentNotes,
} from "@/lib/azdoCommands";

// Shared query options for the Result panels, so the panels and
// `useHasResult` (which folds an empty Result panel) read the same cache.

export const appSettingsQuery = {
  queryKey: ["appSettings"],
  queryFn: getAppSettings,
  staleTime: 5 * 60_000,
} as const;

export function reviewResultQuery(pullRequestId: number) {
  return {
    queryKey: ["reviewResultPreview", pullRequestId],
    queryFn: () => getReviewResultPreview({ pullRequestId }),
  } as const;
}

export function workItemResultQuery(workItemId: number, hasFolder: boolean) {
  return {
    queryKey: ["workItemResultPreview", workItemId],
    queryFn: () => getWorkItemResultPreview({ workItemId }),
    enabled: hasFolder,
  } as const;
}

export function pipelineResultQuery(askId: number, status: string) {
  return {
    queryKey: ["agentWorkPipelineResult", askId, status],
    queryFn: () => listAgentNotes({ target: "ask", itemId: askId }),
    refetchInterval: status === "running" || status === "waiting" ? 5_000 : false,
  } as const;
}

export type ResultSubject =
  | { target: "pull-request"; itemId: number }
  | { target: "work-item"; itemId: number }
  | { target: "pipeline"; askId: number | null; status: string }
  | null;

/**
 * Whether the subject has something to show in its Result panel (a matched
 * result HTML, or an agent reply for a pipeline). While the next subject's
 * result is still loading the previous answer is kept, so moving between rows
 * does not fold and unfold the panel.
 */
export function useHasResult(subject: ResultSubject): boolean {
  const prId = subject?.target === "pull-request" ? subject.itemId : 0;
  const wiId = subject?.target === "work-item" ? subject.itemId : 0;
  const askId = subject?.target === "pipeline" ? subject.askId ?? 0 : 0;
  const status = subject?.target === "pipeline" ? subject.status : "";

  const settings = useQuery({ ...appSettingsQuery, enabled: !!subject && subject.target !== "pipeline" });
  const pr = useQuery({ ...reviewResultQuery(prId), enabled: prId > 0 });
  const wiFolder = !!settings.data?.workItemResultFolderPath;
  const wi = useQuery({ ...workItemResultQuery(wiId, wiFolder), enabled: wiId > 0 && wiFolder });
  const pipeline = useQuery({ ...pipelineResultQuery(askId, status), enabled: askId > 0 });

  const last = useRef(false);
  let next: boolean | null;
  if (!subject) next = false;
  else if (subject.target === "pull-request") {
    if (settings.isPending) next = null;
    else if (!settings.data?.reviewResultFolderPath) next = false;
    else next = pr.isPending ? null : pr.isError || !!pr.data;
  } else if (subject.target === "work-item") {
    if (settings.isPending) next = null;
    else if (!wiFolder) next = false;
    else next = wi.isPending ? null : wi.isError || !!wi.data;
  } else if (!subject.askId) next = false;
  else next = pipeline.isPending ? null : pipeline.isError || (pipeline.data ?? []).some((note) => note.replies.length > 0);

  if (next !== null) last.current = next;
  return last.current;
}
