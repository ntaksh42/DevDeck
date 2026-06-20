// Browser-like back/forward history of visited views. Kept deliberately small:
// it records the view identity only; each view restores its own search/filter
// state from its existing localStorage persistence when revisited.

export type ViewHistory<V extends string> = {
  stack: V[];
  index: number;
};

export const VIEW_HISTORY_CAP = 50;

export function emptyViewHistory<V extends string>(): ViewHistory<V> {
  return { stack: [], index: -1 };
}

// Records a visit. Truncates any forward entries (a new navigation diverges from
// the previous path), ignores a repeat of the current view, and caps the depth.
export function pushView<V extends string>(
  history: ViewHistory<V>,
  view: V,
  cap = VIEW_HISTORY_CAP,
): ViewHistory<V> {
  if (history.index >= 0 && history.stack[history.index] === view) {
    return history;
  }
  const truncated = history.stack.slice(0, history.index + 1);
  truncated.push(view);
  const overflow = Math.max(0, truncated.length - cap);
  const stack = truncated.slice(overflow);
  return { stack, index: stack.length - 1 };
}

export function canGoBack<V extends string>(history: ViewHistory<V>): boolean {
  return history.index > 0;
}

export function canGoForward<V extends string>(history: ViewHistory<V>): boolean {
  return history.index >= 0 && history.index < history.stack.length - 1;
}

// Returns the new history position and the view to show, or null when the move
// is not possible.
export function goBack<V extends string>(
  history: ViewHistory<V>,
): { history: ViewHistory<V>; view: V } | null {
  if (!canGoBack(history)) return null;
  const index = history.index - 1;
  return { history: { ...history, index }, view: history.stack[index] };
}

export function goForward<V extends string>(
  history: ViewHistory<V>,
): { history: ViewHistory<V>; view: V } | null {
  if (!canGoForward(history)) return null;
  const index = history.index + 1;
  return { history: { ...history, index }, view: history.stack[index] };
}
