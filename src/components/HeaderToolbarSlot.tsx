import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Lets a view render a short toolbar (a few buttons) into the app header next
// to the breadcrumb, giving the toolbar's row back to the list. A portal keeps
// React event bubbling and context, so the view's own handlers still work.
type SlotState = { element: HTMLElement | null; setElement: (element: HTMLElement | null) => void };

const HeaderToolbarSlotContext = createContext<SlotState>({ element: null, setElement: () => {} });

export function HeaderToolbarSlotProvider({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return (
    <HeaderToolbarSlotContext.Provider value={{ element, setElement }}>
      {children}
    </HeaderToolbarSlotContext.Provider>
  );
}

/** The target node inside the header. */
export function HeaderToolbarTarget() {
  const { setElement } = useContext(HeaderToolbarSlotContext);
  return <div ref={setElement} className="flex min-w-0 items-center gap-2 overflow-x-auto" />;
}

/** Renders `children` into the header when it is mounted, inline otherwise. */
export function HeaderToolbarPortal({ children }: { children: ReactNode }) {
  const { element } = useContext(HeaderToolbarSlotContext);
  return element ? createPortal(children, element) : <>{children}</>;
}
