import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Lets a preview render its view controls into its dock tab strip (a panel's
// `headerActions`) while the controls' state stays inside the preview. A
// portal keeps React event bubbling and context, so the preview's own key
// handlers still see events from the moved controls.
const PreviewToolbarSlotContext = createContext<HTMLElement | null>(null);

/** Returns the tab-strip target node and a provider value for the preview. */
export function usePreviewToolbarSlot(): { slot: ReactNode; element: HTMLElement | null } {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return { slot: <div ref={setElement} className="flex shrink-0 items-center gap-1" />, element };
}

export const PreviewToolbarSlotProvider = PreviewToolbarSlotContext.Provider;

/** Renders `children` into the tab strip when a slot is provided, inline otherwise. */
export function PreviewToolbarPortal({ children }: { children: ReactNode }) {
  const element = useContext(PreviewToolbarSlotContext);
  return element ? createPortal(children, element) : <>{children}</>;
}
