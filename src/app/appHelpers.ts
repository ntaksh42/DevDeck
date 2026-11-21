import type { QueryClient } from "@tanstack/react-query";
import type { SyncScope } from "@/lib/azdoCommands";
import { invalidateWorkItemQueryViews, workItemQueryKeys } from "@/features/work-items/queryKeys";
import { normalizeKey, type KeybindingMap } from "@/lib/keybindings";
import { GOTO_BINDING_VIEWS } from "./types";
import type { View, PaletteSearchKind } from "./types";

export function invalidateSyncedDataQueries(
  queryClient: QueryClient,
  scopes: SyncScope[] = ["all"],
): void {
  // While the window is hidden, mark queries stale without refetching; they
  // refetch automatically when the window regains focus.
  const refetchType =
    document.visibilityState === "hidden" ? ("none" as const) : ("active" as const);
  void queryClient.invalidateQueries({ queryKey: ["syncStates"], refetchType });
  const scopeSet = new Set(scopes);
  const all = scopeSet.has("all");
  const hot = scopeSet.has("hot");
  // The sync revives snoozes that ran out; the grids also hide rows by this
  // list, so a stale copy would keep a revived item hidden.
  if (all || hot || scopeSet.has("myReviews") || scopeSet.has("myWorkItems")) {
    void queryClient.invalidateQueries({ queryKey: ["snoozedItems"], refetchType });
    // An Inbox item whose snooze ran out counts as open again at read time;
    // nothing else announces it, so re-read the Inbox with each sync.
    void queryClient.invalidateQueries({ queryKey: ["actionInbox"], refetchType });
  }
  if (all || hot || scopeSet.has("myReviews")) {
    void queryClient.invalidateQueries({ queryKey: ["myReviews"], refetchType });
    // The same PR sync fills the cache My Pull Requests reads.
    void queryClient.invalidateQueries({ queryKey: ["myCreatedPullRequests"], refetchType });
  }
  if (all || hot || scopeSet.has("myWorkItems")) {
    void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot(), refetchType });
    invalidateWorkItemQueryViews(queryClient, undefined, refetchType);
    void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot(), refetchType });
  }
}

export function invalidationScopesForSyncScope(scope: SyncScope = "all"): SyncScope[] {
  return scope === "hot" ? ["myReviews", "myWorkItems"] : [scope];
}

export function parsePaletteSearch(text: string): { kind: PaletteSearchKind | null; query: string } {
  // `wiki` must precede `wi` in the alternation so the longer prefix wins.
  const match = /^(wiki|wi|pr|inbox):\s*(.*)$/i.exec(text.trim());
  if (match) {
    const prefix = match[1].toLowerCase();
    const kind: PaletteSearchKind =
      prefix === "wi"
        ? "workItems"
        : prefix === "wiki"
          ? "wiki"
          : prefix === "inbox"
            ? "inbox"
            : "pullRequests";
    return { kind, query: match[2].trim().replace(/^#(?=\d+$)/, "") };
  }
  return { kind: null, query: text.trim().replace(/^#(?=\d+$)/, "") };
}

// Resolves the second-key -> view lookup for the goto chain from the current
// keybinding map (normalized to upper-case single keys).
export function gotoViewMapFromKeybindings(keybindings: KeybindingMap): Record<string, View> {
  const map: Record<string, View> = {};
  for (const [id, view] of Object.entries(GOTO_BINDING_VIEWS) as [
    keyof typeof GOTO_BINDING_VIEWS,
    View,
  ][]) {
    const key = normalizeKey(keybindings[id]);
    if (key) map[key] = view;
  }
  return map;
}

export function dispatchWorkItemCommand(command: string): void {
  window.dispatchEvent(new CustomEvent(`azdodeck:work-items:${command}`));
}
