import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";

export type RightTab = "contents" | "history" | "compare";

const TAB_LABEL: Record<RightTab, string> = {
  contents: "Contents",
  history: "History",
  compare: "Compare",
};

export const CODE_TABPANEL_ID = "code-view-tabpanel";

// The Contents/History/Compare switcher as a proper ARIA tablist: roving
// tabindex (only the active tab is a Tab stop), arrow keys move focus among
// tabs, Home/End jump to the first/last, and Enter/Space activate the
// focused tab (manual activation, so arrowing around doesn't change the
// panel until the user confirms).
export function CodeViewTabs({
  tab,
  onChange,
  showCompare,
}: {
  tab: RightTab;
  onChange: (tab: RightTab) => void;
  showCompare: boolean;
}) {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabs: RightTab[] = showCompare ? ["contents", "history", "compare"] : ["contents", "history"];

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const container = tabsRef.current;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"));
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      buttons[(index < 0 ? 0 : index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      buttons[index <= 0 ? buttons.length - 1 : index - 1]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const focused = index >= 0 ? buttons[index] : undefined;
      if (focused?.dataset.tab) onChange(focused.dataset.tab as RightTab);
    }
  }

  return (
    <div
      ref={tabsRef}
      role="tablist"
      aria-label="File view"
      onKeyDown={onKeyDown}
      className="flex shrink-0 gap-1 text-sm"
    >
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`code-tab-${id}`}
          data-tab={id}
          aria-selected={tab === id}
          aria-controls={CODE_TABPANEL_ID}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onChange(id)}
          className={`rounded px-2 py-0.5 ${
            tab === id ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {TAB_LABEL[id]}
        </button>
      ))}
    </div>
  );
}
