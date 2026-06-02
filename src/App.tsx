import {
  CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
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
  listOrganizations,
  triggerSync,
} from "@/lib/azdoCommands";
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
import { CommandPalette, type CommandPaletteAction } from "@/components/CommandPalette";
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

function invalidateSyncedDataQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
  invalidateWorkItemQueryViews(queryClient);
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
}

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
  const syncMutation = useMutation({
    mutationFn: triggerSync,
  });

  const organizations = organizationsQuery.data ?? [];
  const activeView = organizations.length === 0 ? "settings" : view;
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

  const commandActions: CommandPaletteAction[] = [
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.myReviews",
      keywords: ["pull request", "review"],
      label: "Go to My Reviews",
      run: () => setView("myReviews"),
      shortcut: "Alt+1",
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.pullRequestSearch",
      keywords: ["pull request", "search"],
      label: "Go to Pull Request Search",
      run: () => setView("pullRequestSearch"),
      shortcut: "Alt+2",
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.myWorkItems",
      keywords: ["work item", "assigned"],
      label: "Go to My Work Items",
      run: () => setView("myWorkItems"),
      shortcut: "Alt+3",
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.workItemViews",
      keywords: ["wiql", "query", "saved"],
      label: "Go to Work Item Views",
      run: () => setView("workItemViews"),
      shortcut: "Alt+4",
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.workItemSearch",
      keywords: ["work item", "search"],
      label: "Go to Work Item Search",
      run: () => setView("workItems"),
      shortcut: "Alt+5",
    },
    {
      disabled: organizations.length === 0,
      group: "Navigation",
      id: "nav.commits",
      keywords: ["commit", "search"],
      label: "Go to Commits",
      run: () => setView("commits"),
      shortcut: "Alt+6",
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
      disabled: organizations.length === 0 || syncMutation.isPending,
      group: "General",
      id: "general.sync",
      keywords: ["refresh"],
      label: "Sync now",
      run: () => syncMutation.mutate(),
      shortcut: "Alt+S",
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
    if (!isTauriRuntime()) return;
    let cleanup: (() => void) | undefined;
    listen("sync:updated", () => {
      invalidateSyncedDataQueries(queryClient);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [queryClient]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

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
        setCommandPaletteOpen(false);
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
          syncMutation.mutate();
        }
        return;
      }

      const nextViewByKey: Record<string, View> =
        organizations.length === 0
          ? { ",": "settings" }
          : {
              "1": "myReviews",
              "2": "pullRequestSearch",
              "3": "myWorkItems",
              "4": "workItemViews",
              "5": "workItems",
              "6": "commits",
              ",": "settings",
            };
      const nextView = nextViewByKey[event.key];
      if (!nextView) {
        return;
      }

      event.preventDefault();
      setView(nextView);
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
                shortcut="Alt+1"
                onClick={() => setView("myReviews")}
              />
              <NavSubItem
                active={activeView === "pullRequestSearch"}
                disabled={organizations.length === 0}
                label="Search"
                shortcut="Alt+2"
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
                shortcut="Alt+3"
                onClick={() => setView("myWorkItems")}
              />
              <NavSubItem
                active={activeView === "workItemViews" && !activePinnedWorkItemView}
                disabled={organizations.length === 0}
                label="Views"
                shortcut="Alt+4"
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
                shortcut="Alt+5"
                onClick={() => setView("workItems")}
              />
            </NavSection>
            <NavButton
              active={activeView === "commits"}
              disabled={organizations.length === 0}
              icon={<GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />}
              label="Commits"
              shortcut="Alt+6"
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
            <button
              type="button"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
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
            <PullRequestSearch organizations={organizations} />
          ) : activeView === "myReviews" ? (
            <MyReviewsGrid organizations={organizations} />
          ) : activeView === "workItems" ? (
            <WorkItemSearch organizations={organizations} />
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
            <CommitSearch organizations={organizations} />
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
          onClose={() => setCommandPaletteOpen(false)}
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
