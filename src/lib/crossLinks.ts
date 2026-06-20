// Cross-navigation between linked pull requests and work items. The preview
// panels are deep in the tree, so they request a tab switch via window custom
// events that the App shell listens for (see App.tsx).

export const NAVIGATE_WORK_ITEM_EVENT = "azdodeck:navigate:work-item";
export const NAVIGATE_PULL_REQUEST_EVENT = "azdodeck:navigate:pull-request";
// Lets deeply-nested error surfaces ask the shell to open Settings, e.g. the
// re-authentication path shown when a command fails with HTTP 401.
export const OPEN_SETTINGS_EVENT = "azdodeck:navigate:settings";

export type NavigateWorkItemDetail = {
  organizationId?: string;
  workItemId: number;
};

export type NavigatePullRequestDetail = {
  organizationId?: string;
  repositoryId?: string | null;
  pullRequestId: number;
};

// Matches Azure DevOps work item mentions like "AB#1234".
const WORK_ITEM_MENTION_PATTERN = /\bAB#(\d+)/gi;

/** Extracts unique work item ids referenced as `AB#NNN` across the given texts. */
export function extractWorkItemMentions(texts: (string | null | undefined)[]): number[] {
  const ids = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(WORK_ITEM_MENTION_PATTERN)) {
      const id = Number(match[1]);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

export function navigateToWorkItem(detail: NavigateWorkItemDetail): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_WORK_ITEM_EVENT, { detail }));
}

export function navigateToPullRequest(detail: NavigatePullRequestDetail): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_PULL_REQUEST_EVENT, { detail }));
}

export function requestOpenSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
}
