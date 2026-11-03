import { isImeComposing } from "./utils";

const PANE = "[data-focus-pane]";
const TARGET = "[data-primary-grid='true'], [data-primary-preview='true'], [data-pane-focus-target='true'], [data-views-panel='true']";
const LOCAL_CONTROL = "input, textarea, select, a, [contenteditable='true'], [role='tree'], [role='treeitem'], [role='menu'], [role='menubar'], [role='tablist'], [role='radiogroup'], [role='slider'], [role='separator'], [role='dialog'], [role='alertdialog'], [data-pane-arrow-keys='local']";
const boundFrameDocuments = new WeakSet<Document>();
const DESTINATION = "[data-pane-editable='true'], [data-primary-grid='true']";

type PaneKeyEvent = Pick<KeyboardEvent,
  "key" | "target" | "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "preventDefault" | "stopPropagation"
>;

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function navigable(pane: HTMLElement): boolean {
  if (pane.matches(DESTINATION)) return true;
  return Array.from(pane.querySelectorAll<HTMLElement>(DESTINATION)).some((surface) => surface.closest(PANE) === pane && visible(surface));
}

function focusPane(pane: HTMLElement): void {
  const surface = pane.matches(TARGET) ? pane : Array.from(pane.querySelectorAll<HTMLElement>(TARGET)).find(visible);
  const list = surface?.matches("[data-primary-grid='true'], [data-views-panel='true']") ? surface : null;
  const selected = list?.querySelector<HTMLElement>("[aria-selected='true'][role='row'], [aria-selected='true'][role='option']");
  const target = selected ?? list?.querySelector<HTMLElement>("[tabindex='0']") ?? surface ?? pane;
  target.focus();
  if (document.activeElement !== target) pane.focus();
}

/** Ctrl+Tab visits every visible leaf pane, including read-only previews. */
export function handlePaneCycleKey(event: PaneKeyEvent, target: EventTarget | null = event.target): boolean {
  if (
    event.defaultPrevented || event.key !== "Tab" || !event.ctrlKey || event.metaKey || event.altKey ||
    isImeComposing(event)
  ) return false;
  // A panel shortcut must not escape an open dialog or menu's focus scope.
  if (Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]')).some(visible)) return false;

  const panes = Array.from(document.querySelectorAll<HTMLElement>(PANE)).filter((pane) => {
    if (!visible(pane) || pane.closest("[inert], [aria-hidden='true']")) return false;
    const rect = pane.getBoundingClientRect();
    let { left, right, top, bottom } = rect;
    for (let parent = pane.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right > left && bottom > top;
  });
  const leaves = panes
    .filter((pane) => !panes.some((other) => other !== pane && pane.contains(other)))
    .sort((a, b) => {
      const from = a.getBoundingClientRect();
      const to = b.getBoundingClientRect();
      return from.top - to.top || from.left - to.left;
    });
  if (!leaves.length) return false;
  const source = target instanceof HTMLElement ? target.closest(PANE) : null;
  let current = leaves.findIndex((pane) => pane === source);
  if (current < 0 && target instanceof HTMLElement) {
    const group = target.closest(".dv-groupview");
    current = leaves.findIndex((pane) => group?.contains(pane));
  }
  const next = current < 0
    ? (event.shiftKey ? leaves.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + leaves.length) % leaves.length;
  event.preventDefault();
  event.stopPropagation();
  focusPane(leaves[next]);
  return true;
}

/** Plain left/right follows the visible layout to editable panes and grids.
 * Editors, trees, menus and other controls retain their existing arrow keys. */
export function handlePaneFocusKey(event: PaneKeyEvent, target: EventTarget | null = event.target): boolean {
  if (
    event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
    isImeComposing(event) || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
  ) return false;
  if (!(target instanceof HTMLElement) || target.closest(LOCAL_CONTROL)) return false;
  if (target.closest("button, [role='button']") && !target.matches("[data-pane-focus-row='true']")) return false;
  if (!target.matches(`${TARGET}, ${PANE}, [role='row'], [role='option'], [data-pane-focus-row='true']`)) return false;
  const source = target.closest<HTMLElement>(PANE);
  if (!source) return false;

  const panes = Array.from(document.querySelectorAll<HTMLElement>(PANE)).filter((pane) => {
    for (let ancestor: HTMLElement | null = pane; ancestor; ancestor = ancestor.parentElement?.closest<HTMLElement>(PANE) ?? null) {
      if (!visible(ancestor)) return false;
    }
    return true;
  });
  // AppContent is the fallback pane for views without docks; split preview
  // columns can also live inside a dock. Navigate only their visible leaves.
  const leaves = panes.filter((pane) => !panes.some((other) => other !== pane && pane.contains(other)));
  const from = source.getBoundingClientRect();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const centerX = (from.left + from.right) / 2;
  const centerY = (from.top + from.bottom) / 2;
  const candidates = leaves
    .filter((pane) => pane !== source && navigable(pane))
    .map((pane) => {
      const rect = pane.getBoundingClientRect();
      return {
        pane,
        horizontal: direction * ((rect.left + rect.right) / 2 - centerX),
        overlaps: Math.min(from.bottom, rect.bottom) > Math.max(from.top, rect.top),
        vertical: Math.abs((rect.top + rect.bottom) / 2 - centerY),
      };
    })
    .filter((candidate) => candidate.horizontal > 1)
    .sort((a, b) => Number(b.overlaps) - Number(a.overlaps) || a.horizontal - b.horizontal || a.vertical - b.vertical);

  // At the outside edge stay put, rather than letting a legacy preview
  // handler jump across the layout to the primary grid.
  event.preventDefault();
  event.stopPropagation();
  if (candidates[0]) focusPane(candidates[0].pane);
  return true;
}

/** Sandboxed HTML has its own document: forward pane shortcuts to the host.
 * Plain arrows on controls and text selections stay local. */
export function bindFramePaneFocus(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc || boundFrameDocuments.has(doc)) return;
  boundFrameDocuments.add(doc);
  doc.addEventListener("keydown", (event) => {
    if (handlePaneCycleKey(event, frame)) return;
    if (event.target !== doc.body && event.target !== doc.documentElement) return;
    if (doc.getSelection()?.isCollapsed === false) return;
    const surface = frame.closest<HTMLElement>(TARGET) ?? frame.closest<HTMLElement>(PANE);
    if (surface) handlePaneFocusKey(event, surface);
  }, true);
}
