import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Bell,
  BookOpen,
  Code,
  GitBranch,
  GitPullRequest,
  ListChecks,
  Settings,
} from "lucide-react";
import type { ProviderCapabilities } from "@/lib/azdoCommands";
import { type NavEntryId, loadNavOrder, reorderNav, saveNavOrder } from "@/lib/navOrder";
import { isEditableTarget } from "@/lib/utils";
import { ResizeHandle } from "@/components/ResizeHandle";
import { NavButton, NavSection, NavSubGroup, NavSubItem } from "@/components/Nav";
import { viewCountBaseline, type WorkItemQueryView } from "@/features/work-items/workItemViewsStorage";
import type { View, NavSectionId } from "./types";
import { DEFAULT_SIDEBAR_WIDTH } from "./types";

export interface AppSidebarHandle {
  focusNavigation: () => void;
}

export interface AppSidebarProps {
  activeView: View;
  organizationsLength: number;
  /// Capabilities of the active connection's provider. When a feature is not
  /// supported, its nav entry is hidden so the UI never offers it. `null` while
  /// loading shows everything.
  capabilities: ProviderCapabilities | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  workItemNavViews: WorkItemQueryView[];
  activeWorkItemViewId: string | null;
  myReviewsBadge: number | null;
  myWorkItemsBadge: number | null;
  notificationsBadge: number | null;
  onNavigate: (view: View) => void;
  onOpenHelp: () => void;
  onSetActiveWorkItemViewId: (id: string | null) => void;
  onSetSelectedWorkItemViewRequestId: (id: string | null) => void;
}

export const AppSidebar = forwardRef<AppSidebarHandle, AppSidebarProps>(function AppSidebar(
  {
    activeView,
    organizationsLength,
    capabilities,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    workItemNavViews,
    activeWorkItemViewId,
    myReviewsBadge,
    myWorkItemsBadge,
    notificationsBadge,
    onNavigate,
    onOpenHelp,
    onSetActiveWorkItemViewId,
    onSetSelectedWorkItemViewRequestId,
  },
  ref,
) {
  const navRef = useRef<HTMLElement | null>(null);
  const navTypeaheadRef = useRef<{ value: string; timer: number | null }>({
    value: "",
    timer: null,
  });
  // Order of the top-level nav entries, restored from localStorage and persisted
  // whenever it changes (via drag or keyboard reordering).
  const [navOrder, setNavOrder] = useState<NavEntryId[]>(() => loadNavOrder());
  useEffect(() => {
    saveNavOrder(navOrder);
  }, [navOrder]);
  // The entry currently being dragged, and the entry it is hovering over.
  const [draggedNavId, setDraggedNavId] = useState<NavEntryId | null>(null);
  const [dragOverNavId, setDragOverNavId] = useState<NavEntryId | null>(null);
  const [navExpanded, setNavExpanded] = useState<Record<NavSectionId, boolean>>({
    pullRequests: true,
    workItems: true,
    code: true,
  });
  const [pinnedViewsExpanded, setPinnedViewsExpanded] = useState(true);

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

  useImperativeHandle(ref, () => ({ focusNavigation }));

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

  function handleNavDragStart(event: ReactDragEvent<HTMLDivElement>, id: NavEntryId): void {
    setDraggedNavId(id);
    // Mark this as a "move" drag and stash the id; some browsers refuse to start
    // a drag unless some data is set.
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function handleNavDragOver(event: ReactDragEvent<HTMLDivElement>, id: NavEntryId): void {
    // Required: without preventDefault the browser never fires a drop event.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (id !== dragOverNavId) setDragOverNavId(id);
  }

  function handleNavDrop(event: ReactDragEvent<HTMLDivElement>, targetId: NavEntryId): void {
    event.preventDefault();
    if (draggedNavId) {
      setNavOrder((order) => reorderNav(order, draggedNavId, targetId));
    }
    setDraggedNavId(null);
    setDragOverNavId(null);
  }

  function handleNavDragEnd(): void {
    setDraggedNavId(null);
    setDragOverNavId(null);
  }

  function handleNavKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-nav-item='true']",
    );
    if (!current) return;

    // Alt+Arrow reorders the top-level entry the focus currently sits in. Checked
    // before the plain Arrow handlers so it wins over focus movement.
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const entryId = current.closest<HTMLElement>("[data-nav-entry]")?.dataset
        .navEntry as NavEntryId | undefined;
      if (!entryId) return;
      const from = navOrder.indexOf(entryId);
      const to = event.key === "ArrowDown" ? from + 1 : from - 1;
      if (to < 0 || to >= navOrder.length) return;
      const targetId = navOrder[to];
      setNavOrder((order) => reorderNav(order, entryId, targetId));
      return;
    }

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

  const pinnedWorkItemViews = workItemNavViews.filter((item) => item.pinned);
  const activePinnedWorkItemView = pinnedWorkItemViews.find(
    (item) => item.id === activeWorkItemViewId,
  );

  const navEntries: Record<NavEntryId, ReactNode> = {
    pullRequests: (
      <NavSection
        key="pullRequests"
        id="pullRequests"
        icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
        label="Pull Requests"
        disabled={organizationsLength === 0}
        expanded={navExpanded.pullRequests}
        onExpandedChange={(expanded) => setNavSectionExpanded("pullRequests", expanded)}
      >
        <NavSubItem
          active={activeView === "myReviews"}
          disabled={organizationsLength === 0}
          label="My Reviews"
          badge={myReviewsBadge}
          onClick={() => onNavigate("myReviews")}
        />
        <NavSubItem
          active={activeView === "myPullRequests"}
          disabled={organizationsLength === 0}
          label="My Pull Requests"
          onClick={() => onNavigate("myPullRequests")}
        />
        <NavSubItem
          active={activeView === "pullRequestSearch"}
          disabled={organizationsLength === 0}
          label="Search"
          onClick={() => onNavigate("pullRequestSearch")}
        />
      </NavSection>
    ),
    workItems: (
      <NavSection
        key="workItems"
        id="workItems"
        icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
        label="Work Items"
        disabled={organizationsLength === 0}
        expanded={navExpanded.workItems}
        onExpandedChange={(expanded) => setNavSectionExpanded("workItems", expanded)}
      >
        <NavSubItem
          active={activeView === "myWorkItems"}
          disabled={organizationsLength === 0}
          label="My Items"
          badge={myWorkItemsBadge}
          onClick={() => onNavigate("myWorkItems")}
        />
        <NavSubGroup
          id="workItemViews"
          active={activeView === "workItemViews" && !activePinnedWorkItemView}
          disabled={organizationsLength === 0}
          label="Views"
          expandable={pinnedWorkItemViews.length > 0}
          expanded={pinnedViewsExpanded}
          onToggle={() => setPinnedViewsExpanded((value) => !value)}
          onClick={() => {
            onSetActiveWorkItemViewId(null);
            onSetSelectedWorkItemViewRequestId(null);
            onNavigate("workItemViews");
          }}
        >
          {pinnedWorkItemViews.map((item) => (
            <NavSubItem
              key={item.id}
              active={activeView === "workItemViews" && activeWorkItemViewId === item.id}
              disabled={organizationsLength === 0}
              label={item.name}
              badge={viewCountBaseline(item.id)}
              onClick={() => {
                onSetActiveWorkItemViewId(item.id);
                onSetSelectedWorkItemViewRequestId(item.id);
                onNavigate("workItemViews");
              }}
            />
          ))}
        </NavSubGroup>
        <NavSubItem
          active={activeView === "workItems"}
          disabled={organizationsLength === 0}
          label="Search"
          onClick={() => onNavigate("workItems")}
        />
      </NavSection>
    ),
    pipelines: (
      <NavButton
        key="pipelines"
        active={activeView === "pipelines"}
        disabled={organizationsLength === 0}
        icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
        label="Pipelines"
        onClick={() => onNavigate("pipelines")}
      />
    ),
    codeSearch: (
      <NavSection
        key="codeSearch"
        id="code"
        icon={<Code className="h-4 w-4" aria-hidden="true" />}
        label="Code"
        disabled={organizationsLength === 0}
        expanded={navExpanded.code}
        onExpandedChange={(expanded) => setNavSectionExpanded("code", expanded)}
      >
        {capabilities?.codeBrowse !== false ? (
          <NavSubItem
            active={activeView === "codeSearch"}
            disabled={organizationsLength === 0}
            label="Files"
            onClick={() => onNavigate("codeSearch")}
          />
        ) : null}
        <NavSubItem
          active={activeView === "commits"}
          disabled={organizationsLength === 0}
          label="Commits"
          onClick={() => onNavigate("commits")}
        />
      </NavSection>
    ),
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 flex-col border-r border-border bg-card ${
        sidebarCollapsed ? "hidden" : "hidden lg:flex"
      }`}
      style={{ width: sidebarWidth }}
    >
      <nav
        ref={navRef}
        aria-label="Primary navigation"
        className="flex flex-1 flex-col p-2"
        onKeyDown={handleNavKeyDown}
      >
        <div className="space-y-1">
          {navOrder
            .filter(
              (id) => id !== "pipelines" || capabilities?.pipelines !== false,
            )
            .map((id) => (
            <div
              key={id}
              data-nav-entry={id}
              draggable
              onDragStart={(event) => handleNavDragStart(event, id)}
              onDragOver={(event) => handleNavDragOver(event, id)}
              onDrop={(event) => handleNavDrop(event, id)}
              onDragEnd={handleNavDragEnd}
              className={`rounded-md transition-opacity ${
                draggedNavId === id ? "opacity-40" : ""
              } ${
                dragOverNavId === id && draggedNavId !== id
                  ? "ring-2 ring-inset ring-ring"
                  : ""
              }`}
            >
              {navEntries[id]}
            </div>
          ))}
        </div>
        <div className="mt-1 space-y-1 border-t border-border pt-1">
          <NavButton
            active={activeView === "notifications"}
            disabled={organizationsLength === 0}
            icon={<Bell className="h-4 w-4" aria-hidden="true" />}
            label="Notifications"
            badge={notificationsBadge}
            onClick={() => onNavigate("notifications")}
          />
        </div>
        <div className="mt-auto space-y-1 border-t border-border pt-2">
          <NavButton
            active={false}
            icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
            label="Help"
            shortcut="F1"
            onClick={() => onOpenHelp()}
          />
          <NavButton
            active={activeView === "settings"}
            icon={<Settings className="h-4 w-4" aria-hidden="true" />}
            label="Settings"
            shortcut="Control+,"
            onClick={() => onNavigate("settings")}
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
  );
});
