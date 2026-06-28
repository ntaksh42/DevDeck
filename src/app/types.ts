import type { KeybindingMap } from "@/lib/keybindings";

export type View =
  | "pullRequestSearch"
  | "myReviews"
  | "myPullRequests"
  | "workItems"
  | "myWorkItems"
  | "workItemViews"
  | "commits"
  | "pipelines"
  | "codeSearch"
  | "settings";

export type NavSectionId = "pullRequests" | "workItems" | "code";

export type PaletteSearchKind = "workItems" | "pullRequests" | "commits" | "code";

export type ExternalSearchRequest = { query: string; requestId: number; organizationId?: string };

export const DEFAULT_SIDEBAR_WIDTH = 232;
export const SIDEBAR_WIDTH_STORAGE_KEY = "azdodeck:layout:sidebarWidth";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "azdodeck:layout:sidebarCollapsed";
export const HOT_SYNC_FOCUS_MIN_INTERVAL_MS = 2 * 60_000;

// Linear-style two-key navigation: press the leader (G by default), then the
// per-view key. The leader and each second key are resolved from the keybinding
// registry so users can rebind them in Settings.
export const GOTO_BINDING_VIEWS = {
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

export const GOTO_CHAIN_TIMEOUT_MS = 1500;
