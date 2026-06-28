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
  if (all || hot || scopeSet.has("myReviews")) {
    void queryClient.invalidateQueries({ queryKey: ["myReviews"], refetchType });
  }
  if (all || hot || scopeSet.has("myWorkItems")) {
    void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot(), refetchType });
    invalidateWorkItemQueryViews(queryClient, undefined, refetchType);
    void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot(), refetchType });
  }
  if (all || scopeSet.has("commits")) {
    void queryClient.invalidateQueries({ queryKey: ["commitRepositories"], refetchType });
  }
}

export function invalidationScopesForSyncScope(scope: SyncScope = "all"): SyncScope[] {
  return scope === "hot" ? ["myReviews", "myWorkItems"] : [scope];
}

export function parsePaletteSearch(text: string): { kind: PaletteSearchKind | null; query: string } {
  // `code`/`co` must precede `c` in the alternation so they win over commits.
  const match = /^(wi|pr|code|co|c):\s*(.*)$/i.exec(text.trim());
  if (match) {
    const prefix = match[1].toLowerCase();
    const kind: PaletteSearchKind =
      prefix === "wi"
        ? "workItems"
        : prefix === "pr"
          ? "pullRequests"
          : prefix === "code" || prefix === "co"
            ? "code"
            : "commits";
    return { kind, query: match[2].trim() };
  }
  return { kind: null, query: text.trim() };
}

export function commitFirstLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
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
