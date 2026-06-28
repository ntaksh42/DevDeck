import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAppSettings,
  getProviderCapabilities,
  listMyReviewPullRequests,
  listMyWorkItems,
  listOrganizations,
  rerunPipelineRun,
  commandErrorMessage,
} from "@/lib/azdoCommands";
import {
  loadQuickPipelines,
  type QuickPipeline,
} from "@/features/pipelines/quickPipelinesStorage";
import { QUICK_PIPELINES_CHANGED_EVENT } from "@/features/pipelines/quickPipelinesEvents";
import { sendPipelineRunNotification } from "@/lib/desktopNotifications";
import { readStoredJson, writeStoredJson, writeStoredString } from "@/lib/storage";
import { applyTheme, loadThemePreference, THEME_CHANGED_EVENT, watchSystemTheme } from "@/lib/theme";
import { storedNumber, focusPrimaryGrid } from "@/lib/utils";
import { HelpDialog } from "@/components/HelpDialog";
import { CommandPalette } from "@/components/CommandPalette";
import {
  loadWorkItemQueryViews,
  type WorkItemQueryView,
} from "@/features/work-items/workItemViewsStorage";
import type { MyReviewsSelectRequest } from "@/features/pull-requests/MyReviewsGrid";
import {
  emptyViewHistory,
  goBack as historyGoBack,
  goForward as historyGoForward,
  pushView,
  type ViewHistory,
} from "@/features/navigation/viewHistory";
import { usePipelineWatchNotifications } from "@/features/pipelines/usePipelineWatchNotifications";
import {
  NAVIGATE_WORK_ITEM_EVENT,
  NAVIGATE_PULL_REQUEST_EVENT,
  type NavigateWorkItemDetail,
  type NavigatePullRequestDetail,
} from "@/lib/crossLinks";
import { AppSidebar, type AppSidebarHandle } from "./app/AppSidebar";
import { AppHeader } from "./app/AppHeader";
import { AppContent } from "./app/AppContent";
import { useKeybindings } from "./app/useKeybindings";
import { usePaletteSearch } from "./app/usePaletteSearch";
import { useCommandActions } from "./app/useCommandActions";
import { useNotificationEvents } from "./app/useNotificationEvents";
import { useSyncManager } from "./app/useSyncManager";
import { useKeyboardShortcuts } from "./app/useKeyboardShortcuts";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "./app/types";
import type { View, ExternalSearchRequest } from "./app/types";

function AppShell() {
  const [view, setView] = useState<View>("myReviews");
  // Browser-like Alt+Left / Alt+Right history of visited views.
  const [viewHistory, setViewHistory] = useState<ViewHistory<View>>(() =>
    emptyViewHistory<View>(),
  );
  const viewHistoryRef = useRef(viewHistory);
  viewHistoryRef.current = viewHistory;
  const navigatingHistoryRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Element focused when an overlay opened; restored on close so keyboard nav
  // resumes instead of stranding focus on <body>.
  const paletteReturnRef = useRef<HTMLElement | null>(null);
  const helpReturnRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<AppSidebarHandle | null>(null);
  const [workItemNavViews, setWorkItemNavViews] = useState<WorkItemQueryView[]>(() =>
    loadWorkItemQueryViews(),
  );
  const [activeWorkItemViewId, setActiveWorkItemViewId] = useState<string | null>(null);
  const [selectedWorkItemViewRequestId, setSelectedWorkItemViewRequestId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, 160, 420),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredJson(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      (raw) => (typeof raw === "boolean" ? raw : undefined),
      false,
    ),
  );
  const [pullRequestSearchRequest, setPullRequestSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [workItemSearchRequest, setWorkItemSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [commitSearchRequest, setCommitSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [myReviewsSelectRequest, setMyReviewsSelectRequest] =
    useState<MyReviewsSelectRequest | null>(null);
  const [quickPipelines, setQuickPipelines] = useState<QuickPipeline[]>(() =>
    loadQuickPipelines(),
  );

  const keybindings = useKeybindings();

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const appSettingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const organizations = organizationsQuery.data ?? [];
  const readOnlyMode = appSettingsQuery.data?.readOnlyValidationModeEnabled ?? false;
  // Capabilities of the active connection's provider, used to hide nav entries
  // the active platform does not support (e.g. Pipelines on GitHub).
  const capabilitiesQuery = useQuery({
    queryKey: ["providerCapabilities"],
    queryFn: getProviderCapabilities,
    enabled: organizations.length > 0,
    staleTime: 5 * 60_000,
  });
  const capabilities = capabilitiesQuery.data?.capabilities ?? null;

  // Watch every subscribed pipeline app-wide so start/finish notifications fire
  // regardless of the active view.
  usePipelineWatchNotifications(appSettingsQuery.data ?? null);

  // Sidebar count badges. Queried for the first organization (the default the
  // views open to) and kept fresh by the same sync:updated invalidation the
  // grids use, so the cache is shared rather than double-fetched.
  const badgeOrganizationId = organizations[0]?.id ?? "";
  const myReviewsCountQuery = useQuery({
    queryKey: ["myReviews", badgeOrganizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId: badgeOrganizationId }),
    enabled: !!badgeOrganizationId,
    staleTime: 5 * 60_000,
  });
  const myWorkItemsCountQuery = useQuery({
    queryKey: ["myWorkItems", badgeOrganizationId],
    queryFn: () => listMyWorkItems({ organizationId: badgeOrganizationId }),
    enabled: !!badgeOrganizationId,
    staleTime: 5 * 60_000,
  });
  // My Reviews badge counts PRs still awaiting my vote (the actionable inbox).
  const myReviewsBadge = myReviewsCountQuery.data
    ? myReviewsCountQuery.data.filter((pr) => pr.myVote === 0 && !pr.isDraft).length
    : null;
  const myWorkItemsBadge = myWorkItemsCountQuery.data?.length ?? null;

  const activeView = organizations.length === 0 ? "settings" : view;

  const { syncMutation, refreshCurrentView } = useSyncManager(
    organizations.length,
    activeView,
  );

  useNotificationEvents(appSettingsQuery.data);

  const {
    setPaletteSearchText,
    paletteSearchItems,
    paletteRecentItems,
    paletteSearchEnabled,
    searchAllQueryIsFetching,
  } = usePaletteSearch(commandPaletteOpen, organizations, {
    setWorkItemSearchRequest,
    setPullRequestSearchRequest,
    setCommitSearchRequest,
    setView,
  });

  // Keep the palette's pipeline actions in sync with edits made in Settings.
  useEffect(() => {
    function onChanged() {
      setQuickPipelines(loadQuickPipelines());
    }
    window.addEventListener(QUICK_PIPELINES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(QUICK_PIPELINES_CHANGED_EVENT, onChanged);
  }, []);

  // Record each visited view so Alt+Left / Alt+Right can replay them. Skip the
  // push when the change was itself triggered by a history navigation.
  useEffect(() => {
    if (navigatingHistoryRef.current) {
      navigatingHistoryRef.current = false;
      return;
    }
    setViewHistory((history) => pushView(history, activeView));
  }, [activeView]);

  const navigateHistory = useCallback((direction: "back" | "forward") => {
    const result =
      direction === "back"
        ? historyGoBack(viewHistoryRef.current)
        : historyGoForward(viewHistoryRef.current);
    if (!result) return;
    navigatingHistoryRef.current = true;
    viewHistoryRef.current = result.history;
    setViewHistory(result.history);
    setView(result.view);
  }, []);

  // Cross-links from the preview panels: jump between a work item and its
  // linked pull requests by switching tabs and targeting the requested item.
  useEffect(() => {
    function onNavigateWorkItem(event: Event) {
      const detail = (event as CustomEvent<NavigateWorkItemDetail>).detail;
      if (!detail) return;
      setWorkItemSearchRequest({
        query: String(detail.workItemId),
        requestId: Date.now(),
        organizationId: detail.organizationId,
      });
      setView("workItems");
    }
    function onNavigatePullRequest(event: Event) {
      const detail = (event as CustomEvent<NavigatePullRequestDetail>).detail;
      if (!detail) return;
      setMyReviewsSelectRequest({
        pullRequestId: detail.pullRequestId,
        repositoryId: detail.repositoryId ?? null,
        organizationId: detail.organizationId,
        requestId: Date.now(),
      });
      setView("myReviews");
    }
    window.addEventListener(NAVIGATE_WORK_ITEM_EVENT, onNavigateWorkItem);
    window.addEventListener(NAVIGATE_PULL_REQUEST_EVENT, onNavigatePullRequest);
    return () => {
      window.removeEventListener(NAVIGATE_WORK_ITEM_EVENT, onNavigateWorkItem);
      window.removeEventListener(NAVIGATE_PULL_REQUEST_EVENT, onNavigatePullRequest);
    };
  }, []);

  useEffect(() => {
    writeStoredString(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    writeStoredJson(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Follow the OS color scheme while the preference is "system". The watcher is
  // rebuilt whenever the preference changes (emitted from the settings panel).
  useEffect(() => {
    let unwatch: (() => void) | undefined;
    function sync() {
      unwatch?.();
      unwatch = undefined;
      if (loadThemePreference() === "system") {
        unwatch = watchSystemTheme(() => applyTheme("system"));
      }
    }
    sync();
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, sync);
      unwatch?.();
    };
  }, []);

  function restoreOverlayFocus(target: HTMLElement | null): void {
    window.setTimeout(() => {
      if (target && document.contains(target)) target.focus();
      else focusPrimaryGrid();
    }, 0);
  }

  function openCommandPalette(): void {
    paletteReturnRef.current = document.activeElement as HTMLElement | null;
    setCommandPaletteOpen(true);
  }

  function closeCommandPalette(): void {
    setCommandPaletteOpen(false);
    setPaletteSearchText("");
    restoreOverlayFocus(paletteReturnRef.current);
    paletteReturnRef.current = null;
  }

  function openHelp(): void {
    helpReturnRef.current = document.activeElement as HTMLElement | null;
    setHelpOpen(true);
  }

  function closeHelp(): void {
    setHelpOpen(false);
    restoreOverlayFocus(helpReturnRef.current);
    helpReturnRef.current = null;
  }

  async function runQuickPipeline(pipeline: QuickPipeline): Promise<void> {
    try {
      const run = await rerunPipelineRun({
        organizationId: pipeline.organizationId,
        projectId: pipeline.projectId,
        definitionId: pipeline.definitionId,
        sourceBranch: pipeline.sourceBranch,
      });
      void sendPipelineRunNotification({
        ok: true,
        pipelineName: pipeline.name,
        detail: run.buildNumber
          ? `Build ${run.buildNumber} queued.`
          : "A new run was queued.",
        webUrl: run.webUrl,
      });
    } catch (error) {
      void sendPipelineRunNotification({
        ok: false,
        pipelineName: pipeline.name,
        detail: commandErrorMessage(error),
      });
    }
  }

  const commandActions = useCommandActions({
    activeView,
    organizationsLength: organizations.length,
    syncPending: syncMutation.isPending,
    readOnlyMode,
    quickPipelines,
    setView,
    syncAll: () => syncMutation.mutate({ scope: "all" }),
    refreshCurrentView,
    runQuickPipeline: (p) => { void runQuickPipeline(p); },
    openHelp,
  });

  useKeyboardShortcuts({
    activeView,
    organizationsLength: organizations.length,
    syncPending: syncMutation.isPending,
    syncAll: () => syncMutation.mutate({ scope: "all" }),
    keybindings,
    navigateHistory,
    openCommandPalette,
    openHelp,
    closeHelp,
    closeCommandPalette,
    setView,
    setSidebarCollapsed: setSidebarCollapsed as Dispatch<SetStateAction<boolean>>,
    refreshCurrentView,
    focusNavigation: () => sidebarRef.current?.focusNavigation(),
  });

  // CommitSearch passes a PR query upward; resolve it as a PR search.
  function openPullRequestSearch(query: string, organizationId?: string): void {
    setPullRequestSearchRequest({ query, requestId: Date.now(), organizationId });
    setView("pullRequestSearch");
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        ref={sidebarRef}
        activeView={activeView}
        organizationsLength={organizations.length}
        capabilities={capabilities}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        workItemNavViews={workItemNavViews}
        activeWorkItemViewId={activeWorkItemViewId}
        myReviewsBadge={myReviewsBadge}
        myWorkItemsBadge={myWorkItemsBadge}
        onNavigate={setView}
        onOpenHelp={openHelp}
        onSetActiveWorkItemViewId={setActiveWorkItemViewId}
        onSetSelectedWorkItemViewRequestId={setSelectedWorkItemViewRequestId}
      />
      <main
        className="flex h-screen flex-col lg:pl-[var(--sidebar-width)]"
        style={{ "--sidebar-width": `${sidebarCollapsed ? 0 : sidebarWidth}px` } as CSSProperties}
      >
        <AppHeader
          activeView={activeView}
          sidebarCollapsed={sidebarCollapsed}
          organizationsLength={organizations.length}
          keybindings={keybindings}
          syncing={syncMutation.isPending}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          onSync={() => syncMutation.mutate({ scope: "all" })}
        />
        <AppContent
          activeView={activeView}
          organizations={organizations}
          organizationsQuery={organizationsQuery}
          pullRequestSearchRequest={pullRequestSearchRequest}
          workItemSearchRequest={workItemSearchRequest}
          commitSearchRequest={commitSearchRequest}
          myReviewsSelectRequest={myReviewsSelectRequest}
          selectedWorkItemViewRequestId={selectedWorkItemViewRequestId}
          onPullRequestSearchHandled={() => setPullRequestSearchRequest(null)}
          onWorkItemSearchHandled={() => setWorkItemSearchRequest(null)}
          onCommitSearchHandled={() => setCommitSearchRequest(null)}
          onMyReviewsSelectHandled={() => setMyReviewsSelectRequest(null)}
          onSelectedViewChange={setActiveWorkItemViewId}
          onSelectedViewRequestHandled={() => setSelectedWorkItemViewRequestId(null)}
          onWorkItemNavViewsChange={setWorkItemNavViews}
          onOpenSettings={() => setView("settings")}
          onOpenPullRequest={openPullRequestSearch}
        />
      </main>
      {helpOpen && <HelpDialog onClose={() => closeHelp()} />}
      {commandPaletteOpen && (
        <CommandPalette
          actions={commandActions}
          onClose={closeCommandPalette}
          search={
            organizations.length > 0
              ? {
                  items: [...paletteSearchItems, ...paletteRecentItems],
                  pending: paletteSearchEnabled && searchAllQueryIsFetching,
                  onQueryChange: setPaletteSearchText,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function App() {
  return <AppShell />;
}

export default App;
