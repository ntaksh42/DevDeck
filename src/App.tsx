import {
  CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  Suspense,
  useCallback,
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
  Code,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  Settings,
} from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  listMyReviewPullRequests,
  listMyWorkItems,
  listOrganizations,
  rerunPipelineRun,
  searchAll,
  submitPullRequestVote,
  searchCode,
  syncUpdatedEventSchema,
  triggerSync,
  type PullRequestSummary,
  type SyncScope,
} from "@/lib/azdoCommands";
import {
  loadQuickPipelines,
  type QuickPipeline,
} from "@/features/pipelines/quickPipelinesStorage";
import { QUICK_PIPELINES_CHANGED_EVENT } from "@/features/pipelines/quickPipelinesEvents";
import { openExternalUrl } from "@/lib/openExternal";
import { writeStoredString } from "@/lib/storage";
import { loadRecentPaletteEntries } from "@/lib/recentItems";
import {
  applyTheme,
  loadThemePreference,
  THEME_CHANGED_EVENT,
  watchSystemTheme,
} from "@/lib/theme";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import {
  KEYBINDINGS_CHANGED_EVENT,
  matchesCombo,
  normalizeKey,
  resolveKeybindings,
  type KeybindingMap,
} from "@/lib/keybindings";
import {
  storedNumber,
  isEditableTarget,
  focusWorkItemCommentInput,
  focusFilterInput,
  focusPrimaryGrid,
  focusPrimaryPreview,
  focusViewsPanel,
} from "@/lib/utils";
import { ResizeHandle } from "@/components/ResizeHandle";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { NavButton, NavSection, NavSubGroup, NavSubItem } from "@/components/Nav";
import { HelpDialog } from "@/components/HelpDialog";
import { resetLayoutWidths } from "@/lib/layoutReset";
import {
  CommandPalette,
  type CommandPaletteAction,
  type CommandPaletteSearchItem,
} from "@/components/CommandPalette";
import {
  loadWorkItemQueryViews,
  viewCountBaseline,
  type WorkItemQueryView,
} from '@/features/work-items/workItemViewsStorage';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from '@/features/work-items/queryKeys';
import { MyReviewsGrid } from '@/features/pull-requests/MyReviewsGrid';

// Only the default view (My Reviews) loads eagerly; the other views are
// code-split so app startup does not pay for panels that may never open.
const CommitSearch = lazy(() =>
  import("@/features/commits/CommitSearch").then((m) => ({ default: m.CommitSearch })),
);
const PipelinesView = lazy(() =>
  import("@/features/pipelines/PipelinesView").then((m) => ({ default: m.PipelinesView })),
);
const CodeSearchView = lazy(() =>
  import("@/features/code/CodeSearchView").then((m) => ({ default: m.CodeSearchView })),
);
const WorkItemSearch = lazy(() =>
  import("@/features/work-items/WorkItemSearch").then((m) => ({ default: m.WorkItemSearch })),
);
const WorkItemViewsPanel = lazy(() =>
  import("@/features/work-items/WorkItemViewsPanel").then((m) => ({
    default: m.WorkItemViewsPanel,
  })),
);
const MyWorkItemsPanel = lazy(() =>
  import("@/features/work-items/MyWorkItemsPanel").then((m) => ({
    default: m.MyWorkItemsPanel,
  })),
);
const OrganizationSettings = lazy(() =>
  import("@/features/settings/OrganizationSettings").then((m) => ({
    default: m.OrganizationSettings,
  })),
);
const SetupPanel = lazy(() =>
  import("@/features/settings/OrganizationSettings").then((m) => ({ default: m.SetupPanel })),
);
const PullRequestSearch = lazy(() =>
  import("@/features/pull-requests/PullRequestSearch").then((m) => ({
    default: m.PullRequestSearch,
  })),
);
import {
  sendPipelineRunNotification,
  showWorkItemNotificationEvent,
  showPullRequestNotificationEvent,
  showSyncFailedNotificationEvent,
  type WorkItemNotificationEvent,
  type PullRequestNotificationEvent,
  type SyncFailedEvent,
} from "@/lib/desktopNotifications";
import { SyncStatusIndicator } from "@/features/sync/SyncStatusIndicator";
import {
  NAVIGATE_WORK_ITEM_EVENT,
  NAVIGATE_PULL_REQUEST_EVENT,
  type NavigateWorkItemDetail,
  type NavigatePullRequestDetail,
} from "@/lib/crossLinks";
import type { MyReviewsSelectRequest } from "@/features/pull-requests/MyReviewsGrid";
import {
  emptyViewHistory,
  goBack as historyGoBack,
  goForward as historyGoForward,
  pushView,
  type ViewHistory,
} from "@/features/navigation/viewHistory";

type View =
  | "pullRequestSearch"
  | "myReviews"
  | "workItems"
  | "myWorkItems"
  | "workItemViews"
  | "commits"
  | "pipelines"
  | "codeSearch"
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

type PaletteSearchKind = "workItems" | "pullRequests" | "commits" | "code";

type ExternalSearchRequest = { query: string; requestId: number; organizationId?: string };

function parsePaletteSearch(text: string): { kind: PaletteSearchKind | null; query: string } {
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

function commitFirstLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
}


// Linear-style two-key navigation: press the leader (G by default), then the
// per-view key. The leader and each second key are resolved from the keybinding
// registry so users can rebind them in Settings.
const GOTO_BINDING_VIEWS = {
  gotoMyReviews: "myReviews",
  gotoPullRequestSearch: "pullRequestSearch",
  gotoMyWorkItems: "myWorkItems",
  gotoWorkItemSearch: "workItems",
  gotoWorkItemViews: "workItemViews",
  gotoCommits: "commits",
  gotoPipelines: "pipelines",
  gotoCodeSearch: "codeSearch",
  gotoSettings: "settings",
} satisfies Partial<Record<keyof KeybindingMap, View>>;
const GOTO_CHAIN_TIMEOUT_MS = 1500;

// Resolves the second-key -> view lookup for the goto chain from the current
// keybinding map (normalized to upper-case single keys).
function gotoViewMapFromKeybindings(keybindings: KeybindingMap): Record<string, View> {
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

// Reactively reads the resolved keybinding map and refreshes when overrides
// change (settings emit KEYBINDINGS_CHANGED_EVENT).
function useKeybindings(): KeybindingMap {
  const [keybindings, setKeybindings] = useState<KeybindingMap>(resolveKeybindings);
  useEffect(() => {
    function onChange() {
      setKeybindings(resolveKeybindings());
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onChange);
  }, []);
  return keybindings;
}



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
  const [navExpanded, setNavExpanded] = useState<Record<NavSectionId, boolean>>({
    pullRequests: true,
    workItems: true,
  });
  const [pinnedViewsExpanded, setPinnedViewsExpanded] = useState(true);
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
  // Notification events that arrived before settings finished loading. They are
  // replayed once settings are available so the first events are not dropped.
  const pendingWorkItemEventsRef = useRef<WorkItemNotificationEvent[]>([]);
  const pendingPullRequestEventsRef = useRef<PullRequestNotificationEvent[]>([]);
  const pendingSyncFailedEventsRef = useRef<SyncFailedEvent[]>([]);
  const startupHotSyncStartedRef = useRef(false);
  const lastHotSyncRequestedAtRef = useRef(0);
  const navTypeaheadRef = useRef<{ value: string; timer: number | null }>({
    value: "",
    timer: null,
  });
  const queryClient = useQueryClient();
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
  const [quickPipelines, setQuickPipelines] = useState<QuickPipeline[]>(() =>
    loadQuickPipelines(),
  );

  // Keep the palette's pipeline actions in sync with edits made in Settings.
  useEffect(() => {
    function onChanged() {
      setQuickPipelines(loadQuickPipelines());
    }
    window.addEventListener(QUICK_PIPELINES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(QUICK_PIPELINES_CHANGED_EVENT, onChanged);
  }, []);

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

  const syncMutation = useMutation({
    mutationFn: (input: { scope?: SyncScope }) => triggerSync(input),
    onSuccess: (_data, input) => {
      invalidateSyncedDataQueries(queryClient, invalidationScopesForSyncScope(input.scope ?? "all"));
      void queryClient.invalidateQueries({ queryKey: ["syncStates"] });
    },
  });

  const activeView = organizations.length === 0 ? "settings" : view;

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

  const [paletteSearchText, setPaletteSearchText] = useState("");
  const [debouncedPaletteSearchText, setDebouncedPaletteSearchText] = useState("");
  const [workItemSearchRequest, setWorkItemSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [pullRequestSearchRequest, setPullRequestSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [commitSearchRequest, setCommitSearchRequest] =
    useState<ExternalSearchRequest | null>(null);
  const [myReviewsSelectRequest, setMyReviewsSelectRequest] =
    useState<MyReviewsSelectRequest | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPaletteSearchText(paletteSearchText), 200);
    return () => window.clearTimeout(timer);
  }, [paletteSearchText]);

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

  const paletteSearch = parsePaletteSearch(debouncedPaletteSearchText);
  const paletteQueryLongEnough = /^\d+$/.test(paletteSearch.query)
    ? paletteSearch.query.length >= 1
    : paletteSearch.query.length >= 2;
  // Code search is heavy and hits the API, so it only runs behind the explicit
  // `code:`/`co:` prefix — never on a generic palette query.
  const paletteSearchEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind !== "code" &&
    paletteQueryLongEnough;
  const paletteCodeEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind === "code" &&
    paletteSearch.query.length >= 2;
  const searchAllQuery = useQuery({
    // No organizationId: the palette searches every configured organization.
    queryKey: ["searchAll", paletteSearch.query],
    queryFn: () => searchAll({ query: paletteSearch.query }),
    enabled: paletteSearchEnabled,
    staleTime: 30_000,
    // Keep showing the previous results while the next keystroke's search
    // runs, instead of flashing an empty list.
    placeholderData: keepPreviousData,
  });
  // Code search targets the first configured organization (the palette has no
  // org selector); the dedicated Code view offers per-org search.
  const paletteCodeOrgId = organizations[0]?.id;
  const paletteCodeQuery = useQuery({
    queryKey: ["paletteCode", paletteCodeOrgId, paletteSearch.query],
    queryFn: () => searchCode({ organizationId: paletteCodeOrgId, query: paletteSearch.query }),
    enabled: paletteCodeEnabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Code Search is an optional extension; a failed query just yields no items.
    retry: false,
  });

  function openSearchTarget(
    kind: PaletteSearchKind,
    query: string,
    organizationId?: string,
  ): void {
    if (kind === "workItems") {
      setWorkItemSearchRequest({ query, requestId: Date.now(), organizationId });
      setView("workItems");
    } else if (kind === "pullRequests") {
      setPullRequestSearchRequest({ query, requestId: Date.now(), organizationId });
      setView("pullRequestSearch");
    } else {
      setCommitSearchRequest({ query, requestId: Date.now(), organizationId });
      setView("commits");
    }
  }

  // Cast a review vote on a PR directly from the command palette (E-36). The
  // palette has no toast surface, so failures are logged; the resulting state
  // reflects in My Reviews, which is invalidated on success.
  const votePullRequest = useCallback(
    (pr: PullRequestSummary, vote: 10 | -10) => {
      void submitPullRequestVote({
        organizationId: pr.organizationId,
        projectId: pr.projectId,
        repositoryId: pr.repositoryId,
        pullRequestId: pr.pullRequestId,
        vote,
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
        })
        .catch((error) => {
          console.error("Failed to submit pull request vote from palette", error);
        });
    },
    [queryClient],
  );

  const paletteSearchItems = useMemo<CommandPaletteSearchItem[]>(() => {
    const kind = paletteSearch.kind;
    const showOrg = organizations.length > 1;

    // Code is a distinct, opt-in search (own query); surface its file hits and
    // return early since searchAll does not cover code.
    if (kind === "code") {
      const codeData = paletteCodeEnabled ? paletteCodeQuery.data : undefined;
      const codeItems: CommandPaletteSearchItem[] = [];
      for (const hit of codeData?.results ?? []) {
        codeItems.push({
          id: `code:${hit.projectName}:${hit.repositoryName}:${hit.branch ?? ""}:${hit.path}`,
          group: "Code",
          label: hit.fileName,
          detail: [hit.path, `${hit.projectName} / ${hit.repositoryName}`]
            .filter(Boolean)
            .join(" · "),
          // No in-app file viewer; open the file in Azure DevOps.
          run: () => {
            void openExternalUrl(hit.webUrl);
          },
        });
      }
      return codeItems;
    }

    const data = paletteSearchEnabled ? searchAllQuery.data : undefined;
    if (!data) return [];
    const items: CommandPaletteSearchItem[] = [];
    const rawQuery = paletteSearch.query;

    if (!kind || kind === "workItems") {
      for (const item of data.workItems) {
        items.push({
          id: `wi:${item.organizationId}:${item.id}`,
          group: "Work Items",
          label: `#${item.id} ${item.title}`,
          detail: [
            showOrg ? item.organizationId : null,
            item.workItemType,
            item.state,
            item.assignedTo,
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("workItems", String(item.id), item.organizationId);
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
          detail: [showOrg ? pr.organizationId : null, pr.repositoryName, pr.createdBy]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("pullRequests", String(pr.pullRequestId), pr.organizationId);
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
      // When the user explicitly filters to PRs, offer direct approve/reject
      // actions per result (E-36) so a review vote can be cast from the palette.
      if (kind === "pullRequests") {
        for (const pr of data.pullRequests) {
          items.push({
            id: `pr-approve:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
            group: "Pull Request actions",
            label: `Approve PR ${pr.pullRequestId} — ${pr.title}`,
            detail: showOrg ? pr.organizationId : pr.repositoryName,
            run: () => votePullRequest(pr, 10),
          });
          items.push({
            id: `pr-reject:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
            group: "Pull Request actions",
            label: `Reject PR ${pr.pullRequestId} — ${pr.title}`,
            detail: showOrg ? pr.organizationId : pr.repositoryName,
            run: () => votePullRequest(pr, -10),
          });
        }
      }
    }
    if (!kind || kind === "commits") {
      for (const commit of data.commits) {
        items.push({
          id: `c:${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`,
          group: "Commits",
          label: `${commit.shortCommitId} ${commitFirstLine(commit.comment)}`,
          detail: [
            showOrg ? commit.organizationId : null,
            commit.repositoryName,
            commit.authorName,
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("commits", rawQuery, commit.organizationId);
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
  }, [
    paletteSearch.kind,
    paletteSearch.query,
    paletteSearchEnabled,
    searchAllQuery.data,
    votePullRequest,
    paletteCodeEnabled,
    paletteCodeQuery.data,
  ]);

  // The palette surfaces recently opened Work Items and PRs. With an empty query
  // it lists them newest-first; while typing it narrows them by id or title so a
  // previously opened item is reachable without re-running a search.
  const paletteRecentItems = useMemo<CommandPaletteSearchItem[]>(() => {
    if (!commandPaletteOpen || organizations.length === 0) return [];
    // A prefixed search (wi:/pr:/c:) is an explicit live search, not a recents lookup.
    if (paletteSearch.kind !== null) return [];
    // Once live cross-org search kicks in, those results stand on their own;
    // recents are the fallback for an empty or too-short query.
    if (paletteSearchEnabled) return [];
    const filterText = debouncedPaletteSearchText.trim().toLowerCase();
    const matches = loadRecentPaletteEntries(organizations.length > 1).filter((entry) => {
      if (filterText.length === 0) return true;
      const needle = filterText.replace(/^#/, "");
      return entry.label.toLowerCase().includes(needle) || entry.query.includes(needle);
    });
    return matches.map((entry) => ({
      id: `recent:${entry.key}`,
      group: "Recent",
      label: entry.label,
      detail: entry.detail,
      run: () => {
        openSearchTarget(entry.kind, entry.query, entry.organizationId);
      },
      runAlt: entry.webUrl
        ? () => {
            void openExternalUrl(entry.webUrl as string);
          }
        : undefined,
    }));
  }, [
    commandPaletteOpen,
    debouncedPaletteSearchText,
    organizations.length,
    paletteSearch.kind,
    paletteSearchEnabled,
  ]);

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
    if (activeView === "pipelines") {
      // Pipelines are fetched live, not via background sync.
      void queryClient.invalidateQueries({ queryKey: ["pipelineRuns"] });
      return;
    }
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
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.pipelines",
      keywords: ["build", "ci", "pipeline"],
      label: "Go to Pipelines",
      run: () => setView("pipelines"),
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.codeSearch",
      keywords: ["code", "search", "grep", "files"],
      label: "Go to Code Search",
      run: () => setView("codeSearch"),
    },
    {
      group: "Navigation",
      id: "nav.settings",
      keywords: ["option", "preferences"],
      label: "Go to Settings",
      run: () => setView("settings"),
      shortcut: "Ctrl+,",
    },
    {
      group: "Focus",
      id: "focus.filter",
      keywords: ["search", "find"],
      label: "Focus filter",
      run: () => {
        focusFilterInput();
      },
      shortcut: "Ctrl+F",
    },
    {
      group: "Focus",
      id: "focus.grid",
      keywords: ["list", "table", "rows"],
      label: "Focus grid",
      run: focusPrimaryGrid,
      shortcut: "Ctrl+G",
    },
    {
      group: "Focus",
      id: "focus.preview",
      keywords: ["details", "pane"],
      label: "Focus preview",
      run: focusPrimaryPreview,
      shortcut: "Ctrl+P",
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
      id: "wi.customField",
      keywords: ["custom", "field", "edit"],
      label: "Change selected work item custom field",
      run: () => dispatchWorkItemCommand("open-field"),
      shortcut: "F",
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
      shortcut: "Ctrl+E",
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
    {
      group: "General",
      id: "general.resetLayoutWidths",
      keywords: ["layout", "width", "sidebar", "preview", "column", "reset", "default"],
      label: "Reset layout widths",
      run: resetLayoutWidths,
    },
    ...quickPipelines.map<CommandPaletteAction>((pipeline) => ({
      disabled: readOnlyMode,
      group: "Pipelines",
      id: `pipeline.run.${pipeline.id}`,
      keywords: ["pipeline", "build", "run", "trigger", pipeline.definitionName],
      label: readOnlyMode
        ? `Run: ${pipeline.name} (read-only)`
        : `Run: ${pipeline.name}`,
      run: () => {
        void runQuickPipeline(pipeline);
      },
    })),
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
    if (event.key === "ArrowRight" && current.dataset.navSubgroup === "true") {
      event.preventDefault();
      if (!pinnedViewsExpanded) {
        setPinnedViewsExpanded(true);
      } else {
        focusNavItem(current, 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && current.dataset.navSubgroup === "true") {
      event.preventDefault();
      if (pinnedViewsExpanded) setPinnedViewsExpanded(false);
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
    const settings = appSettingsQuery.data ?? null;
    appSettingsRef.current = settings;
    if (!settings) return;
    // Replay events that arrived before settings were ready.
    const workItemEvents = pendingWorkItemEventsRef.current;
    const pullRequestEvents = pendingPullRequestEventsRef.current;
    const syncFailedEvents = pendingSyncFailedEventsRef.current;
    pendingWorkItemEventsRef.current = [];
    pendingPullRequestEventsRef.current = [];
    pendingSyncFailedEventsRef.current = [];
    for (const event of workItemEvents) {
      void showWorkItemNotificationEvent(event, settings);
    }
    for (const event of pullRequestEvents) {
      void showPullRequestNotificationEvent(event, settings);
    }
    for (const event of syncFailedEvents) {
      void showSyncFailedNotificationEvent(event, settings);
    }
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
    return subscribeTauriEvent("sync:updated", (payload) => {
      const parsed = syncUpdatedEventSchema.safeParse(payload);
      invalidateSyncedDataQueries(queryClient, parsed.success ? parsed.data.scopes : ["all"]);
    });
  }, [queryClient]);

  useEffect(() => {
    return subscribeTauriEvent<WorkItemNotificationEvent>(
      "notifications:work-items",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingWorkItemEventsRef.current.push(payload);
          return;
        }
        void showWorkItemNotificationEvent(payload, settings);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeTauriEvent<PullRequestNotificationEvent>(
      "notifications:pull-requests",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingPullRequestEventsRef.current.push(payload);
          return;
        }
        void showPullRequestNotificationEvent(payload, settings);
      },
    );
  }, []);

  useEffect(() => {
    return subscribeTauriEvent<SyncFailedEvent>(
      "notifications:sync-failed",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingSyncFailedEventsRef.current.push(payload);
          return;
        }
        void showSyncFailedNotificationEvent(payload, settings);
      },
    );
  }, []);

  useEffect(() => {
    writeStoredString(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

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

    const leaderKey = normalizeKey(keybindings.gotoLeader);
    const gotoViewKeys = gotoViewMapFromKeybindings(keybindings);

    function onKeyDownCapture(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) {
        disarm();
        return;
      }
      if (armed) {
        const view = gotoViewKeys[normalizeKey(event.key)];
        disarm();
        if (view && (view === "settings" || organizations.length > 0)) {
          event.preventDefault();
          event.stopPropagation();
          setView(view);
          window.setTimeout(() => focusPrimaryGrid(), 0);
        }
        return;
      }
      if (normalizeKey(event.key) === leaderKey) {
        armed = true;
        timer = window.setTimeout(disarm, GOTO_CHAIN_TIMEOUT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      disarm();
    };
  }, [organizations.length, keybindings]);

  useEffect(() => {
    const isWorkItemView =
      activeView === "myWorkItems" ||
      activeView === "workItems" ||
      activeView === "workItemViews";

    function onGlobalKeyDown(event: KeyboardEvent) {
      // Alt+Left / Alt+Right: browser-like back/forward through visited views.
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        navigateHistory(event.key === "ArrowLeft" ? "back" : "forward");
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.commandPalette, event)) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.focusFilter, event)) {
        // Always claim the focus-filter combo so the browser's native find bar
        // never opens. Focusing the filter input is best-effort; views without
        // a filter simply swallow the shortcut instead of behaving
        // inconsistently.
        event.preventDefault();
        focusFilterInput();
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.refreshCurrentView, event)) {
        event.preventDefault();
        refreshCurrentView();
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.applyStaged, event)) {
        if (isWorkItemView) {
          event.preventDefault();
          dispatchWorkItemCommand("apply-staged");
        }
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      // Escape and F1 keep their fixed behavior regardless of overrides.
      if (
        (event.key === "F1" ||
          (!event.ctrlKey && !event.metaKey && matchesCombo(keybindings.help, event))) &&
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
        return;
      }

      // Focus-move shortcuts are now Ctrl-based, so their letters overlap text
      // editing keys. Skip them while a text input/editor is focused; Escape
      // already returns focus from an editor back to the grid.
      const inEditableTarget = isEditableTarget(event.target);

      if (!inEditableTarget && matchesCombo(keybindings.focusNavigation, event)) {
        event.preventDefault();
        focusNavigation();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusGrid, event)) {
        event.preventDefault();
        focusPrimaryGrid();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusPreview, event)) {
        event.preventDefault();
        focusPrimaryPreview();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusViewsPanel, event)) {
        if (activeView === "workItemViews") {
          event.preventDefault();
          focusViewsPanel();
        }
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusComment, event)) {
        if (isWorkItemView) {
          event.preventDefault();
          focusWorkItemCommentInput();
        }
        return;
      }

      if (matchesCombo(keybindings.syncNow, event)) {
        event.preventDefault();
        if (organizations.length > 0 && !syncMutation.isPending) {
          syncMutation.mutate({ scope: "all" });
        }
        return;
      }

      if (matchesCombo(keybindings.openSettings, event)) {
        event.preventDefault();
        setView("settings");
        return;
      }

      // Suppress WebView/browser default shortcuts the app does not bind so
      // they cannot leak through as native behavior (Ctrl+P print dialog,
      // Ctrl+G find-next). Reached only after every app keybinding above has
      // had a chance to claim the event, so user-customized bindings still win.
      // Editable targets keep their normal text-editing path untouched.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "p" ||
          event.key === "P" ||
          event.key === "g" ||
          event.key === "G") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [activeView, organizations.length, syncMutation.isPending, syncMutation.mutate, keybindings, navigateHistory]);

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <aside
        className="fixed inset-y-0 left-0 hidden flex-col border-r border-border bg-card lg:flex"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-12 min-w-0 items-center gap-2 border-b border-border px-4">
          <img src="/azdodeck.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">AzDoDeck</p>
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
                badge={myReviewsBadge}
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
                badge={myWorkItemsBadge}
                onClick={() => setView("myWorkItems")}
              />
              <NavSubGroup
                id="workItemViews"
                active={activeView === "workItemViews" && !activePinnedWorkItemView}
                disabled={organizations.length === 0}
                label="Views"
                expandable={pinnedWorkItemViews.length > 0}
                expanded={pinnedViewsExpanded}
                onToggle={() => setPinnedViewsExpanded((value) => !value)}
                onClick={() => {
                  setActiveWorkItemViewId(null);
                  setSelectedWorkItemViewRequestId(null);
                  setView("workItemViews");
                }}
              >
                {pinnedWorkItemViews.map((item) => (
                  <NavSubItem
                    key={item.id}
                    active={activeView === "workItemViews" && activeWorkItemViewId === item.id}
                    disabled={organizations.length === 0}
                    label={item.name}
                    badge={viewCountBaseline(item.id)}
                    onClick={() => {
                      setActiveWorkItemViewId(item.id);
                      setSelectedWorkItemViewRequestId(item.id);
                      setView("workItemViews");
                    }}
                  />
                ))}
              </NavSubGroup>
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
            <NavButton
              active={activeView === "pipelines"}
              disabled={organizations.length === 0}
              icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
              label="Pipelines"
              onClick={() => setView("pipelines")}
            />
            <NavButton
              active={activeView === "codeSearch"}
              disabled={organizations.length === 0}
              icon={<Code className="h-4 w-4" aria-hidden="true" />}
              label="Code"
              onClick={() => setView("codeSearch")}
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
              shortcut="Control+,"
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
        <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4 lg:px-5">
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
                          : activeView === "pipelines"
                            ? "Pipelines"
                            : activeView === "codeSearch"
                              ? "Code Search"
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
                          : activeView === "pipelines"
                            ? "Azure DevOps build runs by project"
                            : activeView === "codeSearch"
                              ? "Search code across Azure DevOps repositories"
                              : "Local Azure DevOps organization setup"}
            </p>
          </div>
          {organizations.length > 0 && (
            <div className="flex items-center gap-2">
              <SyncStatusIndicator
                onSync={() => syncMutation.mutate({ scope: "all" })}
                syncing={syncMutation.isPending}
              />
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
          <Suspense fallback={<LoadingState />}>
          {organizationsQuery.isLoading ? (
            <LoadingState />
          ) : organizationsQuery.isError ? (
            <ErrorState
              message={commandErrorMessage(organizationsQuery.error)}
              onRetry={() => void organizationsQuery.refetch()}
              onOpenSettings={() => setView("settings")}
            />
          ) : activeView === "pullRequestSearch" ? (
            <PullRequestSearch
              organizations={organizations}
              externalSearch={pullRequestSearchRequest}
              onExternalSearchHandled={() => setPullRequestSearchRequest(null)}
            />
          ) : activeView === "myReviews" ? (
            <MyReviewsGrid
              organizations={organizations}
              selectRequest={myReviewsSelectRequest}
              onSelectRequestHandled={() => setMyReviewsSelectRequest(null)}
            />
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
              onOpenPullRequest={(query, organizationId) =>
                openSearchTarget("pullRequests", query, organizationId)
              }
            />
          ) : activeView === "pipelines" ? (
            <PipelinesView organizations={organizations} />
          ) : activeView === "codeSearch" ? (
            <CodeSearchView organizations={organizations} />
          ) : organizations.length === 0 ? (
            <SetupPanel />
          ) : (
            <OrganizationSettings organizations={organizations} />
          )}
          </Suspense>
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
                  items: [...paletteSearchItems, ...paletteRecentItems],
                  pending: paletteSearchEnabled && searchAllQuery.isFetching,
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
