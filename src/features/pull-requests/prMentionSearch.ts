import {
  recordMentionInteraction,
  searchPullRequestMentions,
  type MentionCandidate,
} from "@/lib/azdoCommands";
import type { SelectedMention } from "@/features/work-items/workItemMentions";

/**
 * Mention search for a comment editor. `recordPosted`, when present, is told
 * which mentions went out in a posted comment so the backend can rank those
 * people first next time (see `mention_history`).
 */
export type MentionSearch = {
  (query: string): Promise<MentionCandidate[]>;
  recordPosted?: (mentions: SelectedMention[]) => void;
};

export function createPrMentionSearch(organizationId: string | undefined): MentionSearch {
  const search = (query: string) => searchPullRequestMentions({ organizationId, query });
  return Object.assign(search, {
    recordPosted: (mentions: SelectedMention[]) => {
      for (const mention of mentions) {
        if (!mention.uniqueName) continue;
        recordMentionInteraction({
          organizationId,
          userId: mention.id,
          displayName: mention.displayName,
          uniqueName: mention.uniqueName,
        }).catch(() => {
          // Ranking history is best effort; a failed write must not surface.
        });
      }
    },
  });
}
