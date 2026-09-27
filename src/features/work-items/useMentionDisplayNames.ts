import { useMemo, useState } from 'react';
import type { MentionCandidate } from '@/lib/azdoCommands';

/**
 * Display names for `@<id>` mentions in rendered comments: the recent mention
 * candidates plus any mention the user just inserted, keyed by id in both its
 * original and lower case.
 */
export function useMentionDisplayNames(recentMentionOptions: MentionCandidate[]) {
  const [namesById, setNamesById] = useState<Record<string, string>>({});

  const mentionDisplayNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, displayName] of Object.entries(namesById)) {
      names.set(id, displayName);
      names.set(id.toLowerCase(), displayName);
    }
    for (const candidate of recentMentionOptions) {
      names.set(candidate.id, candidate.displayName);
      names.set(candidate.id.toLowerCase(), candidate.displayName);
    }
    return names;
  }, [namesById, recentMentionOptions]);

  function rememberMention(candidate: MentionCandidate) {
    setNamesById((current) => ({ ...current, [candidate.id]: candidate.displayName }));
  }

  return { mentionDisplayNames, rememberMention };
}
