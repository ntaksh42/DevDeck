import { useEffect, useMemo, useState } from "react";
import type { InboxEntry } from "./inboxPresentation";

/**
 * Items marked (X, or Shift+↑↓ to extend) for a bulk Done / Snooze. Marks are
 * dropped as soon as their item leaves the visible list (tab, filter or a
 * change), so a bulk action never touches something the user can't see.
 */
export function useInboxChecked(entries: InboxEntry[]) {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    setIds((current) => {
      if (current.size === 0) return current;
      const visible = new Set(entries.map((entry) => entry.id));
      const kept = [...current].filter((id) => visible.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [entries]);

  const checkedEntries = useMemo(() => entries.filter((entry) => ids.has(entry.id)), [entries, ids]);

  function add(...toAdd: (InboxEntry | undefined)[]) {
    setIds((current) => new Set([...current, ...toAdd.flatMap((entry) => (entry ? [entry.id] : []))]));
  }

  function toggle(entry: InboxEntry) {
    setIds((current) => {
      const next = new Set(current);
      if (!next.delete(entry.id)) next.add(entry.id);
      return next;
    });
  }

  return { ids, checkedEntries, add, toggle, clear: () => setIds(new Set()) };
}
