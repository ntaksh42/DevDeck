// Fuzzy file-name matching for the Code view's finder. A path matches when the
// typed text is a substring of it (best) or when its characters appear in order
// anywhere in it (subsequence, like VS Code's Ctrl+P). Lower score = better.

// Returns a ranking score, or null when `needle` does not match `path`.
// Substring hits rank by where they start, preferring the file name over its
// directories; subsequence hits rank after every substring hit, by how spread
// out the matched characters are.
export function fuzzyScore(path: string, needle: string): number | null {
  const haystack = path.toLowerCase();
  const query = needle.toLowerCase();
  if (!query) return 0;
  const substringAt = haystack.indexOf(query);
  if (substringAt >= 0) {
    const nameStart = haystack.lastIndexOf("/") + 1;
    return substringAt >= nameStart ? substringAt - nameStart : 100 + substringAt;
  }
  let from = 0;
  let first = -1;
  let last = -1;
  for (const ch of query) {
    const at = haystack.indexOf(ch, from);
    if (at < 0) return null;
    if (first < 0) first = at;
    last = at;
    from = at + 1;
  }
  return 1000 + (last - first);
}

// Items that match `needle`, best match first (ties keep the original order).
export function rankByFuzzy<T extends { path: string }>(items: T[], needle: string): T[] {
  const trimmed = needle.trim();
  if (!trimmed) return items;
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(item.path, trimmed);
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}
