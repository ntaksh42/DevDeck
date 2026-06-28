import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { syncUpdatedEventSchema, triggerSync, type SyncScope } from "@/lib/azdoCommands";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import { invalidateSyncedDataQueries, invalidationScopesForSyncScope } from "./appHelpers";
import { HOT_SYNC_FOCUS_MIN_INTERVAL_MS } from "./types";
import type { View } from "./types";

function currentViewSyncScope(activeView: View): SyncScope {
  if (activeView === "commits") return "commits";
  if (
    activeView === "workItems" ||
    activeView === "myWorkItems" ||
    activeView === "workItemViews"
  ) {
    return "myWorkItems";
  }
  if (activeView === "settings") return "all";
  return "myReviews";
}

export function useSyncManager(organizationsLength: number, activeView: View) {
  const queryClient = useQueryClient();
  const startupHotSyncStartedRef = useRef(false);
  const lastHotSyncRequestedAtRef = useRef(0);

  const syncMutation = useMutation({
    mutationFn: (input: { scope?: SyncScope }) => triggerSync(input),
    onSuccess: (_data, input) => {
      invalidateSyncedDataQueries(queryClient, invalidationScopesForSyncScope(input.scope ?? "all"));
      void queryClient.invalidateQueries({ queryKey: ["syncStates"] });
    },
  });

  function refreshCurrentView(): void {
    if (activeView === "pipelines") {
      // Pipelines are fetched live, not via background sync.
      void queryClient.invalidateQueries({ queryKey: ["pipelineRuns"] });
      return;
    }
    if (organizationsLength > 0 && !syncMutation.isPending) {
      syncMutation.mutate({ scope: currentViewSyncScope(activeView) });
    }
  }

  function requestHotSync(reason: "startup" | "focus"): void {
    if (organizationsLength === 0 || syncMutation.isPending) return;
    if (reason === "focus") {
      const elapsed = Date.now() - lastHotSyncRequestedAtRef.current;
      if (elapsed < HOT_SYNC_FOCUS_MIN_INTERVAL_MS) return;
    }
    lastHotSyncRequestedAtRef.current = Date.now();
    syncMutation.mutate({ scope: "hot" });
  }

  useEffect(() => {
    if (startupHotSyncStartedRef.current || organizationsLength === 0) return;
    startupHotSyncStartedRef.current = true;
    requestHotSync("startup");
  }, [organizationsLength, syncMutation.isPending]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        requestHotSync("focus");
      }
    }
    function onWindowFocus() {
      requestHotSync("focus");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [organizationsLength, syncMutation.isPending]);

  useEffect(() => {
    return subscribeTauriEvent("sync:updated", (payload) => {
      const parsed = syncUpdatedEventSchema.safeParse(payload);
      invalidateSyncedDataQueries(queryClient, parsed.success ? parsed.data.scopes : ["all"]);
    });
  }, [queryClient]);

  return { syncMutation, refreshCurrentView, requestHotSync };
}
