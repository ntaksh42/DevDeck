import {
  CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Route, Routes } from "react-router-dom";
import {
  commandErrorMessage,
  getAppSettings,
  listOrganizations,
  searchAll,
  syncUpdatedEventSchema,
  triggerSync,
  type SyncScope,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/runtime";
import {
  storedNumber,
  isEditableTarget,
  focusWorkItemCommentInput,
  focusPrimaryGrid,
  focusPrimaryPreview,
  focusViewsPanel,
} from "@/lib/utils";
import { ResizeHandle } from "@/components/ResizeHandle";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { NavButton, NavSection, NavSubItem } from "@/components/Nav";
import { HelpDialog } from "@/components/HelpDialog";
import { UserGuideDialog } from "@/components/UserGuideDialog";
import {
  CommandPalette,
  type CommandPaletteAction,
  type CommandPaletteSearchItem,
} from "@/components/CommandPalette";
import { CommitSearch } from "@/features/commits/CommitSearch";
import { WorkItemSearch } from '@/features/work-items/WorkItemSearch';
import { WorkItemViewsPanel } from '@/features/work-items/WorkItemViewsPanel';
import {
  loadWorkItemQueryViews,
  type WorkItemQueryView,
} from '@/features/work-items/workItemViewsStorage';
import { MyWorkItemsPanel } from '@/features/work-items/MyWorkItemsPanel';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from '@/features/work-items/queryKeys';
import { OrganizationSettings, SetupPanel } from '@/features/settings/OrganizationSettings';
import { MyReviewsGrid } from '@/features/pull-requests/MyReviewsGrid';
import { PullRequestSearch } from '@/features/pull-requests/PullRequestSearch';
import {
  showWorkItemNotificationEvent,
  type WorkItemNotificationEvent,
} from "@/lib/desktopNotifications";

type View =
  | "pullRequestSearch"
  | "myReviews"
  | "workItems"
  | "myWorkItems"
  | "workItemViews"
  | "commits"
  | "settings";

type NavSectionId = "pullRequests" | "workItems";

const DEFAULT_SIDEBAR_WIDTH = 232;
const SIDEBAR_WIDTH_STORAGE_KEY = "azdodeck:layout:sidebarWidth";
const HOT_SYNC_FOCUS_MIN_INTERVAL_MS = 2 * 60_000;

function invalidateSyncedDataQueries(
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

function invalidationScopesForSyncScope(scope: SyncScope = "all"): SyncScope[] {
  return scope === "hot" ? ["myReviews", "myWorkItems"] : [scope];
}

type PaletteSearchKind = "workItems" | "pullRequests" | "commits";

type ExternalSearchRequest = { query: string; requestId: number };

function parsePaletteSearch(text: string): { kind: PaletteSearchKind | null; query: string } {
  const match = /^(wi|pr|c):\s*(.*)$/i.exec(text.trim());
  if (match) {
    const prefix = match[1].toLowerCase();
    const kind: PaletteSearchKind =
      prefix === "wi" ? "workItems" : prefix === "pr" ? "pullRequests" : "commits";
    return { kind, query: match[2].trim() };
  }
  return { kind: null, query: text.trim() };
}

function commitFirstLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
}

// Linear-style two-key navigation: press G, then one of these.
const GOTO_VIEW_KEYS: Record<string, View> = {
  r: "myReviews",
  p: "pullRequestSearch",
  w: "myWorkItems",
  i: "workItems",
  v: "workItemViews",
  c: "commits",
  s: "settings",
};
const GOTO_CHAIN_TIMEOUT_MS = 1500;



function AppShell() {
  const [view, setView] = useState<View>("myReviews");
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [userGuideOpen, setUserGuideOpen] = useState(false);
  const [navExpanded, setNavExpanded] = useState<Record<NavSectionId, boolean>>({
    pullRequests: true,
    workItems: true,
  });
  const [workItemNavViews, setWorkItemNavViews] = useState<WorkItemQueryView[]>(() =>
    loadWorkItemQueryViews(),
  );
  const [activeWorkItemViewId, setActiveWorkItemViewId] = useState<string | null>(null);
  const [selectedWorkItemViewRequestId, setSelectedWorkItemViewRequestId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, 160, 420),
  );
  const navRef = useRef<HTMLElement | null>(null);
  const appSettingsRef = useRef<Awaited<ReturnType<typeof getAppSettings>> | null>(null);
  const startupHotSyncStartedRef = useRef(false);
  const lastHotSyncRequestedAtRef = useRef(0);
  const navTypeaheadRef = useRef<{ value: string; timer: number | null }>({
    value: "",
    timer: null,
  });
  const queryClient = useQueryClient();
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
  const syncMutation = useMutation({
    mutationFn: (input: { scope?: SyncScope }) => triggerSync(input),
    onSuccess: (_data, input) => {
      invalidateSyncedDataQueries(queryClient, invalidationScopesForSyncScope(input.scope ?? "all"));
    },
  });

  const activeView = organizations.length === 0 ? "settings" : view;

  const [paletteSearchText, setPaletteSearchText] = useState("");
  const [debouncedPaletteSearchText, setDebouncedPaletteSearchText] = useState("");
  const [workItemSearchRequest, setWorkItemSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [pullRequestSearchRequest, setPullRequestSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [commitSearchRequest, setCommitSearchRequest] =
    useState<ExternalSearchRequest | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPaletteSearchText(paletteSearchText), 200);
    return () => window.clearTimeout(timer);
  }, [paletteSearchText]);

  const paletteSearch = parsePaletteSearch(debouncedPaletteSearchText);
  const paletteOrganizationId = organizations[0]?.id ?? "";
  const paletteSearchEnabled =
    commandPaletteOpen &&
    !!paletteOrganizationId &&
    (/^\d+$/.test(paletteSearch.query)
      ? paletteSearch.query.length >= 1
      : paletteSearch.query.length >= 2);
  const searchAllQuery = useQuery({
    queryKey: ["searchAll", paletteOrganizationId, paletteSearch.query],
    queryFn: () =>
      searchAll({ organizationId: paletteOrganizationId, query: paletteSearch.query }),
    enabled: paletteSearchEnabled,
    staleTime: 30_000,
    // Keep showing the previous results while the next keystroke's search
    // runs, instead of flashing an empty list.
    placeholderData: keepPreviousData,
  });

  const paletteSearchItems = useMemo<CommandPaletteSearchItem[]>(() => {
    const data = paletteSearchEnabled ? searchAllQuery.data : undefined;
    if (!data) return [];
    const items: CommandPaletteSearchItem[] = [];
    const kind = paletteSearch.kind;
    const rawQuery = paletteSearch.query;

    if (!kind || kind === "workItems") {
      for (const item of data.workItems) {
        items.push({
          id: `wi:${item.organizationId}:${item.id}`,
          group: "Work Items",
          label: `#${item.id} ${item.title}`,
          detail: [item.workItemType, item.state, item.assignedTo].filter(Boolean).join(" · "),
          run: () => {
            setWorkItemSearchRequest({ query: String(item.id), requestId: Date.now() });
            setView("workItems");
          },
          runAlt: item.webUrl
            ? () => {
                void openExternalUrl(item.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.workItems > data.workItems.length) {
        items.push({
          id: "wi:more",
          group: "Work Items",
          label: `Show all ${data.totals.workItems} work items…`,
          run: () => {
            setWorkItemSearchRequest({ query: rawQuery, requestId: Date.now() });
            setView("workItems");
          },
        });
      }
    }
    if (!kind || kind === "pullRequests") {
      for (const pr of data.pullRequests) {
        items.push({
          id: `pr:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
          group: "Pull Requests (active)",
          label: `PR ${pr.pullRequestId} ${pr.title}`,
          detail: [pr.repositoryName, pr.createdBy].filter(Boolean).join(" · "),
          run: () => {
            setPullRequestSearchRequest({
              query: String(pr.pullRequestId),
              requestId: Date.now(),
            });
            setView("pullRequestSearch");
          },
          runAlt: pr.webUrl
            ? () => {
                void openExternalUrl(pr.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.pullRequests > data.pullRequests.length) {
        items.push({
          id: "pr:more",
          group: "Pull Requests (active)",
          label: `Show all ${data.totals.pullRequests} pull requests…`,
          run: () => {
            setPullRequestSearchRequest({ query: rawQuery, requestId: Date.now() });
            setView("pullRequestSearch");
          },
        });
      }
    }
    if (!kind || kind === "commits") {
      for (const commit of data.commits) {
        items.push({
          id: `c:${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`,
          group: "Commits",
          label: `${commit.shortCommitId} ${commitFirstLine(commit.comment)}`,
          detail: [commit.repositoryName, commit.authorName].filter(Boolean).join(" · "),
          run: () => {
            setCommitSearchRequest({ query: rawQuery, requestId: Date.now() });
            setView("commits");
          },
          runAlt: commit.webUrl
            ? () => {
                void openExternalUrl(commit.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.commits > data.commits.length) {
        items.push({
          id: "c:more",
          group: "Commits",
          label: `Show all ${data.totals.commits} commits…`,
          run: () => {
            setCommitSearchRequest({ query: rawQuery, requestId: Date.now() });
            setView("commits");
          },
        });
      }
    }
    return items;
  }, [paletteSearch.kind, paletteSearch.query, paletteSearchEnabled, searchAllQuery.data]);

  function closeCommandPalette(): void {
    setCommandPaletteOpen(false);
    setPaletteSearchText("");
    setDebouncedPaletteSearchText("");
  }

  const pinnedWorkItemViews = workItemNavViews.filter((item) => item.pinned);
  const activePinnedWorkItemView = pinnedWorkItemViews.find(
    (item) => item.id === activeWorkItemViewId,
  );

  function getNavItems(): HTMLButtonElement[] {
    const nav = navRef.current;
    if (!nav) return [];
    return Array.from(
      nav.querySelectorAll<HTMLButtonElement>("[data-nav-item='true']:not(:disabled)"),
    ).filter((item) => item.offsetParent !== null);
  }

  function focusNavigation(): void {
    const items = getNavItems();
    const target =
      items.find((item) => item.dataset.navActive === "true") ?? items[0];
    target?.focus();
  }

  function focusNavItem(current: HTMLButtonElement, delta: number): void {
    const items = getNavItems();
    const currentIndex = Math.max(0, items.indexOf(current));
    const nextIndex = Math.min(items.length - 1, Math.max(0, currentIndex + delta));
    items[nextIndex]?.focus();
  }

  function focusNavItemByTypeahead(event: KeyboardEvent): boolean {
    if (
      event.key.length !== 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableTarget(event.target)
    ) {
      return false;
    }

    if (navTypeaheadRef.current.timer !== null) {
      window.clearTimeout(navTypeaheadRef.current.timer);
    }
    navTypeaheadRef.current.value =
      `${navTypeaheadRef.current.value}${event.key}`.toLowerCase();
    navTypeaheadRef.current.timer = window.setTimeout(() => {
      navTypeaheadRef.current.value = "";
      navTypeaheadRef.current.timer = null;
    }, 800);

    const term = navTypeaheadRef.current.value;
    const items = getNavItems();
    const match = items.find((item) =>
      (item.dataset.navLabel ?? "").toLowerCase().startsWith(term),
    );
    if (!match) return false;
    match.focus();
    return true;
  }

  function setNavSectionExpanded(id: NavSectionId, expanded: boolean): void {
    setNavExpanded((current) => ({ ...current, [id]: expanded }));
  }

  function dispatchWorkItemCommand(command: string): void {
    window.dispatchEvent(new CustomEvent(`azdodeck:work-items:${command}`));
  }

  function currentViewSyncScope(): SyncScope {
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

  function refreshCurrentView(): void {
    if (organizations.length > 0 && !syncMutation.isPending) {
      syncMutation.mutate({ scope: currentViewSyncScope() });
    }
  }

  function requestHotSync(reason: "startup" | "focus"): void {
    if (organizations.length === 0 || syncMutation.isPending) return;
    if (reason === "focus") {
      const elapsed = Date.now() - lastHotSyncRequestedAtRef.current;
      if (elapsed < HOT_SYNC_FOCUS_MIN_INTERVAL_MS) return;
    }
    lastHotSyncRequestedAtRef.current = Date.now();
    syncMutation.mutate({ scope: "hot" });
  }

  const commandActions: CommandPaletteAction[] = [
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.myReviews",
      keywords: ["pull request", "review"],
      label: "Go to My Reviews",
      run: () => setView("myReviews"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.pullRequestSearch",
      keywords: ["pull request", "search"],
      label: "Go to Pull Request Search",
      run: () => setView("pullRequestSearch"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.myWorkItems",
      keywords: ["work item", "assigned"],
      label: "Go to My Work Items",
      run: () => setView("myWorkItems"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.workItemViews",
      keywords: ["wiql", "query", "saved"],
      label: "Go to Work Item Views",
      run: () => setView("workItemViews"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.workItemSearch",
      keywords: ["work item", "search"],
      label: "Go to Work Item Search",
      run: () => setView("workItems"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.commits",
      keywords: ["commit", "search"],
      label: "Go to Commits",
      run: () => setView("commits"),
    },
    {
      group: "Navigation",
      id: "nav.settings",
      keywords: ["option", "preferences"],
      label: "Go to Settings",
      run: () => setView("settings"),
      shortcut: "Alt+,",
    },
    {
      group: "Focus",
      id: "focus.filter",
      keywords: ["search", "find"],
      label: "Focus filter",
      run: () => {
        const filterInput = document.querySelector<HTMLInputElement>(
          [
            "[data-filter-input='true']",
            "input[aria-label='Filter']",
            "input[type='search']",
            "input[placeholder*='Filter']",
            "input[placeholder*='Search']",
          ].join(","),
        );
        filterInput?.focus();
        filterInput?.select();
      },
      shortcut: "Ctrl+F",
    },
    {
      group: "Focus",
      id: "focus.grid",
      keywords: ["list", "table", "rows"],
      label: "Focus grid",
      run: focusPrimaryGrid,
      shortcut: "Alt+G",
    },
    {
      group: "Focus",
      id: "focus.preview",
      keywords: ["details", "pane"],
      label: "Focus preview",
      run: focusPrimaryPreview,
      shortcut: "Alt+P",
    },
    {
      group: "Focus",
      id: "focus.comment",
      keywords: ["work item", "discussion"],
      label: "Focus work item comment",
      run: () => {
        if (!focusWorkItemCommentInput()) dispatchWorkItemCommand("focus-comment");
      },
      shortcut: "M",
    },
    {
      disabled:
        activeView !== "myWorkItems" &&
        activeView !== "workItems" &&
        activeView !== "workItemViews",
      group: "Work Items",
      id: "wi.state",
      keywords: ["status", "transition"],
      label: "Change selected work item state",
      run: () => dispatchWorkItemCommand("open-state"),
      shortcut: "S",
    },
    {
      disabled:
        activeView !== "myWorkItems" &&
        activeView !== "workItems" &&
        activeView !== "workItemViews",
      group: "Work Items",
      id: "wi.assignee",
      keywords: ["assign", "owner"],
      label: "Change selected work item assignee",
      run: () => dispatchWorkItemCommand("open-assignee"),
      shortcut: "A",
    },
    {
      disabled:
        activeView !== "myWorkItems" &&
        activeView !== "workItems" &&
        activeView !== "workItemViews",
      group: "Work Items",
      id: "wi.priority",
      keywords: ["prio"],
      label: "Change selected work item priority",
      run: () => dispatchWorkItemCommand("open-priority"),
      shortcut: "P",
    },
    {
      disabled:
        activeView !== "myWorkItems" &&
        activeView !== "workItems" &&
        activeView !== "workItemViews",
      group: "Work Items",
      id: "wi.postComment",
      keywords: ["submit", "discussion"],
      label: "Post work item comment",
      run: () => dispatchWorkItemCommand("post-comment"),
      shortcut: "Ctrl+Enter",
    },
    {
      disabled:
        activeView !== "myWorkItems" &&
        activeView !== "workItems" &&
        activeView !== "workItemViews",
      group: "Work Items",
      id: "wi.applyStaged",
      keywords: ["save", "pending", "apply"],
      label: "Apply pending work item changes",
      run: () => dispatchWorkItemCommand("apply-staged"),
      shortcut: "Ctrl+S",
    },
    {
      disabled: organizations.length === 0 || syncMutation.isPending,
      group: "General",
      id: "general.sync",
      keywords: ["refresh"],
      label: "Sync now",
      run: () => syncMutation.mutate({ scope: "all" }),
      shortcut: "Alt+S",
    },
    {
      disabled: organizations.length === 0 || syncMutation.isPending,
      group: "General",
      id: "general.refreshCurrentView",
      keywords: ["refresh", "current", "sync"],
      label: "Refresh current view",
      run: refreshCurrentView,
      shortcut: "Ctrl+R",
    },
    {
      group: "General",
      id: "general.shortcuts",
      keywords: ["keyboard", "help"],
      label: "Show keyboard shortcuts",
      run: () => setHelpOpen(true),
      shortcut: "?",
    },
  ];

  function handleNavKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-nav-item='true']",
    );
    if (!current) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNavItem(current, 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNavItem(current, -1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      getNavItems()[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const items = getNavItems();
      items[items.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && current.dataset.navSection === "true") {
      event.preventDefault();
      const sectionId = current.dataset.sectionId as NavSectionId | undefined;
      if (sectionId && !navExpanded[sectionId]) {
        setNavSectionExpanded(sectionId, true);
      } else {
        focusNavItem(current, 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && current.dataset.navSection === "true") {
      event.preventDefault();
      const sectionId = current.dataset.sectionId as NavSectionId | undefined;
      if (sectionId && navExpanded[sectionId]) {
        setNavSectionExpanded(sectionId, false);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      current.click();
      return;
    }
    if (focusNavItemByTypeahead(event.nativeEvent)) {
      event.preventDefault();
    }
  }

  useEffect(() => {
    appSettingsRef.current = appSettingsQuery.data ?? null;
  }, [appSettingsQuery.data]);

  useEffect(() => {
    if (startupHotSyncStartedRef.current || organizations.length === 0) return;
    startupHotSyncStartedRef.current = true;
    requestHotSync("startup");
  }, [organizations.length, syncMutation.isPending]);

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
  }, [organizations.length, syncMutation.isPending]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cleanup: (() => void) | undefined;
    listen("sync:updated", (event) => {
      const parsed = syncUpdatedEventSchema.safeParse(event.payload);
      invalidateSyncedDataQueries(queryClient, parsed.success ? parsed.data.scopes : ["all"]);
    })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((e) => console.error("sync:updated listen failed", e));
    return () => cleanup?.();
  }, [queryClient]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cleanup: (() => void) | undefined;
    listen<WorkItemNotificationEvent>("notifications:work-items", (event) => {
      const settings = appSettingsRef.current;
      if (!settings) return;
      void showWorkItemNotificationEvent(event.payload, settings);
    })
      .then((unlisten) => {
        cleanup = unlisten;
      })
      .catch((e) => console.error("notifications:work-items listen failed", e));
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  // The G chain runs in the capture phase so the second key wins over
  // grid-level single-letter shortcuts (S, P, C, …).
  useEffect(() => {
    let armed = false;
    let timer: number | null = null;

    function disarm() {
      armed = false;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function onKeyDownCapture(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) {
        disarm();
        return;
      }
      if (armed) {
        const view = GOTO_VIEW_KEYS[event.key.toLowerCase()];
        disarm();
        if (view && (view === "settings" || organizations.length > 0)) {
          event.preventDefault();
          event.stopPropagation();
          setView(view);
          window.setTimeout(() => focusPrimaryGrid(), 0);
        }
        return;
      }
      if (event.key === "g" || event.key === "G") {
        armed = true;
        timer = window.setTimeout(disarm, GOTO_CHAIN_TIMEOUT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      disarm();
    };
  }, [organizations.length]);

  useEffect(() => {
    function onGlobalKeyDown(event: KeyboardEvent) {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "k" || event.key === "K")
      ) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "f" || event.key === "F")
      ) {
        const filterInput = document.querySelector<HTMLInputElement>(
          [
            "[data-filter-input='true']",
            "input[aria-label='Filter']",
            "input[type='search']",
            "input[placeholder*='Filter']",
            "input[placeholder*='Search']",
          ].join(","),
        );
        if (filterInput && !filterInput.disabled && !filterInput.hidden) {
          event.preventDefault();
          filterInput.focus();
          filterInput.select();
        }
        return;
      }

      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "r" || event.key === "R")
      ) {
        event.preventDefault();
        refreshCurrentView();
        return;
      }

      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "s" || event.key === "S")
      ) {
        if (
          activeView === "myWorkItems" ||
          activeView === "workItems" ||
          activeView === "workItemViews"
        ) {
          event.preventDefault();
          dispatchWorkItemCommand("apply-staged");
        }
        return;
      }

      if (event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return;
      }

      if (
        (event.key === "?" || event.key === "F1") &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (event.key === "Escape" && !event.altKey) {
        if (isEditableTarget(event.target) && focusPrimaryGrid()) {
          event.preventDefault();
          return;
        }
        setHelpOpen(false);
        closeCommandPalette();
        setUserGuideOpen(false);
        return;
      }

      if (!event.altKey || event.shiftKey) {
        return;
      }

      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        focusNavigation();
        return;
      }

      if (event.key === "g" || event.key === "G") {
        event.preventDefault();
        focusPrimaryGrid();
        return;
      }

      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        focusPrimaryPreview();
        return;
      }

      if (event.key === "v" || event.key === "V") {
        if (activeView === "workItemViews") {
          event.preventDefault();
          focusViewsPanel();
        }
        return;
      }

      if (event.key === "m" || event.key === "M") {
        if (
          activeView === "myWorkItems" ||
          activeView === "workItems" ||
          activeView === "workItemViews"
        ) {
          event.preventDefault();
          focusWorkItemCommentInput();
        }
        return;
      }

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        if (organizations.length > 0 && !syncMutation.isPending) {
          syncMutation.mutate({ scope: "all" });
        }
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        setView("settings");
      }
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [activeView, organizations.length, syncMutation.isPending, syncMutation.mutate]);

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <aside
        className="fixed inset-y-0 left-0 hidden flex-col border-r border-border bg-white lg:flex"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-12 min-w-0 items-center gap-2 border-b border-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">AzDoDeck</p>
            <p className="truncate text-xs text-muted-foreground">Azure DevOps</p>
          </div>
        </div>
        <nav
          ref={navRef}
          aria-label="Primary navigation"
          className="flex flex-1 flex-col p-2"
          onKeyDown={handleNavKeyDown}
        >
          <div className="space-y-1">
            {/* Pull Requests section */}
            <NavSection
              id="pullRequests"
              icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
              label="Pull Requests"
              disabled={organizations.length === 0}
              expanded={navExpanded.pullRequests}
              onExpandedChange={(expanded) => setNavSectionExpanded("pullRequests", expanded)}
            >
              <NavSubItem
                active={activeView === "myReviews"}
                disabled={organizations.length === 0}
                label="My Reviews"
                onClick={() => setView("myReviews")}
              />
              <NavSubItem
                active={activeView === "pullRequestSearch"}
                disabled={organizations.length === 0}
                label="Search"
                onClick={() => setView("pullRequestSearch")}
              />
            </NavSection>
            <NavSection
              id="workItems"
              icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
              label="Work Items"
              disabled={organizations.length === 0}
              expanded={navExpanded.workItems}
              onExpandedChange={(expanded) => setNavSectionExpanded("workItems", expanded)}
            >
              <NavSubItem
                active={activeView === "myWorkItems"}
                disabled={organizations.length === 0}
                label="My Items"
                onClick={() => setView("myWorkItems")}
              />
              <NavSubItem
                active={activeView === "workItemViews" && !activePinnedWorkItemView}
                disabled={organizations.length === 0}
                label="Views"
                onClick={() => {
                  setActiveWorkItemViewId(null);
                  setSelectedWorkItemViewRequestId(null);
                  setView("workItemViews");
                }}
              />
              {pinnedWorkItemViews.map((item) => (
                <NavSubItem
                  key={item.id}
                  active={activeView === "workItemViews" && activeWorkItemViewId === item.id}
                  disabled={organizations.length === 0}
                  label={item.name}
                  onClick={() => {
                    setActiveWorkItemViewId(item.id);
                    setSelectedWorkItemViewRequestId(item.id);
                    setView("workItemViews");
                  }}
                />
              ))}
              <NavSubItem
                active={activeView === "workItems"}
                disabled={organizations.length === 0}
                label="Search"
                onClick={() => setView("workItems")}
              />
            </NavSection>
            <NavButton
              active={activeView === "commits"}
              disabled={organizations.length === 0}
              icon={<GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />}
              label="Commits"
              onClick={() => setView("commits")}
            />
          </div>
          <div className="mt-auto space-y-1 border-t border-border pt-2">
            <NavButton
              active={false}
              icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
              label="Help"
              shortcut="F1"
              onClick={() => setHelpOpen(true)}
            />
            <NavButton
              active={activeView === "settings"}
              icon={<Settings className="h-4 w-4" aria-hidden="true" />}
              label="Settings"
              shortcut="Alt+,"
              onClick={() => setView("settings")}
            />
          </div>
        </nav>
        <ResizeHandle
          ariaLabel="Resize navigation"
          className="absolute inset-y-0 right-[-5px] hidden lg:flex"
          direction={1}
          max={420}
          min={160}
          onChange={setSidebarWidth}
          onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          value={sidebarWidth}
        />
      </aside>

      <main
        className="flex h-screen flex-col lg:pl-[var(--sidebar-width)]"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <header className="flex h-12 items-center justify-between border-b border-border bg-white px-4 lg:px-5">
          <div>
            <h1 className="text-lg font-semibold">
              {activeView === "pullRequestSearch"
                ? "Pull Requests"
                : activeView === "myReviews"
                  ? "My Reviews"
                  : activeView === "workItems"
                    ? "Work Items"
                    : activeView === "myWorkItems"
                      ? "My Work Items"
                      : activeView === "workItemViews"
                        ? "Work Item Views"
                        : activeView === "commits"
                          ? "Commits"
                          : "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeView === "pullRequestSearch"
                ? "Search Azure DevOps pull requests across projects and repositories"
                : activeView === "myReviews"
                  ? "Pull requests assigned to you for review"
                  : activeView === "workItems"
                    ? "Search Azure DevOps work items across projects"
                    : activeView === "myWorkItems"
                      ? "Work items assigned to you"
                      : activeView === "workItemViews"
                        ? "Saved WIQL views with counts, grid results, and preview"
                        : activeView === "commits"
                          ? "Search Azure DevOps commits across repositories"
                          : "Local Azure DevOps organization setup"}
            </p>
          </div>
          {organizations.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={syncMutation.isPending}
                onClick={() => syncMutation.mutate({ scope: "all" })}
                aria-keyshortcuts="Alt+S"
                className="flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="Sync now"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Sync
              </button>
            </div>
          )}
        </header>

        <section
          className={`flex min-h-0 flex-1 flex-col px-3 py-3 lg:px-5 ${
            activeView === "settings" || organizations.length === 0
              ? "overflow-auto"
              : "overflow-hidden"
          }`}
        >
          {organizationsQuery.isLoading ? (
            <LoadingState />
          ) : organizationsQuery.isError ? (
            <ErrorState message={commandErrorMessage(organizationsQuery.error)} />
          ) : activeView === "pullRequestSearch" ? (
            <PullRequestSearch
              organizations={organizations}
              externalSearch={pullRequestSearchRequest}
              onExternalSearchHandled={() => setPullRequestSearchRequest(null)}
            />
          ) : activeView === "myReviews" ? (
            <MyReviewsGrid organizations={organizations} />
          ) : activeView === "workItems" ? (
            <WorkItemSearch
              organizations={organizations}
              externalSearch={workItemSearchRequest}
              onExternalSearchHandled={() => setWorkItemSearchRequest(null)}
            />
          ) : activeView === "myWorkItems" ? (
            <MyWorkItemsPanel organizations={organizations} />
          ) : activeView === "workItemViews" ? (
            <WorkItemViewsPanel
              organizations={organizations}
              selectedViewRequestId={selectedWorkItemViewRequestId}
              onSelectedViewChange={setActiveWorkItemViewId}
              onSelectedViewRequestHandled={() => setSelectedWorkItemViewRequestId(null)}
              onViewsChange={setWorkItemNavViews}
            />
          ) : activeView === "commits" ? (
            <CommitSearch
              organizations={organizations}
              externalSearch={commitSearchRequest}
              onExternalSearchHandled={() => setCommitSearchRequest(null)}
            />
          ) : organizations.length === 0 ? (
            <SetupPanel />
          ) : (
            <OrganizationSettings organizations={organizations} />
          )}
        </section>
      </main>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {commandPaletteOpen && (
        <CommandPalette
          actions={commandActions}
          onClose={closeCommandPalette}
          search={
            organizations.length > 0
              ? {
                  items: paletteSearchItems,
                  pending: paletteSearchEnabled && searchAllQuery.isFetching,
                  onQueryChange: setPaletteSearchText,
                }
              : undefined
          }
        />
      )}
      {userGuideOpen && <UserGuideDialog onClose={() => setUserGuideOpen(false)} />}
    </div>
  );
}


function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
    </Routes>
  );
}

export default App;
