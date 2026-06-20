// Fired after the Quick Pipelines list is mutated so other parts of the app
// (e.g. the command palette in App.tsx) can refresh from localStorage without a
// shared store.
export const QUICK_PIPELINES_CHANGED_EVENT = "azdodeck:quickPipelines:changed";

export function emitQuickPipelinesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUICK_PIPELINES_CHANGED_EVENT));
}
