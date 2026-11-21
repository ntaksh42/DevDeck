import { useEffect, useMemo, useReducer } from "react";
import { resolveMentionIdentities } from "@/lib/azdoCommands";

const MENTION_GUID =
  /@(?:<|&lt;)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:>|&gt;)/gi;

// Resolved names live for the whole session: an identity's display name rarely
// changes, and the cache is shared by every comment view.
const resolvedNames = new Map<string, string>();
const requestedKeys = new Set<string>();

function cacheKey(organizationId: string, id: string) {
  return `${organizationId}:${id}`;
}

export function extractMentionIds(texts: ReadonlyArray<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(MENTION_GUID)) ids.add(match[1].toLowerCase());
  }
  return [...ids].sort();
}

/**
 * Display names for `@<guid>` mentions found in `texts`. Names in `known` are
 * used as-is; the remaining ids are resolved through Azure DevOps once and
 * cached, so mentions of people who never commented still show a name.
 * Keys of the returned map are lower-case ids.
 */
export function useMentionIdentityNames(
  organizationId: string | undefined,
  texts: ReadonlyArray<string | null | undefined>,
  known?: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const [version, bump] = useReducer((value: number) => value + 1, 0);
  const idsKey = extractMentionIds(texts).join(",");

  useEffect(() => {
    if (!organizationId || !idsKey) return;
    const missing = idsKey
      .split(",")
      .filter((id) => !known?.has(id) && !requestedKeys.has(cacheKey(organizationId, id)));
    if (missing.length === 0) return;
    for (const id of missing) requestedKeys.add(cacheKey(organizationId, id));
    resolveMentionIdentities({ organizationId, ids: missing })
      .then((candidates) => {
        for (const candidate of candidates) {
          resolvedNames.set(cacheKey(organizationId, candidate.id.toLowerCase()), candidate.displayName);
        }
        bump();
      })
      .catch(() => {
        // Allow a retry the next time the comments are shown.
        for (const id of missing) requestedKeys.delete(cacheKey(organizationId, id));
      });
  }, [organizationId, idsKey, known]);

  return useMemo(() => {
    const names = new Map<string, string>();
    if (organizationId && idsKey) {
      for (const id of idsKey.split(",")) {
        const name = resolvedNames.get(cacheKey(organizationId, id));
        if (name) names.set(id, name);
      }
    }
    for (const [id, name] of known ?? []) names.set(id.toLowerCase(), name);
    return names;
    // `version` re-reads the shared cache after a resolution finishes.
  }, [organizationId, idsKey, known, version]);
}
