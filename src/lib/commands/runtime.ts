import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isTauriRuntime } from "@/lib/runtime";
import { demoInvoke } from "@/lib/azdoDemo";

export async function invokeCommand(command: string, args?: unknown): Promise<unknown> {
  if (isTauriRuntime()) {
    return invoke(command, args as Record<string, unknown> | undefined);
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
