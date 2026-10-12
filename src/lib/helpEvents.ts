// Views open the Help dialog from outside the app shell (the status bar's `?`
// button), so they ask App through a window custom event.
export const OPEN_HELP_EVENT = "azdodeck:help:open";

/** Help dialog sections a view can ask to be scrolled to. */
export type HelpSection = "reviews" | "pr-search" | "work-items" | "pipelines" | "inbox";

export function requestHelp(section?: HelpSection): void {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT, { detail: { section } }));
}
