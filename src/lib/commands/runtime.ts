import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isTauriRuntime } from "@/lib/runtime";
import { demoInvoke } from "@/lib/azdoDemo";

export async function invokeCommand(command: string, args?: unknown): Promise<unknown> {
  if (isTauriRuntime()) {
    const request = invoke(command, args as Record<string, unknown> | undefined);
    // Bound the IPC wait too: an unresponsive backend must not leave queries
    // permanently fetching. Only read operations are safe to retry this way.
    if (!["run_work_item_query", "count_work_item_query", "list_work_item_projects"].includes(command)) {
      return request;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            "Work item query timed out. Please retry.",
          )), 125_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return demoInvoke(command, args);
}

export function commandErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof z.ZodError) {
    return "Received an unexpected response format from the server.";
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unexpected error";
}

// Shared schemas used by multiple domain modules.

export const mentionCandidateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  uniqueName: z.string().nullable(),
});

export const mentionCandidatesSchema = z.array(mentionCandidateSchema);

export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

export const prFileDiffSchema = z.object({
  filePath: z.string(),
  baseContent: z.string().nullable(),
  targetContent: z.string().nullable(),
  baseUnavailableReason: z.string().nullable(),
  targetUnavailableReason: z.string().nullable(),
});

export type PrFileDiff = z.infer<typeof prFileDiffSchema>;
