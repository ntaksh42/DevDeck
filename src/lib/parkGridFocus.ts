/**
 * Before a virtualized grid or listbox jumps far (End, Home, a page past the
 * window), move focus from the current row (or option) onto its container.
 *
 * Otherwise the focused row unmounts in the same commit that swaps the virtual
 * window. Chromium blurs the node mid-commit and the scroll position gets
 * pulled back by several rows, so the newly selected row lands outside the
 * window and keyboard focus is left on `<body>`. Parking focus on the grid
 * (which stays mounted) avoids that; each grid's own focus restoration then
 * moves focus onto the selected row once it has mounted.
 *
 * `targetRow` is the selected row's node if it is already mounted; nothing is
 * parked then, because focus can move straight to it.
 */
export function parkGridFocus(targetRow: HTMLElement | null | undefined): void {
  if (targetRow?.isConnected) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const role = active.getAttribute("role");
  const container =
    role === "row"
      ? active.closest<HTMLElement>('[role="grid"]')
      : role === "option"
        ? active.closest<HTMLElement>('[role="listbox"]')
        : null;
  if (container?.hasAttribute("tabindex")) container.focus({ preventScroll: true });
}
