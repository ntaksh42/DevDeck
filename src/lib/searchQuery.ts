// Pure parser for the search box "smart" prefix syntax. Splits a raw search
// string into structured filter terms plus the remaining free text so each
// view can decide how to apply them. Unknown prefixes are intentionally treated
// as plain text so a stray colon never turns into an error.

export type SearchFilterKey =
  | "id" // #1234
  | "priority" // p:1
  | "assignee" // @user
  | "state" // s:active
  | "type" // t:bug
  | "project" // project:demo
  | "sha" // sha:abcd
  | "tag"; // tag:foo

export type SearchFilter = {
  key: SearchFilterKey;
  value: string;
};

export type ParsedSearchQuery = {
  filters: SearchFilter[];
  // Free-text terms (already lowercased) that did not match a prefix.
  text: string[];
};

// Map a bare `key:` prefix to its filter key. `#` and `@` are handled
// separately because they are sigils rather than `key:value` pairs.
const PREFIX_ALIASES: Record<string, SearchFilterKey> = {
  p: "priority",
  s: "state",
  t: "type",
  sha: "sha",
  project: "project",
  tag: "tag",
};

// Split on whitespace; the parser is deliberately simple and does not support
// quoted phrases, which keeps it predictable for keyboard-driven filtering.
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const filters: SearchFilter[] = [];
  const text: string[] = [];

  for (const rawToken of raw.trim().split(/\s+/)) {
    if (!rawToken) continue;
    const token = rawToken.toLowerCase();

    if (token.startsWith("#") && token.length > 1) {
      filters.push({ key: "id", value: token.slice(1) });
      continue;
    }

    if (token.startsWith("@") && token.length > 1) {
      filters.push({ key: "assignee", value: token.slice(1) });
      continue;
    }

    const colon = token.indexOf(":");
    if (colon > 0 && colon < token.length - 1) {
      const prefix = token.slice(0, colon);
      const value = token.slice(colon + 1);
      const key = PREFIX_ALIASES[prefix];
      if (key) {
        filters.push({ key, value });
        continue;
      }
    }

    // No recognized prefix: fall back to plain full-text matching.
    text.push(token);
  }

  return { filters, text };
}

// A work item shaped just enough for matching, decoupled from the Zod type so
// the parser stays testable without importing the command layer.
export type WorkItemMatchTarget = {
  id: number;
  title: string;
  workItemType: string | null;
  state: string | null;
  assignedTo: string | null;
  projectName: string;
  priority: number | null;
  tags: string[];
};

function includesCi(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle);
}

function matchesFilter(item: WorkItemMatchTarget, filter: SearchFilter): boolean {
  switch (filter.key) {
    case "id":
      // `#12` matches id 12 exactly, not a substring, so the preview opens on
      // the intended work item rather than every id containing "12".
      return String(item.id) === filter.value;
    case "priority":
      return item.priority !== null && String(item.priority) === filter.value;
    case "assignee":
      return includesCi(item.assignedTo, filter.value);
    case "state":
      return includesCi(item.state, filter.value);
    case "type":
      return includesCi(item.workItemType, filter.value);
    case "project":
      return includesCi(item.projectName, filter.value);
    case "tag":
      return item.tags.some((tag) => tag.toLowerCase().includes(filter.value));
    case "sha":
      // SHA filtering is meaningless for work items; never match.
      return false;
  }
}

// True when the item satisfies every parsed filter and contains all free-text
// terms somewhere in its searchable fields. An empty query matches everything.
export function matchesWorkItemQuery(
  item: WorkItemMatchTarget,
  query: ParsedSearchQuery,
): boolean {
  for (const filter of query.filters) {
    if (!matchesFilter(item, filter)) return false;
  }
  if (query.text.length === 0) return true;
  const haystack = [
    String(item.id),
    item.title,
    item.workItemType,
    item.state,
    item.assignedTo,
    item.projectName,
    ...item.tags,
  ]
    .filter((value): value is string => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
  return query.text.every((term) => haystack.includes(term));
}

// The lone "#1234" jump case: when the only thing typed is a single id filter,
// the view can open that work item's preview directly.
export function singleIdJump(query: ParsedSearchQuery): number | null {
  if (query.text.length !== 0) return null;
  if (query.filters.length !== 1) return null;
  const [filter] = query.filters;
  if (filter.key !== "id") return null;
  const id = Number(filter.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
