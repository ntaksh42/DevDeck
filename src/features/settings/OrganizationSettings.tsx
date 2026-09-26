import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Organization } from '@/lib/azdoCommands';
import { resolveKeybindings } from '@/lib/keybindings';
import { useExperimentalFlags } from './useExperimentalFlags';
import { filterSettingsGroups, SETTINGS_GROUPS } from './settingsSections';

export { SetupPanel } from './SetupPanel';
export { ReviewResultFolderSettings } from './ReviewResultFolderSettings';
export { WorkItemResultFolderSettings } from './WorkItemResultFolderSettings';
export { ReviewStaleThresholdSettings, WorkItemStaleThresholdSettings } from './StaleThresholdSettings';
export { NotificationRulesSettings } from './NotificationRulesSettings';
export { ShowWindowHotkeySettings } from './ShowWindowHotkeySettings';

const FOCUSABLE =
  "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex='0']";

export function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const flags = useExperimentalFlags();
  const [query, setQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState(SETTINGS_GROUPS[0].id);
  const contentRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLUListElement>(null);

  const visibleGroups = useMemo(
    () => filterSettingsGroups(SETTINGS_GROUPS, "", (entry) => !entry.flag || flags[entry.flag]),
    [flags],
  );
  const filteredGroups = useMemo(
    () => filterSettingsGroups(visibleGroups, query),
    [visibleGroups, query],
  );
  const matchingGroupIds = new Set(filteredGroups.map((group) => group.id));
  const filterCombo = resolveKeybindings().focusFilter;

  // Highlight the section currently at the top of the scroll area so the nav
  // doubles as a "you are here" marker while scrolling the long page.
  const groupKey = filteredGroups.map((group) => group.id).join(",");
  useEffect(() => {
    const container = contentRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const order = groupKey.split(",");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.settingsGroup ?? "";
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) setActiveGroupId(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    container
      .querySelectorAll<HTMLElement>("[data-settings-group]")
      .forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groupKey]);

  function jumpToGroup(groupId: string) {
    const section = contentRef.current?.querySelector<HTMLElement>(
      `[data-settings-group='${groupId}']`,
    );
    if (!section) return;
    setActiveGroupId(groupId);
    section.scrollIntoView?.({ block: "start" });
    section.focus({ preventScroll: true });
  }

  function onNavKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = current < 0 ? 0 : (current + 1) % buttons.length;
    else next = current <= 0 ? buttons.length - 1 : current - 1;
    buttons[next].focus();
  }

  function onFilterKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // First Escape clears the filter; a second one leaves the field.
      event.preventDefault();
      if (query) setQuery("");
      else event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter") {
      // Enter jumps into the first matching panel's first control.
      event.preventDefault();
      const entry = contentRef.current?.querySelector<HTMLElement>("[data-settings-entry]");
      if (!entry) return;
      entry.scrollIntoView?.({ block: "start" });
      (entry.querySelector<HTMLElement>(FOCUSABLE) ?? entry).focus({ preventScroll: true });
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
      <nav
        aria-label="Settings sections"
        className="grid gap-2 lg:sticky lg:top-0 lg:z-10"
      >
        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFilterKeyDown}
            placeholder={`Filter settings (${filterCombo})`}
            aria-label="Filter settings"
            data-filter-input="true"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear settings filter"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <ul
          ref={navRef}
          onKeyDown={onNavKeyDown}
          className="flex flex-wrap gap-1 lg:flex-col"
        >
          {visibleGroups.map((group) => {
            const matches = matchingGroupIds.has(group.id);
            const active = matches && group.id === activeGroupId;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => jumpToGroup(group.id)}
                  disabled={!matches}
                  aria-current={active ? "true" : undefined}
                  className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm disabled:cursor-default disabled:opacity-40 ${
                    active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {group.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div ref={contentRef} className="min-w-0 space-y-5">
        {filteredGroups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            <p>No settings match “{query}”.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Clear filter
            </button>
          </div>
        ) : (
          filteredGroups.map((group) => (
            <section
              key={group.id}
              aria-label={group.label}
              data-settings-group={group.id}
              tabIndex={-1}
              className="scroll-mt-1 space-y-3 outline-none"
            >
              <p
                aria-hidden="true"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.label}
              </p>
              {group.entries.map((entry) => (
                <div key={entry.id} data-settings-entry={entry.id} className="scroll-mt-1">
                  {entry.render(organizations)}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
