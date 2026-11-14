import { agentWorkKey, type AgentWorkEntry } from "@/lib/azdoCommands";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

// Results opened in Agent Work count as read. Kept in this browser only: being
// read is a view preference. A newer run of the same item is unread again.
const STORAGE_KEY = "azdodeck:agentWork:seen";
const REMEMBERED = 500;

export function seenKey(entry: AgentWorkEntry): string {
  return `${agentWorkKey(entry)}@${entry.finishedAt ?? ""}`;
}

export function loadSeen(): string[] {
  return readStoredJson<string[]>(
    STORAGE_KEY,
    (raw) => (Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : undefined),
    [],
  );
}

export function addSeen(current: string[], entry: AgentWorkEntry): string[] {
  const key = seenKey(entry);
  if (current.includes(key)) return current;
  const next = [...current, key].slice(-REMEMBERED);
  writeStoredJson(STORAGE_KEY, next);
  return next;
}
