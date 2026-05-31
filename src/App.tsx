import {
  CSSProperties,
  useEffect,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { CommitSearch } from "@/features/commits/CommitSearch";
import { WorkItemSearch } from '@/features/work-items/WorkItemSearch';
import { WorkItemViewsPanel } from '@/features/work-items/WorkItemViewsPanel';
import { MyWorkItemsPanel } from '@/features/work-items/MyWorkItemsPanel';
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

const DEFAULT_SIDEBAR_WIDTH = 232;
const SIDEBAR_WIDTH_STORAGE_KEY = "azdodeck:layout:sidebarWidth";

function AppShell() {
  const [view, setView] = useState<View>("myReviews");
  const [helpOpen, setHelpOpen] = useState(false);
  const [userGuideOpen, setUserGuideOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, 220, 420),
  );
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cleanup: (() => void) | undefined;
    listen("sync:updated", () => {
      void queryClient.invalidateQueries();
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

      if (event.key === "?" && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (event.key === "Escape" && !event.altKey) {
        setHelpOpen(false);
        setUserGuideOpen(false);
        return;
      }

      if (!event.altKey || event.shiftKey) {
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
          ? { "6": "settings" }
          : {
              "1": "myReviews",
              "2": "pullRequestSearch",
              "3": "myWorkItems",
              "4": "workItems",
              "5": "commits",
              "6": "settings",
              "7": "workItemViews",
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
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">AzDoDeck</p>
            <p className="text-xs text-muted-foreground">Azure DevOps</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col p-2">
          <div className="space-y-1">
            {/* Pull Requests section */}
            <NavSection
              icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
              label="Pull Requests"
              disabled={organizations.length === 0}
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
              icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
              label="Work Items"
              disabled={organizations.length === 0}
            >
              <NavSubItem
                active={activeView === "myWorkItems"}
                disabled={organizations.length === 0}
                label="My Items"
                shortcut="Alt+3"
                onClick={() => setView("myWorkItems")}
              />
              <NavSubItem
                active={activeView === "workItems"}
                disabled={organizations.length === 0}
                label="Search"
                shortcut="Alt+4"
                onClick={() => setView("workItems")}
              />
              <NavSubItem
                active={activeView === "workItemViews"}
                disabled={organizations.length === 0}
                label="Views"
                shortcut="Alt+7"
                onClick={() => setView("workItemViews")}
              />
            </NavSection>
            <NavButton
              active={activeView === "commits"}
              disabled={organizations.length === 0}
              icon={<GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />}
              label="Commits"
              shortcut="Alt+5"
              onClick={() => setView("commits")}
            />
          </div>
          <div className="mt-auto space-y-1 border-t border-border pt-2">
            <NavButton
              active={false}
              icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
              label="Help"
              onClick={() => setUserGuideOpen(true)}
            />
            <NavButton
              active={activeView === "settings"}
              icon={<Settings className="h-4 w-4" aria-hidden="true" />}
              label="Settings"
              shortcut="Alt+6"
              onClick={() => setView("settings")}
            />
          </div>
        </nav>
        <ResizeHandle
          ariaLabel="Resize navigation"
          className="absolute inset-y-0 right-[-5px] hidden lg:flex"
          direction={1}
          max={420}
          min={220}
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
            <WorkItemViewsPanel organizations={organizations} />
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
