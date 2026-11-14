import type { AutoQueueItem, AutoQueuePreview, AutoQueueTarget } from "@/lib/azdoCommands";
import { autoQueueKey } from "@/lib/azdoCommands";
import { demoExcludedKeys } from "@/lib/demo/agentWork";

// In-memory Auto queue for browser demo mode. Running only drops the picked
// items from the list: there is no agent to start in the browser.

function item(
  target: AutoQueueItem["target"],
  id: number,
  title: string,
  scope: string,
  createdDate: string,
): AutoQueueItem {
  return {
    organizationId: "demo-org",
    organizationName: "contoso",
    target,
    id,
    title,
    scope,
    scopeId: scope,
    webUrl: null,
    createdDate,
  };
}

let queue: AutoQueueItem[] = [
  item("pull-request", 4821, "Retry token refresh on 401", "auth-service", "2026-11-05T09:00:00Z"),
  item("pull-request", 4833, "Make report export asynchronous", "report-service", "2026-11-05T13:30:00Z"),
  item("pull-request", 4790, "Update all dependencies", "web-app", "2026-11-02T08:15:00Z"),
  item("work-item", 10231, "White screen after login", "Contoso", "2026-11-06T10:00:00Z"),
  item("work-item", 9120, "Retire the legacy API", "Contoso", "2026-10-28T16:45:00Z"),
];

export function demoListAutoQueue(): AutoQueueItem[] {
  const excluded = demoExcludedKeys();
  return queue.filter((entry) => !excluded.has(autoQueueKey(entry))).map((entry) => ({ ...entry }));
}

export function demoAutoQueuePreview(target: AutoQueueTarget): AutoQueuePreview {
  const entry = queue.find((candidate) => autoQueueKey(candidate) === autoQueueKey(target));
  if (!entry) {
    return { document: "", chars: 0, estimatedTokens: 0, unavailable: "The item is no longer in the synced data." };
  }
  const document =
    entry.target === "pull-request"
      ? [
          `# Pull request !${entry.id} ${entry.title}`,
          `Repository: ${entry.scope}`,
          "",
          "## Changes",
          "",
          "### edit src/report/export.ts",
          "Before:",
          "```",
          "const rows = buildRows(data);\nwriteFile(path, rows);",
          "```",
          "After:",
          "```",
          "const rows = await buildRowsAsync(data);\nawait queue.enqueue(() => writeFile(path, rows));",
          "```",
        ].join("\n")
      : [`# Work item #${entry.id} ${entry.title}`, `Project: ${entry.scope}`, "", "## Description", "(demo)"].join(
          "\n",
        );
  const chars = document.length * (entry.target === "pull-request" ? 40 : 6);
  return { document, chars, estimatedTokens: Math.round(chars / 3), unavailable: null };
}

export function demoRunAssignedWorkItems(): number {
  const before = queue.length;
  queue = queue.filter((entry) => entry.target !== "work-item");
  return before - queue.length;
}

export function demoRunAutoQueue(targets: AutoQueueTarget[]): number {
  const picked = new Set(targets.map(autoQueueKey));
  queue = queue.filter((entry) => !picked.has(autoQueueKey(entry)));
  return picked.size;
}
